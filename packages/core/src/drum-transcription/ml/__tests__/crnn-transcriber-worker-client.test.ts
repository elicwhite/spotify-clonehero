/**
 * Message-protocol and cancellation tests for `CrnnTranscriber.transcribe`:
 * inference must not run on the main thread, and aborting a run must
 * terminate the worker and reject with `AbortError` rather than leave it
 * running. Uses a fake Worker standing in for crnn-worker.ts (no real
 * Worker/module-URL environment needed) — same seam and shape as
 * `roformer-separation-worker-client.test.ts` and
 * `lib/lyrics-align/__tests__/demucs-worker-client.test.ts`.
 */

import {CrnnTranscriber} from '../transcriber';

/** A controllable fake worker responding to the crnn-worker.ts protocol. */
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

function makeTranscriber(createWorker: () => Worker) {
  return new CrnnTranscriber(
    'https://example.test/model.onnx',
    ['wasm'],
    createWorker,
  );
}

/** Waits for the worker to be spawned (the thresholds fetch settles first). */
async function waitForWorker(getFake: () => FakeWorker | undefined) {
  for (let i = 0; i < 50 && getFake() === undefined; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

describe('CrnnTranscriber.transcribe', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Thresholds fetch is irrelevant to worker wiring; fail it fast and
    // deterministically so tests aren't racing a real network call.
    global.fetch = jest.fn().mockRejectedValue(new Error('no network'));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards progress, resolves with the result, and terminates the worker', async () => {
    let fake: FakeWorker;
    const progress: any[] = [];
    const stereoAudio = new Float32Array([1, 2, 3, 4]);

    const transcriber = makeTranscriber(() => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(stereoAudio, 48000, p =>
      progress.push(p),
    );

    await waitForWorker(() => fake);

    expect(fake!.posted).toHaveLength(1);
    expect(fake!.posted[0].type).toBe('transcribe');
    expect(fake!.posted[0].stereoAudio).toBe(stereoAudio);

    fake!.emit({type: 'progress', step: 'inference', percent: 0.5});

    const events = [
      {timeSeconds: 0, drumClass: 'BD', midiPitch: 36, confidence: 1},
    ];
    const modelOutput = {
      predictions: new Float32Array(1),
      nFrames: 1,
      nClasses: 1,
    };
    fake!.emit({
      type: 'result',
      events,
      modelOutput,
      durationSeconds: 1,
    });

    const result = await resultPromise;
    expect(result).toEqual({events, modelOutput, durationSeconds: 1});
    expect(fake!.terminated).toBe(true);
    expect(progress).toEqual([
      {step: 'inference', percent: 0.5, detail: undefined},
    ]);
  });

  it('rejects and terminates the worker on an error message', async () => {
    let fake: FakeWorker;
    const transcriber = makeTranscriber(() => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(new Float32Array(2), 48000);
    await waitForWorker(() => fake);

    fake!.emit({type: 'error', message: 'boom'});

    await expect(resultPromise).rejects.toThrow('boom');
    expect(fake!.terminated).toBe(true);
  });

  it('rejects and terminates the worker on onerror', async () => {
    let fake: FakeWorker;
    const transcriber = makeTranscriber(() => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(new Float32Array(2), 48000);
    await waitForWorker(() => fake);

    fake!.onerror?.({message: 'worker crashed'});

    await expect(resultPromise).rejects.toThrow('worker crashed');
    expect(fake!.terminated).toBe(true);
  });

  it('rejects with AbortError before spawning a worker when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = false;

    const transcriber = makeTranscriber(() => {
      spawned = true;
      return new FakeWorker() as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(
      new Float32Array(2),
      48000,
      undefined,
      controller.signal,
    );

    await expect(resultPromise).rejects.toMatchObject({name: 'AbortError'});
    expect(spawned).toBe(false);
  });

  it('terminates the worker and rejects with AbortError when aborted mid-run', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();

    const transcriber = makeTranscriber(() => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(
      new Float32Array(2),
      48000,
      undefined,
      controller.signal,
    );
    await waitForWorker(() => fake);

    fake!.emit({type: 'progress', step: 'inference', percent: 0.1});
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({name: 'AbortError'});
    expect(fake!.terminated).toBe(true);
  });

  it('removes the abort listener once the run settles normally', async () => {
    let fake: FakeWorker;
    const controller = new AbortController();
    const removeSpy = jest.spyOn(controller.signal, 'removeEventListener');

    const transcriber = makeTranscriber(() => {
      fake = new FakeWorker();
      return fake as unknown as Worker;
    });

    const resultPromise = transcriber.transcribe(
      new Float32Array(2),
      48000,
      undefined,
      controller.signal,
    );
    await waitForWorker(() => fake);

    fake!.emit({
      type: 'result',
      events: [],
      modelOutput: {predictions: new Float32Array(0), nFrames: 0, nClasses: 0},
      durationSeconds: 0,
    });
    await resultPromise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(() => controller.abort()).not.toThrow();
  });
});
