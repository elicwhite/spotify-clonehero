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

/** Spawn N STFT workers and return a queryable handle. `createWorker` is an
 * injectable factory (defaults to the real `stft-worker.ts`) so tests can
 * substitute a fake Worker without a real Worker/module-URL environment. */
function spawnWorkerPool(n: number, createWorker: () => Worker) {
  const workers = Array.from({length: n}, () => createWorker());
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

/** Spawns the real `stft-worker.ts` module worker. */
function defaultCreateWorker(): Worker {
  return new Worker(new URL('./stft-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export interface SeparateDrumStemOptions {
  ort: typeof ortTypes;
  left: Float32Array;
  right: Float32Array;
  session: ortTypes.InferenceSession;
  onProgress?: (p: SeparationProgress) => void;
  overlapFrac?: number;
  numWorkers?: number;
  /**
   * Output shape:
   * - 'mono' (default): mean(L,R) mono PCM at 44.1 kHz, used by the
   *   tempo-map pipeline.
   * - 'stereo': planar left/right Float32Arrays at 44.1 kHz (used by the
   *   drum-transcription pipeline, whose CRNN consumes stereo mels).
   */
  output?: 'mono' | 'stereo';
  /**
   * Also separate + return the vocals stem (`output: 'stereo'` only). The
   * tempo-map pipeline's mono-drums-only callers leave this off — the model
   * still emits all six stems either way, but the extra vocals iSTFT is only
   * paid for when requested.
   */
  includeVocals?: boolean;
  /** Injectable Worker factory; defaults to the real stft-worker. Test seam. */
  createWorker?: () => Worker;
}

export interface StereoDrumStem {
  left: Float32Array;
  right: Float32Array;
}

export interface StereoStemsWithVocals extends StereoDrumStem {
  vocals: StereoDrumStem;
}

/**
 * Separate the drum stem from stereo 44.1 kHz audio. Returns mean(L,R) mono
 * PCM at 44.1 kHz by default, or planar L/R when `output: 'stereo'` (plus a
 * planar vocals stem when `includeVocals: true`). Stems other than the ones
 * requested are discarded to free memory.
 */
export async function separateDrumStem(
  opts: SeparateDrumStemOptions & {output?: 'mono'},
): Promise<Float32Array>;
export async function separateDrumStem(
  opts: SeparateDrumStemOptions & {output: 'stereo'; includeVocals?: false},
): Promise<StereoDrumStem>;
export async function separateDrumStem(
  opts: SeparateDrumStemOptions & {output: 'stereo'; includeVocals: true},
): Promise<StereoStemsWithVocals>;
export async function separateDrumStem({
  ort,
  left,
  right,
  session,
  onProgress,
  overlapFrac = 0.25,
  numWorkers = 2,
  output = 'mono',
  includeVocals = false,
  createWorker = defaultCreateWorker,
}: SeparateDrumStemOptions): Promise<
  Float32Array | StereoDrumStem | StereoStemsWithVocals
> {
  const N = left.length;
  const OVERLAP = Math.floor(CHUNK_SAMPLES * overlapFrac);
  const STEP = CHUNK_SAMPLES - OVERLAP;
  const numSegments = Math.max(1, Math.ceil((N - OVERLAP) / STEP));

  // Only the requested accumulators are kept full-length; the other stems
  // are mixed into a scratch buffer we never read, but the model emits all
  // six so we simply skip writing them.
  const drums = new Float32Array(2 * N);
  const vocals = includeVocals ? new Float32Array(2 * N) : null;
  const {fadeIn, fadeOut} = makeFades(OVERLAP);
  const pool = spawnWorkerPool(numWorkers, createWorker);
  const DRUM_STEM_INDEX = STEM_NAMES.indexOf('drums');
  const VOCALS_STEM_INDEX = STEM_NAMES.indexOf('vocals');
  const stemIndices = includeVocals
    ? [DRUM_STEM_INDEX, VOCALS_STEM_INDEX]
    : [DRUM_STEM_INDEX];

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
    // iSTFT only the requested stems (drums, optionally + vocals) — we drop
    // the rest, so don't pay to invert them. Batched into one istft-batch
    // call per segment (numStems = stemIndices.length).
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
      const realBatch = new Float32Array(stemIndices.length * perStemSize);
      const imagBatch = new Float32Array(stemIndices.length * perStemSize);
      stemIndices.forEach((stemIdx, i) => {
        realBatch.set(
          realArr.subarray(stemIdx * perStemSize, (stemIdx + 1) * perStemSize),
          i * perStemSize,
        );
        imagBatch.set(
          imagArr.subarray(stemIdx * perStemSize, (stemIdx + 1) * perStemSize),
          i * perStemSize,
        );
      });
      return pool
        .send(
          segIdx % pool.n,
          'istft-batch',
          {
            realBuf: realBatch.buffer,
            imagBuf: imagBatch.buffer,
            numStems: stemIndices.length,
            numChannels: NUM_CHANNELS,
            F,
            T,
            length: CHUNK_SAMPLES,
            nFft: N_FFT,
            hopLength: HOP_LENGTH,
            winLength: WIN_LENGTH,
          },
          [realBatch.buffer, imagBatch.buffer],
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

    // Mixes one stem's planar [L, R] chunk (offset `stemOffset` samples into
    // `arr`) into `accum` with overlap-add crossfade weights.
    function mixInto(
      accum: Float32Array,
      arr: Float32Array,
      stemOffset: number,
      segIdx: number,
      segStart: number,
      segLen: number,
    ) {
      const offL = stemOffset;
      const offR = stemOffset + CHUNK_SAMPLES;
      for (let i = 0; i < segLen; i++) {
        const g = segStart + i;
        if (g >= N) break;
        let w = 1;
        if (segIdx > 0 && i < OVERLAP) w = fadeIn[i];
        if (segIdx < numSegments - 1 && i >= CHUNK_SAMPLES - OVERLAP) {
          w = fadeOut[i - (CHUNK_SAMPLES - OVERLAP)];
        }
        accum[g] += arr[offL + i] * w;
        accum[N + g] += arr[offR + i] * w;
      }
    }

    // audioBuf layout is Float32 [numStems, numChannels, length] planar
    // (stft-worker.ts), in the same order as stemIndices (drums, [vocals]).
    function mixSegment({audioBuf, segIdx, segStart, segLen}: any) {
      const arr = new Float32Array(audioBuf);
      const perStemLen = NUM_CHANNELS * CHUNK_SAMPLES;
      mixInto(drums, arr.subarray(0, perStemLen), 0, segIdx, segStart, segLen);
      if (vocals) {
        mixInto(
          vocals,
          arr.subarray(perStemLen, 2 * perStemLen),
          0,
          segIdx,
          segStart,
          segLen,
        );
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
      let realCopy: Float32Array;
      let imagCopy: Float32Array;
      let inferMs: number;
      try {
        const tInfer = performance.now();
        const out = await session.run({spec_real: tIn1, spec_imag: tIn2});
        inferMs = performance.now() - tInfer;

        // .data is a view into ORT-owned memory; .slice() gives an owned buffer
        // we can transfer to the worker without invalidating ORT's pointer.
        realCopy = (out['out_spec_real'].data as Float32Array).slice();
        imagCopy = (out['out_spec_imag'].data as Float32Array).slice();
        out['out_spec_real'].dispose();
        out['out_spec_imag'].dispose();
      } finally {
        tIn1.dispose();
        tIn2.dispose();
      }
      avgInferMs =
        avgInferMs === 0 ? inferMs : avgInferMs * 0.8 + inferMs * 0.2;

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

  // drums/vocals are planar [L0..LN, R0..RN].
  if (output === 'stereo') {
    const drumsOut: StereoDrumStem = {
      left: drums.slice(0, N),
      right: drums.slice(N, 2 * N),
    };
    if (vocals) {
      return {
        ...drumsOut,
        vocals: {left: vocals.slice(0, N), right: vocals.slice(N, 2 * N)},
      };
    }
    return drumsOut;
  }

  // mean(L,R) to mono.
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) mono[i] = (drums[i] + drums[N + i]) * 0.5;
  return mono;
}
