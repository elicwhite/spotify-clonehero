/**
 * `pcm-worker.ts` runs the two long synchronous PCM jobs that used to block
 * the main thread during the "Isolating the drums" step: the libsoxr
 * resample and the gzip of the packed drum stem.
 *
 * The contract that matters is that moving them changed nothing about their
 * OUTPUT, so these drive the worker's real message handler and compare
 * against the same functions the main thread used to call directly.
 *
 * libsoxr is mocked (it loads WASM from unpkg at runtime, unavailable in
 * jest); gzip is not, so the cache payload is a true round trip.
 */

import {
  encodeStemCacheBytes,
  decodeStemCacheBytesAuto,
} from '@/lib/audio-pipeline/stem-cache';
import type {PcmWorkerMessage} from '@/lib/audio-pipeline/pcm-worker';

const mockResampleSoxr = jest.fn(
  async (signal: Float32Array, inRate: number, outRate: number) =>
    // Deterministic stand-in: scale by the rate ratio so the test can tell
    // the two channels and the two rates apart.
    signal.map(v => v * (outRate / inRate)),
);

jest.mock('../../tempo-map/resampler-soxr', () => ({
  resampleSoxr: (...args: [Float32Array, number, number]) =>
    mockResampleSoxr(...args),
}));

interface Posted {
  msg: PcmWorkerMessage;
  transfer: Transferable[];
}

/** Loads the worker module (which installs `self.onmessage`) and returns a
 *  `send` that drives it, plus the messages it posted back. */
async function loadWorker(): Promise<{
  send: (request: unknown) => Promise<void>;
  posted: Posted[];
}> {
  const posted: Posted[] = [];
  // The worker's globals, stood up before the module body installs its
  // `self.onmessage`.
  const workerSelf: {
    postMessage: (
      msg: PcmWorkerMessage,
      opts: {transfer: Transferable[]},
    ) => void;
    onmessage?: (e: {data: unknown}) => void;
  } = {
    postMessage: (msg, opts) => {
      posted.push({msg, transfer: opts.transfer});
    },
  };
  (globalThis as unknown as {self: unknown}).self = workerSelf;
  await import('../pcm-worker');
  const handler = workerSelf.onmessage!;
  return {
    send: async request => {
      const before = posted.length;
      handler({data: request});
      // The handler is async (gzip pumps a stream across macrotasks); wait
      // for the reply rather than guessing a number of turns.
      for (let i = 0; i < 500 && posted.length === before; i++) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    },
    posted,
  };
}

beforeEach(() => {
  jest.resetModules();
  mockResampleSoxr.mockClear();
});

describe('pcm-worker resample', () => {
  it('resamples both channels at the requested rates and posts them back', async () => {
    const {send, posted} = await loadWorker();

    await send({
      type: 'resample',
      left: new Float32Array([1, 2, 3, 4]),
      right: new Float32Array([5, 6, 7, 8]),
      inRate: 48000,
      outRate: 44100,
    });

    expect(mockResampleSoxr).toHaveBeenCalledTimes(2);
    expect(mockResampleSoxr.mock.calls[0].slice(1)).toEqual([48000, 44100]);
    expect(mockResampleSoxr.mock.calls[1].slice(1)).toEqual([48000, 44100]);

    expect(posted).toHaveLength(1);
    const msg = posted[0].msg;
    expect(msg.type).toBe('resampled');
    if (msg.type !== 'resampled') throw new Error('unreachable');
    const ratio = 44100 / 48000;
    expect(Array.from(msg.left)).toEqual(
      Array.from(new Float32Array([1, 2, 3, 4].map(v => v * ratio))),
    );
    expect(Array.from(msg.right)).toEqual(
      Array.from(new Float32Array([5, 6, 7, 8].map(v => v * ratio))),
    );
    // Both output buffers are transferred, not copied.
    expect(posted[0].transfer).toEqual([msg.left.buffer, msg.right.buffer]);
  });

  it('reports a failed resample as an error message instead of throwing', async () => {
    mockResampleSoxr.mockRejectedValueOnce(new Error('soxr exploded'));
    const {send, posted} = await loadWorker();

    await send({
      type: 'resample',
      left: new Float32Array([1]),
      right: new Float32Array([2]),
      inRate: 48000,
      outRate: 44100,
    });

    expect(posted[0].msg).toEqual({type: 'error', message: 'soxr exploded'});
  });
});

describe('pcm-worker gzip-stem', () => {
  it('produces the same payload the main thread produced, and it round trips', async () => {
    const left = new Float32Array([0.1, -0.2, 0.3, 0.4, 0.5]);
    const right = new Float32Array([0.9, 0.8, -0.7, 0.6, 0.5]);
    const expected = await encodeStemCacheBytes({
      left: left.slice(),
      right: right.slice(),
    });

    const {send, posted} = await loadWorker();
    await send({type: 'gzip-stem', left, right});

    const msg = posted[0].msg;
    expect(msg.type).toBe('gzipped');
    if (msg.type !== 'gzipped') throw new Error('unreachable');
    expect(Array.from(msg.bytes)).toEqual(Array.from(expected));

    const decoded = await decodeStemCacheBytesAuto(
      msg.bytes as Uint8Array<ArrayBuffer>,
    );
    expect(Array.from(decoded!.left)).toEqual(Array.from(left));
    expect(Array.from(decoded!.right)).toEqual(Array.from(right));
  });

  it('echoes the input channels back so the caller keeps the stem it transferred', async () => {
    const left = new Float32Array([1, 2, 3]);
    const right = new Float32Array([4, 5, 6]);
    const {send, posted} = await loadWorker();

    await send({type: 'gzip-stem', left, right});

    const msg = posted[0].msg;
    if (msg.type !== 'gzipped') throw new Error('unreachable');
    expect(Array.from(msg.left)).toEqual([1, 2, 3]);
    expect(Array.from(msg.right)).toEqual([4, 5, 6]);
    expect(posted[0].transfer).toEqual([
      msg.bytes.buffer,
      msg.left.buffer,
      msg.right.buffer,
    ]);
  });

  it('transfers a shared mono buffer only once', async () => {
    const mono = new Float32Array([1, 2, 3]);
    const {send, posted} = await loadWorker();

    await send({type: 'gzip-stem', left: mono, right: mono});

    const msg = posted[0].msg;
    if (msg.type !== 'gzipped') throw new Error('unreachable');
    expect(posted[0].transfer).toEqual([msg.bytes.buffer, msg.left.buffer]);
  });
});
