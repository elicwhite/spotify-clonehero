/**
 * Message-protocol tests for runDemucsInWorker: ONNX separation must stay off
 * the main thread, and the client's two-phase handshake with demucs-worker.ts
 * (`load` → `loaded` → `separate` → `result`) has to hold. Uses a fake Worker
 * standing in for the real module worker, so no Worker/module-URL environment
 * is needed — same seam and shape as
 * ml/__tests__/roformer-separation-worker-client.test.ts.
 */

import {runDemucsInWorker} from '@/lib/lyrics-align/demucs-client';

/** A controllable fake worker responding to the demucs-worker.ts protocol. */
class FakeWorker {
  onmessage: ((e: {data: any}) => void) | null = null;
  onerror: ((e: {message?: string}) => void) | null = null;
  posted: any[] = [];
  terminated = false;

  postMessage(msg: any) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }

  emit(msg: any) {
    this.onmessage?.({data: msg});
  }
}

/** Minimal stand-in for the AudioBuffer the page hands the client. */
function fakeAudioBuffer(channels: Float32Array[]): AudioBuffer {
  return {
    length: channels[0].length,
    numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i],
  } as unknown as AudioBuffer;
}

describe('runDemucsInWorker', () => {
  it('loads first, then posts interleaved audio, forwards progress, resolves, and terminates', async () => {
    let fake: FakeWorker;
    const progress: any[] = [];
    const buffer = fakeAudioBuffer([
      new Float32Array([1, 2, 3]),
      new Float32Array([4, 5, 6]),
    ]);

    const resultPromise = runDemucsInWorker(
      buffer,
      p => progress.push(p),
      () => {
        fake = new FakeWorker();
        return fake as unknown as Worker;
      },
    );

    // Phase 1: nothing but the load request until the model reports ready.
    expect(fake!.posted).toEqual([{type: 'load'}]);

    fake!.emit({type: 'progress', message: 'Downloading audio separator...'});
    fake!.emit({type: 'loaded'});

    // Phase 2: the audio goes over interleaved [L0, R0, L1, R1, ...].
    expect(fake!.posted).toHaveLength(2);
    expect(fake!.posted[1].type).toBe('separate');
    expect(fake!.posted[1].numSamples).toBe(3);
    expect(Array.from(fake!.posted[1].audioData as Float32Array)).toEqual([
      1, 4, 2, 5, 3, 6,
    ]);

    fake!.emit({
      type: 'progress',
      message: 'Separating segment 1/2',
      percent: 0.5,
      etaSeconds: 12,
    });

    const vocals16k = new Float32Array([7, 8]);
    fake!.emit({type: 'result', vocals16k});

    await expect(resultPromise).resolves.toBe(vocals16k);
    expect(fake!.terminated).toBe(true);

    // Setup messages carry no percent; the separation message carries both.
    expect(progress).toEqual([
      {message: 'Starting Demucs worker...'},
      {
        message: 'Downloading audio separator...',
        percent: undefined,
        etaSeconds: undefined,
      },
      {message: 'Preparing audio for separation...'},
      {message: 'Separating segment 1/2', percent: 0.5, etaSeconds: 12},
      {message: 'Worker terminated — WASM memory reclaimed'},
    ]);
  });

  it('duplicates the single channel of a mono buffer into both interleaved slots', async () => {
    let fake: FakeWorker;
    const buffer = fakeAudioBuffer([new Float32Array([1, 2])]);

    const resultPromise = runDemucsInWorker(buffer, undefined, () => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    fake!.emit({type: 'loaded'});

    expect(Array.from(fake!.posted[1].audioData as Float32Array)).toEqual([
      1, 1, 2, 2,
    ]);

    fake!.emit({type: 'result', vocals16k: new Float32Array(0)});
    await resultPromise;
  });

  it('rejects and terminates the worker on an error message', async () => {
    let fake: FakeWorker;
    const resultPromise = runDemucsInWorker(
      fakeAudioBuffer([new Float32Array(1)]),
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
    const resultPromise = runDemucsInWorker(
      fakeAudioBuffer([new Float32Array(1)]),
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
