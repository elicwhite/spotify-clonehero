/**
 * The tempo pipeline caches the vocals its BS-Roformer pass produced (plan
 * 0108). This is what puts a Vocals track on `/chart-editor`'s mixer for a
 * song the tempo map separated, so what matters here is not only that the
 * entry is written but that it is written BEFORE the run reports success —
 * `useSeparatedStems` re-probes the cache at exactly that moment.
 */

import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import {
  computeStemFingerprint,
  hasStemOpus,
  loadStemOpus,
  ROFORMER_SEPARATOR_ID,
} from '@/lib/audio-pipeline/stem-cache';
import {VOCALS_STEM} from '@/lib/audio-pipeline/separate-stems';
import {installFakeOPFS} from '../../drum-transcription/storage/__tests__/fake-opfs';
import type {PipelineWorkerMessage, PipelineResult} from '../types';

// WebCodecs Opus encoding does not exist under jsdom; the encoded bytes are
// opaque to this module either way — it stores whatever the encoder returns.
// `jest.mock`'s first argument is a bare string Jest resolves directly (SWC
// hoists the call above the imports, so a path alias is not available yet).
const OPUS_SENTINEL = [0x4f, 0x67, 0x67, 0x53];
const mockEncodePcmToOpus = jest.fn(
  async (_interleaved: Float32Array, _sampleRate: number, _channels: number) =>
    Uint8Array.from(OPUS_SENTINEL),
);
jest.mock('../../audio/opus-encoder', () => ({
  isOpusEncodeSupported: () => true,
  encodePcmToOpus: (...args: [Float32Array, number, number]) =>
    mockEncodePcmToOpus(...args),
}));

class FakeWorker {
  onmessage: ((e: {data: PipelineWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  terminated = false;

  postMessage() {}
  terminate() {
    this.terminated = true;
  }

  emit(msg: PipelineWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

function makeResult(): PipelineResult {
  return {
    kind: 'tempo-map',
    synctrack: {origin_ms: 0, tempos: [], timeSignatures: []},
    sections: null,
    drumOnsetOffsetMs: null,
    fullMixBeatCount: 0,
    drumStemBeatCount: 0,
    meterStats: null,
    drumStemStereo: {left: new Float32Array(1), right: new Float32Array(1)},
  };
}

const PCM = () => ({
  left: new Float32Array([1, 2]),
  right: new Float32Array([3, 4]),
  sampleRate: 44100,
});

const SOURCE_BYTES = new Uint8Array([9, 8, 7]).buffer;

// Exactly representable in Float32, so the interleave assertion below is
// about ordering rather than rounding.
const VOCALS = {
  left: Float32Array.from([0.5, 0.25]),
  right: Float32Array.from([-0.5, -0.25]),
};

/** Runs the client against a worker that emits `messages` in order. */
async function runWith(
  messages: PipelineWorkerMessage[],
  sourceBytes: ArrayBuffer | null = SOURCE_BYTES,
) {
  let worker: FakeWorker | null = null;
  const run = runTempoPipelineFromPcm(PCM(), {
    sourceBytes,
    createWorker: () => {
      worker = new FakeWorker();
      return worker as unknown as Worker;
    },
  });
  // The client hashes the source bytes before it spawns anything, so the
  // worker does not exist for the first few ticks of a run that has them.
  while (!worker) await new Promise(resolve => setTimeout(resolve, 0));
  for (const msg of messages) (worker as FakeWorker).emit(msg);
  return {worker: worker as FakeWorker, result: await run};
}

describe('the tempo pipeline client and the separated vocals stem', () => {
  beforeEach(() => {
    installFakeOPFS();
    mockEncodePcmToOpus.mockClear();
  });

  it('caches the vocals under the run fingerprint before it resolves', async () => {
    const fingerprint = await computeStemFingerprint(
      SOURCE_BYTES,
      ROFORMER_SEPARATOR_ID,
    );

    await runWith([
      {type: 'vocals', vocals: VOCALS},
      {type: 'result', result: makeResult()},
    ]);

    // Awaited by the time the caller sees the tempo map, not merely started:
    // the editor probes the cache the moment the run reports success.
    expect(await hasStemOpus(fingerprint, VOCALS_STEM)).toBe(true);
    expect(Array.from((await loadStemOpus(fingerprint, VOCALS_STEM))!)).toEqual(
      OPUS_SENTINEL,
    );
  });

  it('encodes the vocals interleaved, stereo, at the cache sample rate', async () => {
    await runWith([
      {type: 'vocals', vocals: VOCALS},
      {type: 'result', result: makeResult()},
    ]);

    const [interleaved, sampleRate, channels] =
      mockEncodePcmToOpus.mock.calls[0];
    expect(Array.from(interleaved)).toEqual([0.5, -0.5, 0.25, -0.25]);
    expect(sampleRate).toBe(44100);
    expect(channels).toBe(2);
  });

  it('stores nothing when the run separated no vocals', async () => {
    const fingerprint = await computeStemFingerprint(
      SOURCE_BYTES,
      ROFORMER_SEPARATOR_ID,
    );

    await runWith([{type: 'result', result: makeResult()}]);

    expect(mockEncodePcmToOpus).not.toHaveBeenCalled();
    expect(await hasStemOpus(fingerprint, VOCALS_STEM)).toBe(false);
  });

  it('resolves normally when there is no fingerprint to file the vocals under', async () => {
    // A run without source bytes has no cache key at all — the vocals are
    // dropped rather than filed under a wrong one, and the run still returns
    // its tempo map.
    const {result} = await runWith(
      [
        {type: 'vocals', vocals: VOCALS},
        {type: 'result', result: makeResult()},
      ],
      null,
    );

    expect(result.kind).toBe('tempo-map');
    expect(mockEncodePcmToOpus).not.toHaveBeenCalled();
  });
});
