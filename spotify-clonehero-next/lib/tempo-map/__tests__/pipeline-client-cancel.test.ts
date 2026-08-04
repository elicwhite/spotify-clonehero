/**
 * Cancellation contract for runTempoPipelineFromPcm (plan 0074 Design A):
 * an AbortSignal terminates the worker and rejects with an AbortError
 * DOMException; a pre-aborted signal never spawns a worker; normal
 * completion is unaffected; the abort listener is removed on settle so a
 * post-settle abort doesn't leak or throw. Uses the injectable
 * `createWorker` seam (mirrors `separate-stems.ts`'s convention) with a
 * fake Worker standing in for pipeline-worker.ts.
 */

import {runTempoPipelineFromPcm} from '@/lib/tempo-map/pipeline-client';
import type {PipelineWorkerMessage, PipelineResult} from '../types';

class FakeWorker {
  onmessage: ((e: {data: PipelineWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: any[] = [];
  terminated = false;

  postMessage(msg: any) {
    this.posted.push(msg);
  }
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

function makePcmInput() {
  return {
    left: new Float32Array([1, 2]),
    right: new Float32Array([3, 4]),
    sampleRate: 44100,
  };
}

describe('runTempoPipelineFromPcm cancellation', () => {
  it('rejects with AbortError and never spawns a worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    let spawned = false;
    const createWorker = () => {
      spawned = true;
      return new FakeWorker() as unknown as Worker;
    };

    const promise = runTempoPipelineFromPcm(makePcmInput(), {
      createWorker,
      signal: controller.signal,
    });

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(spawned).toBe(false);
  });

  it('terminates the worker and rejects with AbortError when aborted mid-run', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();

    const promise = runTempoPipelineFromPcm(makePcmInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      signal: controller.signal,
    });

    fake!.emit({type: 'progress', stage: 'separate', percent: 0.3});
    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(fake!.terminated).toBe(true);
  });

  it('resolves normally when the run completes without abort', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const result = makeResult();

    const promise = runTempoPipelineFromPcm(makePcmInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      signal: controller.signal,
    });

    fake!.emit({type: 'result', result});

    await expect(promise).resolves.toEqual(result);
    expect(fake!.terminated).toBe(true);
  });

  it('removes the abort listener on settle (no leak, no post-settle throw)', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');
    const result = makeResult();

    const promise = runTempoPipelineFromPcm(makePcmInput(), {
      createWorker: () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
      signal: controller.signal,
    });

    fake!.emit({type: 'result', result});
    await promise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    // A post-settle abort must not terminate an already-terminated worker
    // again or throw an unhandled rejection.
    expect(() => controller.abort()).not.toThrow();
    expect(fake!.terminated).toBe(true);
  });

  it('defaults createWorker to the real pipeline-worker.ts when omitted', async () => {
    // Spawning the real worker isn't exercisable in jsdom; this only
    // asserts the default path is reachable (module loads, function is
    // callable) without a createWorker override, by checking the export
    // used as the default exists and is a function.
    const mod = await import('@/lib/tempo-map/pipeline-client');
    expect(typeof mod.defaultCreateWorker).toBe('function');
  });
});
