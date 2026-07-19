/**
 * Web Worker for CRNN drum transcription inference (stereo 256-mel model).
 *
 * Runs all heavy computation off the main thread:
 *   - Per-channel stereo mel spectrogram (2, 256, T) @ 48 kHz / 100 fps
 *   - Deploy song context (512-dim stereo time-mean tiled 10x -> 5120)
 *   - Single-pass windowed ONNX inference (500-frame windows, stride 375,
 *     sigmoid + overlap averaging)
 *   - Post-processing (tom re-order + per-frame lane constraints)
 *   - Peak picking with the provided per-lane thresholds
 *
 * Communication protocol:
 *   Main → Worker:  { type: 'transcribe', stereoAudio, sampleRate, modelUrl, thresholds }
 *     stereoAudio is interleaved [L0, R0, L1, R1, ...] at 48000 Hz.
 *   Worker → Main:  { type: 'progress', step, percent, detail? }
 *   Worker → Main:  { type: 'result', events, modelOutput, durationSeconds }
 *   Worker → Main:  { type: 'error', message }
 */

import {computeStereoMel, computeMonoMelTMajor} from './spectrogram';
import {computeDeployContext} from './song-context';
import {applyPostprocess} from './postprocess';
import {pickPeaksFromModelOutput} from './peak-picking';
import type {ModelOutput, TranscriptionProgress} from './types';
import {
  DEFAULT_MEL_CONFIG,
  NUM_DRUM_CLASSES,
  SONG_CONTEXT_DIM,
  WINDOW_SIZE,
  WINDOW_STRIDE,
} from './types';

// ---------------------------------------------------------------------------
// ONNX Runtime in Worker
// ---------------------------------------------------------------------------

/** CDN URL for ONNX Runtime — must match the main thread version. */
const ORT_CDN_URL =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/ort.all.min.js';
const ORT_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

let ort: any = null;

async function loadOrt() {
  if (ort) return ort;
  // In a worker, use importScripts to load ONNX Runtime
  (
    self as unknown as {importScripts: (...urls: string[]) => void}
  ).importScripts(ORT_CDN_URL);
  ort = (self as any).ort;
  if (!ort) throw new Error('Failed to load ONNX Runtime in worker');
  ort.env.wasm.wasmPaths = ORT_CDN_BASE;
  ort.env.wasm.numThreads = 1; // Workers don't need multi-threaded WASM
  ort.env.logLevel = 'error';
  return ort;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Split interleaved stereo [L0, R0, L1, R1, ...] into planar channels. */
function deinterleave(stereo: Float32Array): {
  left: Float32Array;
  right: Float32Array;
} {
  const numSamples = stereo.length >> 1;
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    left[i] = stereo[i * 2];
    right[i] = stereo[i * 2 + 1];
  }
  return {left, right};
}

// ---------------------------------------------------------------------------
// Windowed inference (single pass)
// ---------------------------------------------------------------------------

/**
 * Run windowed ONNX inference over the full stereo mel.
 *
 * @param melStereo - Stereo mel, layout [ch * nMels * T + m * T + t].
 * @param context - Song context vector (5120).
 * @returns Averaged sigmoid activations, layout [t * 9 + c].
 */
async function windowedInference(
  session: any,
  melStereo: Float32Array,
  nFrames: number,
  nMels: number,
  context: Float32Array,
  postProgress: (step: TranscriptionProgress['step'], percent: number) => void,
): Promise<ModelOutput> {
  const rtOrt = await loadOrt();

  const T = nFrames;
  const nClasses = NUM_DRUM_CLASSES;

  // Accumulation buffers
  const accum = new Float64Array(T * nClasses);
  const counts = new Float64Array(T);

  // Count total windows for progress (loop runs while start < T)
  const totalWindows = Math.max(1, Math.ceil(T / WINDOW_STRIDE));
  let windowIdx = 0;

  const ctxTensor = new rtOrt.Tensor('float32', context, [1, SONG_CONTEXT_DIM]);

  for (let start = 0; start < T; start += WINDOW_STRIDE) {
    const end = Math.min(start + WINDOW_SIZE, T);
    const W = end - start;
    const padW = WINDOW_SIZE; // zero-pad shorter final window

    // Mel window: (1, 2, nMels, padW), layout [ch*nMels*padW + m*padW + f]
    const melWindow = new Float32Array(2 * nMels * padW);
    for (let ch = 0; ch < 2; ch++) {
      for (let m = 0; m < nMels; m++) {
        const srcBase = (ch * nMels + m) * T + start;
        const dstBase = (ch * nMels + m) * padW;
        for (let f = 0; f < W; f++) {
          melWindow[dstBase + f] = melStereo[srcBase + f];
        }
      }
    }

    const melTensor = new rtOrt.Tensor('float32', melWindow, [
      1,
      2,
      nMels,
      padW,
    ]);

    const results = await session.run({
      mel: melTensor,
      context: ctxTensor,
    });

    melTensor.dispose();

    // Logits output: (1, 500, 9), row-major [f * 9 + c]
    const outputTensor = results.logits ?? results[Object.keys(results)[0]];
    const logits = outputTensor.data as Float32Array;

    // Accumulate sigmoid(logits) into the correct position
    for (let f = 0; f < W; f++) {
      for (let c = 0; c < nClasses; c++) {
        accum[(start + f) * nClasses + c] += sigmoid(logits[f * nClasses + c]);
      }
      counts[start + f] += 1;
    }

    outputTensor.dispose();

    windowIdx++;
    postProgress('inference', Math.min(1, windowIdx / totalWindows));
  }

  ctxTensor.dispose();

  // Average overlapping predictions
  const predictions = new Float32Array(T * nClasses);
  for (let f = 0; f < T; f++) {
    const c = Math.max(counts[f], 1);
    for (let cls = 0; cls < nClasses; cls++) {
      predictions[f * nClasses + cls] = accum[f * nClasses + cls] / c;
    }
  }

  return {predictions, nFrames: T, nClasses};
}

// ---------------------------------------------------------------------------
// Main transcription pipeline
// ---------------------------------------------------------------------------

async function transcribe(
  stereoAudio: Float32Array,
  sampleRate: number,
  modelUrl: string,
  thresholds: number[],
  executionProviders: string[] = ['webgpu', 'wasm'],
) {
  const durationSeconds = stereoAudio.length / 2 / sampleRate;

  function postProgress(
    step: TranscriptionProgress['step'],
    percent: number,
    detail?: string,
  ) {
    self.postMessage({type: 'progress', step, percent, detail});
  }

  let session: any = null;
  try {
    if (sampleRate !== DEFAULT_MEL_CONFIG.sampleRate) {
      throw new Error(
        `CRNN worker expects ${DEFAULT_MEL_CONFIG.sampleRate} Hz audio, got ${sampleRate} Hz`,
      );
    }

    // Step 1: Stereo mel spectrogram (2, 256, T)
    postProgress('computing-spectrogram', 0.05);
    const {left, right} = deinterleave(stereoAudio);
    const {melStereo, nFrames, nMels} = computeStereoMel(left, right);
    postProgress('computing-spectrogram', 1);

    if (nFrames === 0) {
      throw new Error('Audio too short to compute a mel spectrogram');
    }

    // Step 2: Deploy song context (single pass — no onset-conditioned repass)
    const context = computeDeployContext(melStereo, nFrames, nMels);

    // Step 3: Load ONNX model
    postProgress('loading-model', 0);
    const rtOrt = await loadOrt();
    session = await rtOrt.InferenceSession.create(modelUrl, {
      executionProviders,
      graphOptimizationLevel: 'all',
    });
    postProgress('loading-model', 1);

    // Step 4: Single-pass windowed inference
    const rawOutput = await windowedInference(
      session,
      melStereo,
      nFrames,
      nMels,
      context,
      postProgress,
    );

    // Step 5: Post-processing (tom re-order + lane constraints) + peak picking
    postProgress('post-processing', 0.9);
    const monoMel = computeMonoMelTMajor(melStereo, nFrames, nMels);
    const processed = applyPostprocess(rawOutput.predictions, nFrames, monoMel);
    const modelOutput: ModelOutput = {
      predictions: processed,
      nFrames,
      nClasses: rawOutput.nClasses,
    };
    const events = pickPeaksFromModelOutput(modelOutput, thresholds);

    postProgress('done', 1);

    // Send result back — transfer predictions buffer for zero-copy
    const result = {
      type: 'result' as const,
      events,
      modelOutput,
      durationSeconds,
    };

    self.postMessage(result, {
      transfer: [result.modelOutput.predictions.buffer],
    });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    if (session) await session.release();
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent) => {
  const {
    type,
    stereoAudio,
    sampleRate,
    modelUrl,
    thresholds,
    executionProviders,
  } = e.data;
  if (type === 'transcribe') {
    transcribe(
      stereoAudio,
      sampleRate,
      modelUrl,
      thresholds,
      executionProviders,
    );
  }
};
