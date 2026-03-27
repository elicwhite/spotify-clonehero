/**
 * Web Worker that runs Demucs vocal separation in its own WASM context.
 * Terminated after use to fully reclaim WASM memory.
 *
 * Reuses the STFT/iSTFT code from lib/drum-transcription/audio/stft.ts.
 *
 * Messages:
 *   IN:  { type: "load" }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "loaded" }
 *
 *   IN:  { type: "separate", audioData: Float32Array, numSamples: number }
 *   OUT: { type: "progress", message: string }
 *   OUT: { type: "result", vocals16k: Float32Array }
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

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const DEMUCS_MODEL_URL =
  'https://huggingface.co/Ryan5453/demucs-onnx/resolve/main/htdemucs.onnx';
const SAMPLE_RATE = 44100;
const VOCALS_INDEX = 3;
const NUM_CHANNELS = 2;
const OVERLAP = Math.floor(SEGMENT_SAMPLES * 0.5);
const STEP = SEGMENT_SAMPLES - OVERLAP;

let session: ort.InferenceSession | null = null;

function post(msg: any, transfer?: Transferable[]) {
  self.postMessage(msg, {transfer: transfer ?? []});
}

function progress(message: string) {
  post({type: 'progress', message});
}

async function loadModel() {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  // Multi-threading requires spawning nested pthreads workers, which fails
  // inside a bundled web worker (import.meta.url resolves to the chunk, not ORT).
  // WebGPU is the primary speed path; WASM stays single-threaded as fallback.
  ort.env.wasm.numThreads = 1;

  progress('Downloading Demucs model (~80 MB)...');
  const buffer = await getCachedModel(
    DEMUCS_MODEL_URL,
    'htdemucs.onnx',
    progress,
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

async function separate(audioInterleaved: Float32Array, numSamples: number) {
  if (!session) throw new Error('Model not loaded');

  const numSegments = Math.ceil((numSamples - OVERLAP) / STEP);
  const vocalsOutput = new Float32Array(numSamples * NUM_CHANNELS);

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

    const remaining = seg === 0
      ? ''
      : `: ${Math.round((avgSegMs * (numSegments - seg)) / 1000)} seconds remaining`;
    progress(`Separating segment ${seg + 1}/${numSegments}${remaining}`);

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

    const s = VOCALS_INDEX;
    const specOffset = s * NUM_CHANNELS * stft.numBins * stft.numFrames;

    sourceReal.fill(0);
    sourceImag.fill(0);
    for (let c = 0; c < NUM_CHANNELS; c++) {
      const cOffset = c * stft.numBins * stft.numFrames;
      for (let b = 0; b < stft.numBins; b++) {
        for (let t = 0; t < stft.numFrames; t++) {
          const idx = b * stft.numFrames + t;
          sourceReal[cOffset + idx] = specRealData[specOffset + cOffset + idx];
          sourceImag[cOffset + idx] = specImagData[specOffset + cOffset + idx];
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

    const sourceWaveOffset = s * NUM_CHANNELS * SEGMENT_SAMPLES;

    for (let i = 0; i < segLength; i++) {
      const globalIdx = segStart + i;
      if (globalIdx >= numSamples) continue;
      const outIdx = globalIdx * NUM_CHANNELS;

      const leftVal = freqAudio[i] + waveData[sourceWaveOffset + i];
      const rightVal =
        freqAudio[SEGMENT_SAMPLES + i] +
        waveData[sourceWaveOffset + SEGMENT_SAMPLES + i];

      let weight = 1.0;
      if (seg > 0 && i < OVERLAP) weight = fadeIn[i];
      if (seg < numSegments - 1 && i >= SEGMENT_SAMPLES - OVERLAP) {
        weight = fadeOut[i - (SEGMENT_SAMPLES - OVERLAP)];
      }

      vocalsOutput[outIdx] += leftVal * weight;
      vocalsOutput[outIdx + 1] += rightVal * weight;
    }

    specRealTensor.dispose();
    specImagTensor.dispose();
    audioTensor.dispose();
    results['out_spec_real'].dispose();
    results['out_spec_imag'].dispose();
    results['out_wave'].dispose();
  }

  // Convert to mono 16kHz
  progress('Converting to mono...');
  const mono44k = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    mono44k[i] = (vocalsOutput[i * 2] + vocalsOutput[i * 2 + 1]) / 2;
  }

  progress('Resampling to 16kHz...');
  const ratio = 16000 / SAMPLE_RATE;
  const outLen = Math.floor(numSamples * ratio);
  const mono16k = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, numSamples - 1);
    const frac = srcIdx - low;
    mono16k[i] = mono44k[low] * (1 - frac) + mono44k[high] * frac;
  }

  progress('Vocal separation complete');
  post({type: 'result', vocals16k: mono16k}, [mono16k.buffer]);
}

self.onmessage = async (e: MessageEvent) => {
  try {
    if (e.data.type === 'load') {
      await loadModel();
    } else if (e.data.type === 'separate') {
      await separate(e.data.audioData, e.data.numSamples);
    }
  } catch (err: any) {
    post({type: 'error', message: err.message ?? String(err)});
  }
};
