/**
 * Web Worker that runs Demucs separation in its own WASM context. Terminated
 * after use to fully reclaim WASM memory.
 *
 * Reuses the STFT/iSTFT code from lib/drum-transcription/audio/stft.ts.
 *
 * The model emits four sources and the caller says which ones it wants back,
 * because its two callers want different things: vocal alignment wants only
 * the 16 kHz mono vocals, and on-demand stem separation wants full-rate drums
 * and vocals for the mixer. Extracting a source costs one iSTFT pass and one
 * song-length buffer per segment, so an unwanted one is never computed.
 *
 * Messages:
 *   IN:  { type: "load" }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "loaded" }
 *
 *   IN:  { type: "separate", audioData, numSamples, want }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "result", drums?, vocals?, vocals16k? }
 *
 *   OUT: { type: "error", message: string }
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/demucs-worker.ts
 */

import * as ort from 'onnxruntime-web';
import {
  computeSTFT,
  computeISTFT,
  createSTFTBuffers,
  createISTFTBuffers,
  NFFT,
  HOP_LENGTH,
  SEGMENT_SAMPLES,
} from '@/lib/drum-transcription/audio/stft';
import {getCachedModel} from './model-cache';
import {DEMUCS_CACHE_KEY, DEMUCS_MIN_BYTES, MODEL_URLS} from './model-urls';

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const DEMUCS_MODEL_URL = MODEL_URLS.demucs;
const SAMPLE_RATE = 44100;
/** htdemucs emits its four sources in this order. */
const SOURCE_INDEX = {drums: 0, bass: 1, other: 2, vocals: 3} as const;
/** Rate the mono vocals product is resampled to — the aligner's input rate. */
const VOCALS_16K_SAMPLE_RATE = 16000;
const NUM_CHANNELS = 2;
const OVERLAP = Math.floor(SEGMENT_SAMPLES * 0.5);
const STEP = SEGMENT_SAMPLES - OVERLAP;

let session: ort.InferenceSession | null = null;

/** A separated stem as planar 44.1 kHz stereo. */
export interface DemucsStereoStem {
  left: Float32Array;
  right: Float32Array;
}

/**
 * What a run should send back. `vocals` and `vocals16k` are separate flags
 * because they are two products of one extraction: alignment wants only the
 * small one, and handing it the 44.1 kHz buffer as well would transfer tens
 * of megabytes it immediately drops.
 */
export interface DemucsSeparationRequest {
  /** 44.1 kHz stereo drums. */
  drums?: boolean | undefined;
  /** 44.1 kHz stereo vocals. */
  vocals?: boolean | undefined;
  /** 16 kHz mono vocals. */
  vocals16k?: boolean | undefined;
}

export interface DemucsSeparationRunRequest {
  type: 'separate';
  /** The whole song, interleaved 44.1 kHz stereo. */
  audioData: Float32Array;
  numSamples: number;
  want: DemucsSeparationRequest;
}

/** A run's products. Each field is present exactly when the request asked
 *  for it. */
export interface DemucsSeparationResult {
  drums?: DemucsStereoStem | undefined;
  vocals?: DemucsStereoStem | undefined;
  vocals16k?: Float32Array | undefined;
}

export type DemucsWorkerMessage =
  | {
      type: 'progress';
      message: string;
      /** 0..1 progress within the separation step. Omitted for setup messages. */
      percent?: number | undefined;
      /** Estimated seconds remaining in the separation step. */
      etaSeconds?: number | undefined;
    }
  | {type: 'loaded'}
  | ({type: 'result'} & DemucsSeparationResult)
  | {type: 'error'; message: string};

type OutboundMessage = DemucsWorkerMessage;

function post(msg: OutboundMessage, transfer?: Transferable[]) {
  self.postMessage(msg, {transfer: transfer ?? []});
}

function progress(
  message: string,
  extra?: {percent?: number | undefined; etaSeconds?: number | undefined},
) {
  post({type: 'progress', message, ...extra});
}

async function loadModel() {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Multi-threading requires spawning nested pthreads workers, which fails
  // inside a bundled web worker (import.meta.url resolves to the chunk, not ORT).
  // WebGPU is the primary speed path; WASM stays single-threaded as fallback.
  ort.env.wasm.numThreads = 1;

  progress('Downloading audio separator...');
  const buffer = await getCachedModel(
    DEMUCS_MODEL_URL,
    DEMUCS_CACHE_KEY,
    (msg, info) =>
      progress(
        msg,
        info && info.totalBytes > 0
          ? {percent: info.loadedBytes / info.totalBytes}
          : undefined,
      ),
    DEMUCS_MIN_BYTES,
    'audio separator',
  );

  progress('Creating Demucs session...');
  try {
    session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    });
    progress('Demucs loaded (WebGPU)');
  } catch {
    session = await ort.InferenceSession.create(buffer, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    progress('Demucs loaded (WASM)');
  }

  post({type: 'loaded'});
}

async function separate(
  audioInterleaved: Float32Array,
  numSamples: number,
  want: DemucsSeparationRequest,
) {
  if (!session) throw new Error('Model not loaded');

  // The 16 kHz mono product is a downmix of the same buffer the stereo one
  // comes from, so either flag extracts vocals exactly once.
  const wantVocals = want.vocals === true || want.vocals16k === true;
  const sources: Array<{
    name: 'drums' | 'vocals';
    index: number;
    left: Float32Array;
    right: Float32Array;
  }> = [];
  if (want.drums === true) {
    sources.push({
      name: 'drums',
      index: SOURCE_INDEX.drums,
      left: new Float32Array(numSamples),
      right: new Float32Array(numSamples),
    });
  }
  if (wantVocals) {
    sources.push({
      name: 'vocals',
      index: SOURCE_INDEX.vocals,
      left: new Float32Array(numSamples),
      right: new Float32Array(numSamples),
    });
  }
  if (sources.length === 0) {
    throw new Error('Demucs separation was asked for no stems');
  }

  const numSegments = Math.ceil((numSamples - OVERLAP) / STEP);

  const fadeIn = new Float32Array(OVERLAP);
  const fadeOut = new Float32Array(OVERLAP);
  for (let i = 0; i < OVERLAP; i++) {
    fadeIn[i] = i / OVERLAP;
    fadeOut[i] = 1 - i / OVERLAP;
  }

  const segmentPlanar = new Float32Array(SEGMENT_SAMPLES * NUM_CHANNELS);
  const segmentInterleaved = new Float32Array(SEGMENT_SAMPLES * NUM_CHANNELS);
  const specBufferSize =
    NUM_CHANNELS * (NFFT / 2) * Math.ceil(SEGMENT_SAMPLES / HOP_LENGTH);
  const sourceReal = new Float32Array(specBufferSize);
  const sourceImag = new Float32Array(specBufferSize);
  const stftBuffers = createSTFTBuffers();
  const istftBuffers = createISTFTBuffers();

  let avgSegMs = 0;

  for (let seg = 0; seg < numSegments; seg++) {
    const segStart = seg * STEP;
    const segEnd = Math.min(segStart + SEGMENT_SAMPLES, numSamples);
    const segLength = segEnd - segStart;

    const segT0 = performance.now();

    // Prepare planar
    segmentPlanar.fill(0);
    for (let i = 0; i < segLength; i++) {
      const srcIdx = (segStart + i) * NUM_CHANNELS;
      segmentPlanar[i] = audioInterleaved[srcIdx];
      segmentPlanar[SEGMENT_SAMPLES + i] = audioInterleaved[srcIdx + 1];
    }

    // Prepare interleaved for STFT
    segmentInterleaved.fill(0);
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      segmentInterleaved[i * 2] = segmentPlanar[i];
      segmentInterleaved[i * 2 + 1] = segmentPlanar[SEGMENT_SAMPLES + i];
    }

    const stft = computeSTFT(segmentInterleaved, stftBuffers);

    const specShape = [1, NUM_CHANNELS, stft.numBins, stft.numFrames];
    const audioShape = [1, NUM_CHANNELS, SEGMENT_SAMPLES];

    const specRealTensor = new ort.Tensor('float32', stft.real, specShape);
    const specImagTensor = new ort.Tensor('float32', stft.imag, specShape);
    const audioTensor = new ort.Tensor('float32', segmentPlanar, audioShape);

    const etaSeconds =
      seg === 0 ? undefined : (avgSegMs * (numSegments - seg)) / 1000;
    progress(`Separating segment ${seg + 1}/${numSegments}`, {
      percent: seg / numSegments,
      etaSeconds,
    });

    const results = await session.run({
      spec_real: specRealTensor,
      spec_imag: specImagTensor,
      audio: audioTensor,
    });

    const specRealData = results['out_spec_real'].data as Float32Array;
    const specImagData = results['out_spec_imag'].data as Float32Array;
    const waveData = results['out_wave'].data as Float32Array;

    const segMs = performance.now() - segT0;
    avgSegMs = seg === 0 ? segMs : avgSegMs * 0.7 + segMs * 0.3; // exponential moving average

    // One iSTFT pass per requested source. The scratch spectrogram and the
    // iSTFT buffers are reused across sources: each pass fully overwrites
    // what it reads, and its output is consumed before the next pass runs.
    for (const source of sources) {
      const specOffset =
        source.index * NUM_CHANNELS * stft.numBins * stft.numFrames;

      sourceReal.fill(0);
      sourceImag.fill(0);
      for (let c = 0; c < NUM_CHANNELS; c++) {
        const cOffset = c * stft.numBins * stft.numFrames;
        for (let b = 0; b < stft.numBins; b++) {
          for (let t = 0; t < stft.numFrames; t++) {
            const idx = b * stft.numFrames + t;
            sourceReal[cOffset + idx] =
              specRealData[specOffset + cOffset + idx];
            sourceImag[cOffset + idx] =
              specImagData[specOffset + cOffset + idx];
          }
        }
      }

      const freqAudio = computeISTFT(
        sourceReal,
        sourceImag,
        NUM_CHANNELS,
        stft.numBins,
        stft.numFrames,
        SEGMENT_SAMPLES,
        istftBuffers,
      );

      const sourceWaveOffset = source.index * NUM_CHANNELS * SEGMENT_SAMPLES;

      for (let i = 0; i < segLength; i++) {
        const globalIdx = segStart + i;
        if (globalIdx >= numSamples) continue;

        const leftVal = freqAudio[i] + waveData[sourceWaveOffset + i];
        const rightVal =
          freqAudio[SEGMENT_SAMPLES + i] +
          waveData[sourceWaveOffset + SEGMENT_SAMPLES + i];

        let weight = 1.0;
        if (seg > 0 && i < OVERLAP) weight = fadeIn[i];
        if (seg < numSegments - 1 && i >= SEGMENT_SAMPLES - OVERLAP) {
          weight = fadeOut[i - (SEGMENT_SAMPLES - OVERLAP)];
        }

        source.left[globalIdx] += leftVal * weight;
        source.right[globalIdx] += rightVal * weight;
      }
    }

    specRealTensor.dispose();
    specImagTensor.dispose();
    audioTensor.dispose();
    results['out_spec_real'].dispose();
    results['out_spec_imag'].dispose();
    results['out_wave'].dispose();
  }

  const vocalsSource = sources.find(source => source.name === 'vocals');
  const drumsSource = sources.find(source => source.name === 'drums');

  const result: DemucsSeparationResult = {};
  const transfer: Transferable[] = [];

  if (want.vocals16k === true && vocalsSource) {
    progress('Converting to mono...');
    const mono44k = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      mono44k[i] = (vocalsSource.left[i] + vocalsSource.right[i]) / 2;
    }

    progress('Resampling to 16kHz...');
    const ratio = VOCALS_16K_SAMPLE_RATE / SAMPLE_RATE;
    const outLen = Math.floor(numSamples * ratio);
    const mono16k = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i / ratio;
      const low = Math.floor(srcIdx);
      const high = Math.min(low + 1, numSamples - 1);
      const frac = srcIdx - low;
      mono16k[i] = mono44k[low] * (1 - frac) + mono44k[high] * frac;
    }
    result.vocals16k = mono16k;
    transfer.push(mono16k.buffer);
  }

  // The full-rate buffers are transferred, so they are only kept when the
  // caller asked for them — an unwanted one is dropped here rather than
  // copied across the boundary.
  if (want.drums === true && drumsSource) {
    result.drums = {left: drumsSource.left, right: drumsSource.right};
    transfer.push(drumsSource.left.buffer, drumsSource.right.buffer);
  }
  if (want.vocals === true && vocalsSource) {
    result.vocals = {left: vocalsSource.left, right: vocalsSource.right};
    transfer.push(vocalsSource.left.buffer, vocalsSource.right.buffer);
  }

  progress('Separation complete');
  post({type: 'result', ...result}, transfer);
}

self.onmessage = async (e: MessageEvent) => {
  try {
    if (e.data.type === 'load') {
      await loadModel();
    } else if (e.data.type === 'separate') {
      const req = e.data as DemucsSeparationRunRequest;
      await separate(req.audioData, req.numSamples, req.want);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    post({type: 'error', message});
  }
};
