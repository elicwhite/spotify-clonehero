/**
 * Option-plumbing tests for separateDrumStem (plan 0063 Part B): the
 * `includeVocals` option threads through to a batched istft-batch call and
 * splits the result into separate drums/vocals accumulators. The actual STFT
 * math is faked out (a fixed synthetic response per stem) — this only checks
 * the wiring, not the DSP (which has no existing test coverage to piggyback
 * on, contrary to the plan's assumption).
 */

import {separateDrumStem, STEM_NAMES} from '../stem-separation';

const NUM_CHANNELS = 2;
const F = 2;
const T = 2;

/** A controllable fake worker responding to the stft-worker.ts protocol. */
class FakeWorker {
  private listeners: Array<(e: {data: any}) => void> = [];
  posted: any[] = [];
  addEventListener(type: string, cb: (e: {data: any}) => void) {
    if (type === 'message') this.listeners.push(cb);
  }
  postMessage(msg: any) {
    this.posted.push(msg);
    queueMicrotask(() => {
      const reply = this.respond(msg);
      for (const cb of this.listeners) cb({data: reply});
    });
  }
  terminate() {}

  private respond(msg: any) {
    if (msg.type === 'stft') {
      return {
        id: msg.id,
        type: 'stft',
        realBuf: new Float32Array(NUM_CHANNELS * F * T).buffer,
        imagBuf: new Float32Array(NUM_CHANNELS * F * T).buffer,
        F,
        T,
      };
    }
    // istft-batch: synthesize a distinguishable constant per (stem, channel)
    // — stem s, channel c => value (s+1)*10 + c — so the caller's per-stem
    // split can be verified without real FFT math.
    const {numStems, numChannels, length} = msg;
    const audio = new Float32Array(numStems * numChannels * length);
    for (let s = 0; s < numStems; s++) {
      for (let c = 0; c < numChannels; c++) {
        const val = (s + 1) * 10 + c;
        const off = s * numChannels * length + c * length;
        audio.fill(val, off, off + length);
      }
    }
    return {
      id: msg.id,
      type: 'istft-batch',
      audioBuf: audio.buffer,
      numStems,
      numChannels,
      length,
    };
  }
}

/** A fake onnxruntime-web module: Tensor is a plain holder, session.run
 * returns a fixed 6-stem spectrum (content is irrelevant — FakeWorker's
 * istft-batch response ignores it and returns synthetic per-stem values). */
function fakeOrt() {
  class FakeTensor {
    constructor(
      public type: string,
      public data: Float32Array,
      public dims: number[],
    ) {}
    dispose() {}
  }
  const perStemSize = NUM_CHANNELS * F * T;
  const sixStems = new Float32Array(STEM_NAMES.length * perStemSize);
  const session = {
    run: jest.fn(async () => ({
      out_spec_real: {data: sixStems, dispose: () => {}},
      out_spec_imag: {data: sixStems, dispose: () => {}},
    })),
  };
  return {ort: {Tensor: FakeTensor} as any, session: session as any};
}

// Small enough that N < CHUNK_SAMPLES, so separateDrumStem always computes
// exactly one segment (numSegments = max(1, ...) clamps to 1) — no overlap
// crossfade weighting to account for in assertions.
const N = 8;

describe('separateDrumStem includeVocals plumbing', () => {
  it('mono (default): unaffected, no vocals field, single-stem istft batches', async () => {
    const {ort, session} = fakeOrt();
    const workers: FakeWorker[] = [];
    const result = await separateDrumStem({
      ort,
      left: new Float32Array(N),
      right: new Float32Array(N),
      session,
      numWorkers: 1,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });

    expect(result).toBeInstanceOf(Float32Array);
    expect((result as Float32Array).length).toBe(N);
    // mean(L,R): drums is batch position 0 => value (0+1)*10+c = 10 or 11.
    expect(result[0]).toBeCloseTo((10 + 11) / 2);

    const istftMsgs = workers[0].posted.filter(m => m.type === 'istft-batch');
    expect(istftMsgs).toHaveLength(1);
    expect(istftMsgs[0].numStems).toBe(1);
  });

  it('stereo without includeVocals: StereoDrumStem, no vocals field', async () => {
    const {ort, session} = fakeOrt();
    const workers: FakeWorker[] = [];
    const result = await separateDrumStem({
      ort,
      left: new Float32Array(N),
      right: new Float32Array(N),
      session,
      output: 'stereo',
      numWorkers: 1,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });

    expect('vocals' in result).toBe(false);
    expect(result.left[0]).toBeCloseTo(10); // batch position 0 (only stem sent) => drums, channel 0
    expect(result.right[0]).toBeCloseTo(11);

    const istftMsgs = workers[0].posted.filter(m => m.type === 'istft-batch');
    expect(istftMsgs[0].numStems).toBe(1);
  });

  it('stereo + includeVocals: batches 2 stems and splits drums/vocals correctly', async () => {
    const {ort, session} = fakeOrt();
    const workers: FakeWorker[] = [];
    const result = await separateDrumStem({
      ort,
      left: new Float32Array(N),
      right: new Float32Array(N),
      session,
      output: 'stereo',
      includeVocals: true,
      numWorkers: 1,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
    });

    const istftMsgs = workers[0].posted.filter(m => m.type === 'istft-batch');
    expect(istftMsgs[0].numStems).toBe(2);

    // FakeWorker returns batch position 0 => (1)*10+c, position 1 => (2)*10+c,
    // in the order separateDrumStem batched them (drums first, then vocals).
    expect(result.left[0]).toBeCloseTo(10);
    expect(result.right[0]).toBeCloseTo(11);
    expect(result.vocals.left[0]).toBeCloseTo(20);
    expect(result.vocals.right[0]).toBeCloseTo(21);
  });
});
