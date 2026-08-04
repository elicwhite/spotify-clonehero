/**
 * The main-thread seam onto `pcm-worker.ts`: the client posts one job,
 * transfers the PCM in rather than copying it, and follows the shared
 * one-shot cancellation contract (`lib/workers/abortable-worker.ts`).
 *
 * The worker is injected via `createWorker`, mirroring
 * `separate-stems-cancel.test.ts`'s FakeWorker convention - no real
 * Worker/module-URL environment needed.
 */

import {
  encodeStemCacheBytesInWorker,
  resampleStereoInWorker,
} from '@/lib/audio-pipeline/pcm-client';
import type {PcmWorkerMessage} from '@/lib/audio-pipeline/pcm-worker';

class FakeWorker {
  onmessage: ((e: {data: PcmWorkerMessage}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: {msg: any; transfer: Transferable[]}[] = [];
  terminated = false;

  postMessage(msg: any, transfer: Transferable[]) {
    this.posted.push({msg, transfer});
  }
  terminate() {
    this.terminated = true;
  }
  emit(msg: PcmWorkerMessage) {
    this.onmessage?.({data: msg});
  }
}

function spawner(): {factory: () => Worker; worker: () => FakeWorker} {
  let created: FakeWorker | null = null;
  return {
    factory: () => {
      created = new FakeWorker();
      return created as unknown as Worker;
    },
    worker: () => created!,
  };
}

describe('resampleStereoInWorker', () => {
  it('posts one resample job with both channel buffers transferred', async () => {
    const {factory, worker} = spawner();
    const left = new Float32Array([1, 2]);
    const right = new Float32Array([3, 4]);

    const promise = resampleStereoInWorker(left, right, 48000, 44100, {
      createWorker: factory,
    });
    const {msg, transfer} = worker().posted[0];
    expect(msg).toMatchObject({
      type: 'resample',
      inRate: 48000,
      outRate: 44100,
    });
    expect(transfer).toEqual([left.buffer, right.buffer]);

    worker().emit({
      type: 'resampled',
      left: new Float32Array([5, 6]),
      right: new Float32Array([7, 8]),
    });
    await expect(promise).resolves.toEqual({
      left: new Float32Array([5, 6]),
      right: new Float32Array([7, 8]),
    });
    expect(worker().terminated).toBe(true);
  });

  it('transfers a shared mono buffer only once', async () => {
    const {factory, worker} = spawner();
    const mono = new Float32Array([1, 2]);

    const promise = resampleStereoInWorker(mono, mono, 48000, 44100, {
      createWorker: factory,
    });
    expect(worker().posted[0].transfer).toEqual([mono.buffer]);

    worker().emit({
      type: 'resampled',
      left: new Float32Array([1]),
      right: new Float32Array([1]),
    });
    await promise;
  });

  it('rejects with the worker-reported error', async () => {
    const {factory, worker} = spawner();
    const promise = resampleStereoInWorker(
      new Float32Array(1),
      new Float32Array(1),
      48000,
      44100,
      {createWorker: factory},
    );
    worker().emit({type: 'error', message: 'soxr exploded'});
    await expect(promise).rejects.toThrow('soxr exploded');
    expect(worker().terminated).toBe(true);
  });

  it('never spawns a worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;

    await expect(
      resampleStereoInWorker(
        new Float32Array(1),
        new Float32Array(1),
        48000,
        44100,
        {
          createWorker: () => {
            spawned = true;
            return new FakeWorker() as unknown as Worker;
          },
          signal: controller.signal,
        },
      ),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(spawned).toBe(false);
  });

  it('terminates the worker and rejects AbortError when aborted mid-job', async () => {
    const {factory, worker} = spawner();
    const controller = new AbortController();
    const promise = resampleStereoInWorker(
      new Float32Array(1),
      new Float32Array(1),
      48000,
      44100,
      {createWorker: factory, signal: controller.signal},
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({name: 'AbortError'});
    expect(worker().terminated).toBe(true);
  });
  it('rejects rather than hanging when the worker answers with the wrong job', async () => {
    const {factory, worker} = spawner();
    const promise = resampleStereoInWorker(
      new Float32Array(1),
      new Float32Array(1),
      48000,
      44100,
      {createWorker: factory},
    );
    worker().emit({
      type: 'gzipped',
      bytes: new Uint8Array([1]),
      left: new Float32Array(1),
      right: new Float32Array(1),
    });
    await expect(promise).rejects.toThrow(/Unexpected PCM worker message/);
  });
});

describe('encodeStemCacheBytesInWorker', () => {
  it('transfers the stem in and hands back the echoed channels, not the detached originals', async () => {
    const {factory, worker} = spawner();
    const left = new Float32Array([1, 2]);
    const right = new Float32Array([3, 4]);

    const promise = encodeStemCacheBytesInWorker(
      {left, right},
      {createWorker: factory},
    );
    const {msg, transfer} = worker().posted[0];
    expect(msg.type).toBe('gzip-stem');
    expect(transfer).toEqual([left.buffer, right.buffer]);

    const echoedLeft = new Float32Array([1, 2]);
    const echoedRight = new Float32Array([3, 4]);
    worker().emit({
      type: 'gzipped',
      bytes: new Uint8Array([31, 139]),
      left: echoedLeft,
      right: echoedRight,
    });

    const result = await promise;
    expect(result.bytes).toEqual(new Uint8Array([31, 139]));
    expect(result.stem.left).toBe(echoedLeft);
    expect(result.stem.right).toBe(echoedRight);
    expect(worker().terminated).toBe(true);
  });

  it('rejects with the worker-reported error', async () => {
    const {factory, worker} = spawner();
    const promise = encodeStemCacheBytesInWorker(
      {left: new Float32Array(1), right: new Float32Array(1)},
      {createWorker: factory},
    );
    worker().emit({type: 'error', message: 'gzip failed'});
    await expect(promise).rejects.toThrow('gzip failed');
  });

  it('rejects rather than hanging when the worker answers with the wrong job', async () => {
    const {factory, worker} = spawner();
    const promise = encodeStemCacheBytesInWorker(
      {left: new Float32Array(1), right: new Float32Array(1)},
      {createWorker: factory},
    );
    worker().emit({
      type: 'resampled',
      left: new Float32Array(1),
      right: new Float32Array(1),
    });
    await expect(promise).rejects.toThrow(/Unexpected PCM worker message/);
  });
});
