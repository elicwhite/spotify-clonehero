/**
 * The worker boundary for track padding (`pad-tracks-client.ts`): request
 * wire shape, progress passthrough, result, error and cancellation, through
 * the injectable `createWorker` seam with a `FakeWorker` standing in for
 * `pad-tracks-worker.ts` (same convention as
 * `lib/assist/__tests__/difficulty-client.test.ts`).
 *
 * The one contract worth stating twice: the request must CLONE the caller's
 * PCM, never transfer it. `usePaddedAudio` keeps those buffers as the source
 * of every future rebuild, so detaching them would take the audio down.
 */

import type {PadRequest, PadWorkerMessage} from '../pad-tracks';
import {padTracksInWorker} from '../pad-tracks-client';
import {isAbortError} from '@/lib/workers/abortable-worker';

class FakeWorker {
  onmessage: ((e: {data: PadWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: Array<{request: PadRequest; transfer: unknown}> = [];
  terminated = false;

  postMessage(request: PadRequest, transfer?: unknown) {
    this.posted.push({request, transfer});
  }
  terminate() {
    this.terminated = true;
  }
  emit(message: PadWorkerMessage) {
    this.onmessage?.({data: message});
  }
}

const PARAMS = {padSamples: 8, channels: 2};

function spawn(): {createWorker: () => Worker; worker: () => FakeWorker} {
  let made: FakeWorker | undefined;
  return {
    createWorker: () => {
      made = new FakeWorker();
      return made as unknown as Worker;
    },
    worker: () => made!,
  };
}

describe('padTracksInWorker', () => {
  it('posts the tracks with no transfer list, so the caller keeps its PCM', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const {createWorker, worker} = spawn();
    const promise = padTracksInWorker([{name: 'song', pcm}], {
      ...PARAMS,
      createWorker,
    });

    const {request, transfer} = worker().posted[0];
    expect(request.type).toBe('pad');
    expect(request.padSamples).toBe(8);
    expect(request.tracks.map(t => t.name)).toEqual(['song']);
    expect(transfer).toBeUndefined();
    // Not detached: still readable on this side.
    expect(pcm.length).toBe(4);

    worker().emit({type: 'result', tracks: []});
    await promise;
  });

  it('forwards progress events and resolves with the worker result', async () => {
    const seen: number[] = [];
    const {createWorker, worker} = spawn();
    const promise = padTracksInWorker(
      [{name: 'song', pcm: new Float32Array(4)}],
      {
        ...PARAMS,
        createWorker,
        onProgress: p => seen.push(p.completed),
      },
    );

    worker().emit({type: 'progress', completed: 1, total: 2, name: 'song'});
    worker().emit({type: 'progress', completed: 2, total: 2, name: 'drums'});
    const padded = [{name: 'song', paddedPcm: new Float32Array(2)}];
    worker().emit({type: 'result', tracks: padded});

    await expect(promise).resolves.toEqual(padded);
    expect(seen).toEqual([1, 2]);
    expect(worker().terminated).toBe(true);
  });

  it('rejects with the worker error message', async () => {
    const {createWorker, worker} = spawn();
    const promise = padTracksInWorker(
      [{name: 'song', pcm: new Float32Array(4)}],
      {...PARAMS, createWorker},
    );
    worker().emit({type: 'error', message: 'out of memory'});
    await expect(promise).rejects.toThrow('out of memory');
    expect(worker().terminated).toBe(true);
  });

  it('rejects an already-aborted signal without spawning a worker', async () => {
    const controller = new AbortController();
    controller.abort();
    const createWorker = jest.fn(() => {
      throw new Error('should not spawn');
    });
    await expect(
      padTracksInWorker([{name: 'song', pcm: new Float32Array(4)}], {
        ...PARAMS,
        createWorker,
        signal: controller.signal,
      }).catch(isAbortError),
    ).resolves.toBe(true);
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('terminates the worker and rejects as AbortError when cancelled mid-run', async () => {
    const controller = new AbortController();
    const {createWorker, worker} = spawn();
    const promise = padTracksInWorker(
      [{name: 'song', pcm: new Float32Array(4)}],
      {...PARAMS, createWorker, signal: controller.signal},
    );
    controller.abort();
    await expect(promise.catch(isAbortError)).resolves.toBe(true);
    expect(worker().terminated).toBe(true);
  });

  it('runs inline, with the same result, where there is no Worker', async () => {
    const pcm = new Float32Array([0.5, -0.5]);
    const padded = await padTracksInWorker([{name: 'song', pcm}], {
      padSamples: 1,
      channels: 2,
      createWorker: null,
    });
    expect(padded).toHaveLength(1);
    expect(padded[0].paddedPcm.length).toBe(4);
  });
});
