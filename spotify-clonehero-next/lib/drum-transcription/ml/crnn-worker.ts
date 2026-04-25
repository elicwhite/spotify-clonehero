/**
 * Web Worker for CRNN drum transcription inference.
 *
 * Runs all heavy computation off the main thread:
 *   - Mel spectrogram computation
 *   - Panning feature computation
 *   - Song context computation
 *   - ONNX model inference (windowed, two-pass)
 *   - Peak picking
 *
 * Communication protocol:
 *   Main → Worker:  { type: 'transcribe', stereoAudio, sampleRate, modelUrl }
 *   Worker → Main:  { type: 'progress', step, percent, detail? }
 *   Worker → Main:  { type: 'result', events, modelOutput, durationSeconds }
 *   Worker → Main:  { type: 'error', message }
 */

import {computeMelSpectrogram} from './spectrogram';
import {computePanningFeatures} from './panning';
import {computeFallbackContext, computeRealContext} from './song-context';
import {pickPeaksFromModelOutput} from './peak-picking';
import type {
  MelSpectrogramConfig,
  ModelOutput,
  TranscriptionProgress,
} from './types';
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
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.0-dev.20251116-b39e144322/dist/ort.all.min.js';
const ORT_CDN_BASE =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.0-dev.20251116-b39e144322/dist/';

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
// Helper: sigmoid
// ---------------------------------------------------------------------------

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ---------------------------------------------------------------------------
// Helper: stereo to mono
// ---------------------------------------------------------------------------

function stereoToMono(stereo: Float32Array): Float32Array {
  const numSamples = stereo.length / 2;
  const mono = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    mono[i] = (stereo[i * 2] + stereo[i * 2 + 1]) * 0.5;
  }
  return mono;
}

// ---------------------------------------------------------------------------
// Windowed inference
// ---------------------------------------------------------------------------

async function windowedInference(
  session: any,
  mel: Float32Array,
  nFrames: number,
  nMels: number,
  panning: Float32Array,
  panNFrames: number,
  context: Float32Array,
  passName: string,
  postProgress: (step: TranscriptionProgress['step'], percent: number) => void,
): Promise<ModelOutput> {
  const rtOrt = await loadOrt();

  // Use the minimum frame count between mel and panning
  const T = Math.min(nFrames, panNFrames);
  const nClasses = NUM_DRUM_CLASSES;

  // Accumulation buffers
  const accum = new Float64Array(T * nClasses);
  const counts = new Float64Array(T);

  // Count total windows for progress
  const totalWindows = Math.max(
    1,
    Math.ceil((T - WINDOW_SIZE) / WINDOW_STRIDE) + 1,
  );
  let windowIdx = 0;

  const step = passName === 'pass-1' ? 'inference-pass-1' : 'inference-pass-2';

  for (let start = 0; start < T; start += WINDOW_STRIDE) {
    const end = Math.min(start + WINDOW_SIZE, T);
    const W = end - start;

    // Pad window to WINDOW_SIZE (zero-pad shorter final window)
    const padW = WINDOW_SIZE;

    // Prepare mel window: (1, 1, 128, padW)
    const melWindow = new Float32Array(1 * 1 * nMels * padW);
    for (let f = 0; f < W; f++) {
      for (let m = 0; m < nMels; m++) {
        melWindow[m * padW + f] = mel[(start + f) * nMels + m];
      }
    }

    // Prepare panning window: (1, 4, padW)
    const panWindow = new Float32Array(1 * 4 * padW);
    for (let b = 0; b < 4; b++) {
      for (let f = 0; f < W; f++) {
        panWindow[b * padW + f] = panning[b * panNFrames + (start + f)];
      }
    }

    // Context: (1, 1280)
    const melTensor = new rtOrt.Tensor('float32', melWindow, [
      1,
      1,
      nMels,
      padW,
    ]);
    const panTensor = new rtOrt.Tensor('float32', panWindow, [1, 4, padW]);
    const ctxTensor = new rtOrt.Tensor('float32', context, [
      1,
      SONG_CONTEXT_DIM,
    ]);

    const results = await session.run({
      mel: melTensor,
      panning: panTensor,
      context: ctxTensor,
    });

    melTensor.dispose();
    panTensor.dispose();
    ctxTensor.dispose();

    // Get logits output
    const outputKey = Object.keys(results)[0];
    const outputTensor = results[outputKey];
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
    postProgress(
      step as TranscriptionProgress['step'],
      windowIdx / totalWindows,
    );
  }

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
) {
  const durationSeconds = stereoAudio.length / 2 / sampleRate;

  function postProgress(
    step: TranscriptionProgress['step'],
    percent: number,
    detail?: string,
  ) {
    self.postMessage({type: 'progress', step, percent, detail});
  }

  try {
    // Step 1: Compute mel spectrogram (from mono)
    postProgress('computing-spectrogram', 0.05);
    const mono = stereoToMono(stereoAudio);

    const config: MelSpectrogramConfig = {
      ...DEFAULT_MEL_CONFIG,
      sampleRate,
    };
    const {
      spectrogram: mel,
      nFrames,
      nMels,
    } = computeMelSpectrogram(mono, config);
    postProgress('computing-spectrogram', 0.5);

    // Step 2: Compute panning features (from stereo)
    postProgress('computing-panning', 0);
    const {panning, nFrames: panNFrames} = computePanningFeatures(
      stereoAudio,
      config,
    );
    postProgress('computing-panning', 1);

    // Step 3: Load ONNX model
    postProgress('loading-model', 0);
    const rtOrt = await loadOrt();
    const session = await rtOrt.InferenceSession.create(modelUrl, {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
    });
    postProgress('loading-model', 1);

    // Step 4: Pass 1 — fallback context
    const fallbackCtx = computeFallbackContext(mel, nFrames, nMels);
    const pass1Output = await windowedInference(
      session,
      mel,
      nFrames,
      nMels,
      panning,
      panNFrames,
      fallbackCtx,
      'pass-1',
      postProgress,
    );

    // Step 5: Peak pick Pass 1 to get onsets for real context
    const pass1Events = pickPeaksFromModelOutput(pass1Output);

    // Step 6: Compute real context from Pass 1 onsets
    const realCtx = computeRealContext(mel, nFrames, nMels, pass1Events);

    // Step 7: Pass 2 — real context
    const pass2Output = await windowedInference(
      session,
      mel,
      nFrames,
      nMels,
      panning,
      panNFrames,
      realCtx,
      'pass-2',
      postProgress,
    );

    // Step 8: Peak pick Pass 2 for final events
    postProgress('post-processing', 0.9);
    const events = pickPeaksFromModelOutput(pass2Output);

    await session.release();

    postProgress('done', 1);

    // Send result back — transfer predictions buffer for zero-copy
    const result = {
      type: 'result' as const,
      events,
      modelOutput: {
        predictions: pass2Output.predictions,
        nFrames: pass2Output.nFrames,
        nClasses: pass2Output.nClasses,
      },
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
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent) => {
  const {type, stereoAudio, sampleRate, modelUrl} = e.data;
  if (type === 'transcribe') {
    transcribe(stereoAudio, sampleRate, modelUrl);
  }
};
