/**
 * bs-roformer-web stem separation, drum stem out.
 *
 * Each chunk runs:  STFT (sub-worker) → ONNX (WebGPU) → iSTFT (sub-worker)
 * with chunk N's STFT and chunk N-1's iSTFT pipelined behind chunk N's GPU
 * run, so the only wall-clock cost is GPU inference itself.
 *
 * Runs inside the pipeline worker (spawns nested STFT workers). The caller
 * provides an already-created ORT session for the 6-stem model.
 */

import type * as ortTypes from 'onnxruntime-web';

// Tied to the BS-Roformer-SW checkpoint and the ONNX trace size
// (176400 samples = 4 s @ 44.1 kHz, T=345).
const CHUNK_SAMPLES = 176400;
const N_FFT = 2048;
const HOP_LENGTH = 512;
const WIN_LENGTH = 2048;
const NUM_CHANNELS = 2;
export const STEM_NAMES = [
  'bass',
  'drums',
  'other',
  'vocals',
  'guitar',
  'piano',
] as const;

export interface SeparationProgress {
  segment: number;
  totalSegments: number;
  inferMs: number;
  etaSec: number;
}

/** Spawn N STFT workers and return a queryable handle. */
function spawnWorkerPool(n: number) {
  const workers = Array.from(
    {length: n},
    () =>
      new Worker(new URL('./stft-worker.ts', import.meta.url), {
        type: 'module',
      }),
  );
  const pending = new Map<number, (data: any) => void>();
  let nextId = 1;
  for (const w of workers) {
    w.addEventListener('message', e => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data);
      }
    });
  }
  function send(
    workerIdx: number,
    type: string,
    payload: Record<string, unknown>,
    transfer: Transferable[],
  ): Promise<any> {
    const id = nextId++;
    return new Promise(resolve => {
      pending.set(id, resolve);
      workers[workerIdx].postMessage({id, type, ...payload}, transfer);
    });
  }
  return {
    n,
    send,
    terminate: () => {
      for (const w of workers) w.terminate();
    },
  };
}

/** Crossfade ramps for the overlap region; fadeIn[k] + fadeOut[k] = 1. */
function makeFades(overlap: number) {
  const fadeIn = new Float32Array(overlap);
  const fadeOut = new Float32Array(overlap);
  for (let i = 0; i < overlap; i++) {
    fadeIn[i] = i / overlap;
    fadeOut[i] = 1 - i / overlap;
  }
  return {fadeIn, fadeOut};
}

/**
 * Separate the drum stem from stereo 44.1 kHz audio. Returns mean(L,R) mono
 * PCM at 44.1 kHz. The other five stems are discarded to free memory.
 */
export async function separateDrumStem({
  ort,
  left,
  right,
  session,
  onProgress,
  overlapFrac = 0.25,
  numWorkers = 2,
}: {
  ort: typeof ortTypes;
  left: Float32Array;
  right: Float32Array;
  session: ortTypes.InferenceSession;
  onProgress?: (p: SeparationProgress) => void;
  overlapFrac?: number;
  numWorkers?: number;
}): Promise<Float32Array> {
  const N = left.length;
  const OVERLAP = Math.floor(CHUNK_SAMPLES * overlapFrac);
  const STEP = CHUNK_SAMPLES - OVERLAP;
  const numSegments = Math.max(1, Math.ceil((N - OVERLAP) / STEP));

  // Only the drums accumulator is kept full-length; the other stems are mixed
  // into a scratch buffer we never read, but the model emits all six so we
  // simply skip writing them.
  const drums = new Float32Array(2 * N);
  const {fadeIn, fadeOut} = makeFades(OVERLAP);
  const pool = spawnWorkerPool(numWorkers);
  const DRUM_STEM_INDEX = STEM_NAMES.indexOf('drums');

  try {
    let stftWorkerIdx = 0;
    const postStft = (planarTA: Float32Array) => {
      const w = stftWorkerIdx++ % pool.n;
      return pool.send(
        w,
        'stft',
        {
          planarBuf: planarTA.buffer,
          nFft: N_FFT,
          hopLength: HOP_LENGTH,
          winLength: WIN_LENGTH,
        },
        [planarTA.buffer],
      );
    };
    // iSTFT only the drum stem — we drop the rest, so don't pay to invert them.
    const postIstftDrums = (
      realArr: Float32Array,
      imagArr: Float32Array,
      F: number,
      T: number,
      segIdx: number,
      segStart: number,
      segLen: number,
    ) => {
      const perStemSize = NUM_CHANNELS * F * T;
      const realSub = realArr
        .subarray(
          DRUM_STEM_INDEX * perStemSize,
          (DRUM_STEM_INDEX + 1) * perStemSize,
        )
        .slice();
      const imagSub = imagArr
        .subarray(
          DRUM_STEM_INDEX * perStemSize,
          (DRUM_STEM_INDEX + 1) * perStemSize,
        )
        .slice();
      return pool
        .send(
          segIdx % pool.n,
          'istft-batch',
          {
            realBuf: realSub.buffer,
            imagBuf: imagSub.buffer,
            numStems: 1,
            numChannels: NUM_CHANNELS,
            F,
            T,
            length: CHUNK_SAMPLES,
            nFft: N_FFT,
            hopLength: HOP_LENGTH,
            winLength: WIN_LENGTH,
          },
          [realSub.buffer, imagSub.buffer],
        )
        .then(reply => ({...reply, segIdx, segStart, segLen}));
    };

    function buildPlanarChunk(segIdx: number) {
      const buf = new Float32Array(CHUNK_SAMPLES * 2);
      const start = segIdx * STEP;
      const len = Math.min(CHUNK_SAMPLES, N - start);
      for (let i = 0; i < len; i++) {
        buf[i] = left[start + i];
        buf[CHUNK_SAMPLES + i] = right[start + i];
      }
      return {buf, start, len};
    }

    function mixSegment({audioBuf, segIdx, segStart, segLen}: any) {
      const arr = new Float32Array(audioBuf);
      const offL = 0;
      const offR = CHUNK_SAMPLES;
      for (let i = 0; i < segLen; i++) {
        const g = segStart + i;
        if (g >= N) break;
        let w = 1;
        if (segIdx > 0 && i < OVERLAP) w = fadeIn[i];
        if (segIdx < numSegments - 1 && i >= CHUNK_SAMPLES - OVERLAP) {
          w = fadeOut[i - (CHUNK_SAMPLES - OVERLAP)];
        }
        drums[g] += arr[offL + i] * w;
        drums[N + g] += arr[offR + i] * w;
      }
    }

    // Prime the pipeline: chunk 0's STFT begins before the loop's first run.
    let stftPromise = (() => {
      const {buf, start, len} = buildPlanarChunk(0);
      return postStft(buf).then(r => ({...r, segStart: start, segLen: len}));
    })();
    let pendingIstft: Promise<any> | null = null;
    let avgInferMs = 0;

    for (let seg = 0; seg < numSegments; seg++) {
      const stft = await stftPromise;
      if (seg + 1 < numSegments) {
        const {buf, start: ns, len: nl} = buildPlanarChunk(seg + 1);
        stftPromise = postStft(buf).then(r => ({
          ...r,
          segStart: ns,
          segLen: nl,
        }));
      }

      const tIn1 = new ort.Tensor('float32', new Float32Array(stft.realBuf), [
        1,
        NUM_CHANNELS,
        stft.F,
        stft.T,
      ]);
      const tIn2 = new ort.Tensor('float32', new Float32Array(stft.imagBuf), [
        1,
        NUM_CHANNELS,
        stft.F,
        stft.T,
      ]);
      const tInfer = performance.now();
      const out = await session.run({spec_real: tIn1, spec_imag: tIn2});
      const inferMs = performance.now() - tInfer;
      avgInferMs =
        avgInferMs === 0 ? inferMs : avgInferMs * 0.8 + inferMs * 0.2;

      // .data is a view into ORT-owned memory; .slice() gives an owned buffer
      // we can transfer to the worker without invalidating ORT's pointer.
      const realCopy = (out.out_spec_real.data as Float32Array).slice();
      const imagCopy = (out.out_spec_imag.data as Float32Array).slice();
      tIn1.dispose();
      tIn2.dispose();
      out.out_spec_real.dispose();
      out.out_spec_imag.dispose();

      if (pendingIstft) mixSegment(await pendingIstft);
      pendingIstft = postIstftDrums(
        realCopy,
        imagCopy,
        stft.F,
        stft.T,
        seg,
        stft.segStart,
        stft.segLen,
      );

      onProgress?.({
        segment: seg + 1,
        totalSegments: numSegments,
        inferMs,
        etaSec: (numSegments - seg - 1) * (avgInferMs / 1000),
      });
    }
    if (pendingIstft) mixSegment(await pendingIstft);
  } finally {
    pool.terminate();
  }

  // drums is planar [L0..LN, R0..RN]; mean(L,R) to mono.
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) mono[i] = (drums[i] + drums[N + i]) * 0.5;
  return mono;
}
