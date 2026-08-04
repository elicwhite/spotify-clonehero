/**
 * Cancellation contract for the roformer separation path (plan 0074 Design
 * A). Two layers:
 *
 * - `runSeparationInWorker`: signal aborts terminate the worker and reject
 *   AbortError; a pre-aborted signal never spawns a worker; the abort
 *   listener is removed on settle.
 * - `separateStems`: threads `opts.signal` through to the worker AND
 *   guarantees no cache store happens once aborted, even if abort lands
 *   after separation finishes but before the store step (checked via the
 *   fake OPFS store staying empty).
 *
 * decode-audio and the opus encoder are mocked out (real decode needs
 * OfflineAudioContext/WebCodecs, unavailable in jsdom); the worker is
 * injected via `createWorker`, mirroring
 * `roformer-separation-worker-client.test.ts`'s FakeWorker convention.
 */

import {
  runSeparationInWorker,
  separateStems,
} from '@/lib/audio-pipeline/separate-stems';
import {encodeStemCacheBytes} from '@/lib/audio-pipeline/stem-cache';
import type {SeparationWorkerMessage} from '@/lib/drum-transcription/ml/separation-worker';
import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';

jest.mock('../decode-audio', () => ({
  decodeAndResampleTo44k: jest.fn(async () => {
    const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const right = new Float32Array([0.5, 0.6, 0.7, 0.8]);
    return {
      length: left.length,
      numberOfChannels: 2,
      getChannelData: (ch: number) => (ch === 0 ? left : right),
    } as unknown as AudioBuffer;
  }),
}));

jest.mock('../../audio/opus-encoder', () => ({
  encodePcmToOpus: jest.fn(async () => new Uint8Array([1, 2, 3, 4])),
}));

class FakeWorker {
  onmessage: ((e: {data: SeparationWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: any[] = [];
  terminated = false;

  postMessage(msg: any) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }

  emit(msg: SeparationWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

/** Stand-in for `pcm-worker.ts`: runs the real gzip so what lands in the
 *  fake OPFS is a payload `loadStem` can actually decode. */
function createPcmWorker(): Worker {
  const worker = {
    onmessage: null as ((e: {data: unknown}) => void) | null,
    onerror: null,
    terminate() {},
    postMessage(req: {type: string; left: Float32Array; right: Float32Array}) {
      void (async () => {
        const bytes = await encodeStemCacheBytes({
          left: req.left,
          right: req.right,
        });
        worker.onmessage?.({
          data: {type: 'gzipped', bytes, left: req.left, right: req.right},
        });
      })();
    },
  };
  return worker as unknown as Worker;
}

function fakeResult(): SeparationWorkerMessage {
  return {
    type: 'result',
    drumsLeft: new Float32Array([1, 2, 3, 4]),
    drumsRight: new Float32Array([5, 6, 7, 8]),
    vocalsLeft: new Float32Array([9, 10, 11, 12]),
    vocalsRight: new Float32Array([13, 14, 15, 16]),
  };
}

describe('runSeparationInWorker cancellation', () => {
  it('rejects with AbortError and never spawns a worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;

    const promise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        spawned = true;
        return new FakeWorker() as unknown as Worker;
      },
      controller.signal,
    );

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(spawned).toBe(false);
  });

  it('terminates the worker and rejects with AbortError when aborted mid-run', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();

    const promise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      controller.signal,
    );

    fake!.emit({type: 'progress', step: 'processing', percent: 0.4});
    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(fake!.terminated).toBe(true);
  });

  it('resolves normally when the run completes without abort', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const result = fakeResult();

    const promise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      controller.signal,
    );

    fake!.emit(result);

    await expect(promise).resolves.toMatchObject({
      drumsLeft: (result as any).drumsLeft,
    });
    expect(fake!.terminated).toBe(true);
  });

  it('removes the abort listener on settle', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');

    const promise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      controller.signal,
    );

    fake!.emit(fakeResult());
    await promise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(() => controller.abort()).not.toThrow();
  });
});

describe('separateStems cancellation', () => {
  let fakeWorker: FakeWorker | null;
  let originalWorker: typeof Worker | undefined;
  let opfsStore: Map<string, ArrayBuffer>;

  beforeEach(() => {
    opfsStore = installFakeOPFS().store;
    fakeWorker = null;
    originalWorker = (globalThis as any).Worker;
    // separateStems doesn't expose a createWorker seam of its own; it
    // always spawns through defaultCreateSeparationWorker. Stub the
    // global Worker constructor so that spawn is observable/controllable
    // without a real Worker/module-URL environment.
    (globalThis as any).Worker = class {
      constructor() {
        fakeWorker = new FakeWorker();
        return fakeWorker as unknown as Worker;
      }
    };
  });

  afterEach(() => {
    (globalThis as any).Worker = originalWorker;
  });

  it('rejects with AbortError and never spawns a worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const promise = separateStems(new Uint8Array([1, 2, 3]), {
      drums: true,
      vocals: true,
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(fakeWorker).toBeNull();
  });

  /** Waits (real timers, not just microtask flushes — the cache-probe and
   * decode chain crosses macrotask boundaries) until the fake worker has
   * been spawned. */
  async function waitForWorker(): Promise<void> {
    for (let i = 0; i < 200 && fakeWorker == null; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  it('terminates the worker, rejects AbortError, and stores nothing when aborted mid-separation', async () => {
    const controller = new AbortController();

    const promise = separateStems(new Uint8Array([1, 2, 3]), {
      drums: true,
      vocals: true,
      signal: controller.signal,
    });

    // Let the decode + worker-spawn microtasks run before aborting.
    await waitForWorker();

    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(fakeWorker?.terminated).toBe(true);
    expect(opfsStore.size).toBe(0);
  });

  it('rejects AbortError and stores nothing when aborted after separation finishes but before the store step', async () => {
    const controller = new AbortController();

    const promise = separateStems(new Uint8Array([1, 2, 3]), {
      drums: true,
      vocals: true,
      signal: controller.signal,
    });

    await waitForWorker();

    // The worker delivers its result (resolving runSeparationInWorker),
    // then abort lands synchronously before the queued continuation
    // reaches storeStem/storeStemOpus.
    fakeWorker!.emit(fakeResult());
    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(opfsStore.size).toBe(0);
  });

  it('completes and caches normally when not aborted', async () => {
    const controller = new AbortController();

    const promise = separateStems(new Uint8Array([1, 2, 3]), {
      drums: true,
      vocals: true,
      signal: controller.signal,
      createPcmWorker,
    });

    await waitForWorker();

    fakeWorker!.emit(fakeResult());

    const result = await promise;
    expect(result.drums).toBeDefined();
    expect(result.vocals).toBeDefined();
    expect(opfsStore.size).toBeGreaterThan(0);

    // A repeat call now hits the cache and never spawns a second worker.
    fakeWorker = null;
    const second = await separateStems(new Uint8Array([1, 2, 3]), {
      drums: true,
      vocals: true,
      createPcmWorker,
    });
    expect(second.drums).toBeDefined();
    expect(fakeWorker).toBeNull();
  });
});
