/**
 * Message-protocol tests for runSeparationInWorker (plan 0063 Round 2 #1):
 * separateDrums must not run ONNX inference on the main thread. This checks
 * the client's Worker wiring — progress forwarding, result resolution, error
 * rejection, and termination — using a fake Worker standing in for
 * ml/separation-worker.ts (no real Worker/module-URL environment needed).
 */

import {runSeparationInWorker} from '../roformer-separation';
import type {SeparationWorkerMessage} from '../separation-worker';

/** A controllable fake worker responding to the separation-worker.ts protocol. */
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

describe('runSeparationInWorker', () => {
  it('forwards progress, resolves with the result, and terminates the worker', async () => {
    let fake: FakeWorker;
    const progress: any[] = [];
    const left = new Float32Array([1, 2]);
    const right = new Float32Array([3, 4]);

    const resultPromise = runSeparationInWorker(
      left,
      right,
      p => progress.push(p),
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    );

    // Worker was spawned and the transferred buffers posted as a 'run' message.
    expect(fake!.posted).toHaveLength(1);
    expect(fake!.posted[0].type).toBe('run');
    expect(fake!.posted[0].left).toBe(left);
    expect(fake!.posted[0].right).toBe(right);

    fake!.emit({type: 'progress', step: 'loading-model', percent: 0.5});
    fake!.emit({
      type: 'progress',
      step: 'processing',
      percent: 0.2,
      etaSeconds: 10,
    });

    const drumsLeft = new Float32Array([5, 6]);
    const drumsRight = new Float32Array([7, 8]);
    const vocalsLeft = new Float32Array([9, 10]);
    const vocalsRight = new Float32Array([11, 12]);
    fake!.emit({
      type: 'result',
      drumsLeft,
      drumsRight,
      vocalsLeft,
      vocalsRight,
    });

    const result = await resultPromise;
    expect(result).toEqual({drumsLeft, drumsRight, vocalsLeft, vocalsRight});
    expect(fake!.terminated).toBe(true);
    expect(progress).toEqual([
      {step: 'loading-model', percent: 0.5, etaSeconds: undefined},
      {step: 'processing', percent: 0.2, etaSeconds: 10},
    ]);
  });

  it('rejects and terminates the worker on an error message', async () => {
    let fake: FakeWorker;
    const resultPromise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    );

    fake!.emit({type: 'error', message: 'boom'});

    await expect(resultPromise).rejects.toThrow('boom');
    expect(fake!.terminated).toBe(true);
  });

  it('rejects and terminates the worker on onerror', async () => {
    let fake: FakeWorker;
    const resultPromise = runSeparationInWorker(
      new Float32Array(1),
      new Float32Array(1),
      undefined,
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    );

    fake!.onerror?.({message: 'worker crashed'});

    await expect(resultPromise).rejects.toThrow('worker crashed');
    expect(fake!.terminated).toBe(true);
  });
});
