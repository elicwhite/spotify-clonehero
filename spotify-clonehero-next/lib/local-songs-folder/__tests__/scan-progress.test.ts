import {describe, test, expect, beforeEach, jest} from '@jest/globals';
import type {coalesceProgress as CoalesceProgress} from '../scan-progress';

// scan-progress captures its scheduler (requestAnimationFrame) at module load,
// so install a controllable rAF before (re)importing the module each test.
describe('coalesceProgress', () => {
  let rafQueue: Array<() => void>;
  let coalesceProgress: typeof CoalesceProgress;

  const flushFrame = () => {
    const queued = rafQueue;
    rafQueue = [];
    queued.forEach(cb => cb());
  };

  beforeEach(() => {
    rafQueue = [];
    (global as {requestAnimationFrame?: unknown}).requestAnimationFrame = (
      cb: () => void,
    ) => {
      rafQueue.push(cb);
      return 0;
    };
    jest.resetModules();
    coalesceProgress = require('../scan-progress').coalesceProgress;
  });

  test('emits at most once per frame with the latest count', () => {
    const onProgress = jest.fn();
    const progress = coalesceProgress(onProgress);

    progress.bump();
    progress.bump();
    progress.bump();
    // Nothing emitted until the scheduled frame fires.
    expect(onProgress).not.toHaveBeenCalled();

    flushFrame();
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(3);
  });

  test('schedules a new frame for ticks after the previous flush', () => {
    const onProgress = jest.fn();
    const progress = coalesceProgress(onProgress);

    progress.bump();
    flushFrame();
    progress.bump();
    progress.bump();
    flushFrame();

    expect(onProgress.mock.calls).toEqual([[1], [3]]);
  });

  test('flush emits the final count immediately', () => {
    const onProgress = jest.fn();
    const progress = coalesceProgress(onProgress);

    progress.bump();
    progress.bump();
    progress.flush();

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenLastCalledWith(2);
  });

  test('never re-emits an unchanged count', () => {
    const onProgress = jest.fn();
    const progress = coalesceProgress(onProgress);

    progress.bump();
    progress.flush();
    // The frame scheduled by bump() still fires, but the count is unchanged.
    flushFrame();
    progress.flush();

    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  test('flush with no ticks does nothing', () => {
    const onProgress = jest.fn();
    coalesceProgress(onProgress).flush();
    expect(onProgress).not.toHaveBeenCalled();
  });
});
