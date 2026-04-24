/**
 * Demucs stem separation pipeline.
 *
 * Runs the htdemucs ONNX model entirely in the browser via WebGPU.
 * Audio is segmented into overlapping 10-second chunks, processed through
 * STFT -> ONNX model -> iSTFT, then stitched back together with linear
 * crossfade overlap-add.
 *
 * Output: 4 separated stems (drums, bass, other, vocals) stored to OPFS.
 *
 * Reference implementation: ~/projects/demucs-next/web/src/hooks/useDemucs.ts
 */

import {
  NFFT,
  HOP_LENGTH,
  SEGMENT_SAMPLES,
  computeSTFT,
  computeISTFT,
  createSTFTBuffers,
  createISTFTBuffers,
} from '@/lib/drum-transcription/audio/stft';
import {
  createInferenceSession,
  runInference,
  type OrtInferenceSession,
} from './onnx-runtime';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Source names in the order the htdemucs model outputs them. */
export const MODEL_SOURCES = ['drums', 'bass', 'other', 'vocals'] as const;
export type SourceName = (typeof MODEL_SOURCES)[number];

/** HuggingFace URL for the htdemucs ONNX model (~161 MB). */
const MODEL_URL =
  'https://huggingface.co/Ryan5453/demucs-onnx/resolve/main/htdemucs.onnx';

/** Number of stereo channels. */
const NUM_CHANNELS = 2;

/** 50% overlap between segments. */
const OVERLAP = Math.floor(SEGMENT_SAMPLES * 0.5);

/** Hop between segment start positions. */
const STEP = SEGMENT_SAMPLES - OVERLAP;

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------

export interface SeparationProgress {
  step: 'loading-model' | 'processing' | 'storing' | 'done';
  segment?: number;
  totalSegments?: number;
  percent: number; // 0-1
}

export type ProgressCallback = (progress: SeparationProgress) => void;

// ---------------------------------------------------------------------------
// OPFS stem storage
// ---------------------------------------------------------------------------

/**
 * Stores a single separated stem to OPFS.
 *
 * Writes to: drum-transcription/{projectId}/stems/{stemName}.pcm
 *
 * The PCM data is interleaved stereo Float32 at 44.1 kHz.
 */
async function storeStem(
  projectId: string,
  stemName: string,
  pcmData: Float32Array,
): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle('drum-transcription', {
    create: true,
  });
  const projectDir = await nsDir.getDirectoryHandle(projectId, {create: true});
  const stemsDir = await projectDir.getDirectoryHandle('stems', {
    create: true,
  });
  const fileHandle = await stemsDir.getFileHandle(`${stemName}.pcm`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(pcmData.buffer as ArrayBuffer);
  await writable.close();
}

// ---------------------------------------------------------------------------
// Segmentation helpers
// ---------------------------------------------------------------------------

/**
 * Computes the total number of segments for a given sample count.
 */
export function computeSegmentCount(numSamples: number): number {
  if (numSamples <= 0) return 0;
  return Math.ceil((numSamples - OVERLAP) / STEP);
}

/**
 * Pre-computes linear crossfade ramps for overlap-add.
 */
function createFadeBuffers(): {fadeIn: Float32Array; fadeOut: Float32Array} {
  const fadeIn = new Float32Array(OVERLAP);
  const fadeOut = new Float32Array(OVERLAP);
  for (let i = 0; i < OVERLAP; i++) {
    fadeIn[i] = i / OVERLAP;
    fadeOut[i] = 1 - i / OVERLAP;
  }
  return {fadeIn, fadeOut};
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/**
 * Runs the full Demucs stem separation pipeline.
 *
 * @param projectId       - OPFS project ID (from createProject).
 * @param interleavedAudio - Interleaved stereo Float32 PCM at 44.1 kHz.
 * @param onProgress      - Optional callback for progress updates.
 *
 * @returns A record mapping source name to interleaved stereo Float32 PCM.
 */
export async function separateStems(
  projectId: string,
  interleavedAudio: Float32Array,
  onProgress?: ProgressCallback,
): Promise<Record<SourceName, Float32Array>> {
  const numSamples = interleavedAudio.length / NUM_CHANNELS;
  const numSegments = computeSegmentCount(numSamples);

  // -----------------------------------------------------------------------
  // 1. Load model
  // -----------------------------------------------------------------------
  onProgress?.({step: 'loading-model', percent: 0});
  const session = await createInferenceSession(MODEL_URL);

  try {
    return await runSeparation(
      session,
      interleavedAudio,
      numSamples,
      numSegments,
      projectId,
      onProgress,
    );
  } finally {
    await session.release();
  }
}

/**
 * Core separation loop, extracted so the session lifetime is managed by the
 * caller (separateStems) via try/finally.
 */
async function runSeparation(
  session: OrtInferenceSession,
  interleavedAudio: Float32Array,
  numSamples: number,
  numSegments: number,
  projectId: string,
  onProgress?: ProgressCallback,
): Promise<Record<SourceName, Float32Array>> {
  // Allocate output arrays for each source (interleaved stereo)
  const outputs: Record<string, Float32Array> = {};
  for (const source of MODEL_SOURCES) {
    outputs[source] = new Float32Array(numSamples * NUM_CHANNELS);
  }

  const {fadeIn, fadeOut} = createFadeBuffers();

  // Pre-allocate reusable work buffers
  const segmentPlanar = new Float32Array(SEGMENT_SAMPLES * NUM_CHANNELS);
  const segmentInterleaved = new Float32Array(SEGMENT_SAMPLES * NUM_CHANNELS);
  const specBufferSize =
    NUM_CHANNELS * (NFFT / 2) * Math.ceil(SEGMENT_SAMPLES / HOP_LENGTH);
  const sourceReal = new Float32Array(specBufferSize);
  const sourceImag = new Float32Array(specBufferSize);
  const stftBuffers = createSTFTBuffers();
  const istftBuffers = createISTFTBuffers();

  // -----------------------------------------------------------------------
  // 2. Segment loop
  // -----------------------------------------------------------------------
  for (let seg = 0; seg < numSegments; seg++) {
    onProgress?.({
      step: 'processing',
      segment: seg,
      totalSegments: numSegments,
      percent: (seg / numSegments) * 0.9, // 0-90% for inference
    });

    // Yield to UI thread periodically
    if (seg % 2 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    const segStart = seg * STEP;
    const segEnd = Math.min(segStart + SEGMENT_SAMPLES, numSamples);
    const segLength = segEnd - segStart;

    // Extract segment in planar layout [L0..LN, R0..RN]
    segmentPlanar.fill(0);
    for (let i = 0; i < segLength; i++) {
      const srcIdx = (segStart + i) * NUM_CHANNELS;
      segmentPlanar[i] = interleavedAudio[srcIdx]; // left
      segmentPlanar[SEGMENT_SAMPLES + i] = interleavedAudio[srcIdx + 1]; // right
    }

    // Convert to interleaved for STFT
    segmentInterleaved.fill(0);
    for (let i = 0; i < SEGMENT_SAMPLES; i++) {
      segmentInterleaved[i * 2] = segmentPlanar[i];
      segmentInterleaved[i * 2 + 1] = segmentPlanar[SEGMENT_SAMPLES + i];
    }

    // Forward STFT
    const stft = computeSTFT(segmentInterleaved, stftBuffers);

    const specShape = [1, NUM_CHANNELS, stft.numBins, stft.numFrames];
    const audioShape = [1, NUM_CHANNELS, SEGMENT_SAMPLES];

    // ONNX inference
    const results = await runInference(
      session,
      stft.real,
      stft.imag,
      segmentPlanar,
      specShape,
      audioShape,
    );

    const specRealData = results.outSpecReal;
    const specImagData = results.outSpecImag;
    const waveData = results.outWave;

    // -----------------------------------------------------------------------
    // 3. Per-source iSTFT + time-domain addition + overlap-add
    // -----------------------------------------------------------------------
    for (let s = 0; s < MODEL_SOURCES.length; s++) {
      const specOffset = s * NUM_CHANNELS * stft.numBins * stft.numFrames;

      // Extract this source's spectrogram
      sourceReal.fill(0);
      sourceImag.fill(0);
      for (let c = 0; c < NUM_CHANNELS; c++) {
        const cOffset = c * stft.numBins * stft.numFrames;
        for (let b = 0; b < stft.numBins; b++) {
          for (let t = 0; t < stft.numFrames; t++) {
            const idx = b * stft.numFrames + t;
            const specIdx = specOffset + cOffset + idx;
            sourceReal[cOffset + idx] = specRealData[specIdx];
            sourceImag[cOffset + idx] = specImagData[specIdx];
          }
        }
      }

      // iSTFT -> frequency-domain reconstruction (planar: [L0..LN, R0..RN])
      const freqAudio = computeISTFT(
        sourceReal,
        sourceImag,
        NUM_CHANNELS,
        stft.numBins,
        stft.numFrames,
        SEGMENT_SAMPLES,
        istftBuffers,
      );

      // Time-domain branch offset for this source
      const sourceWaveOffset = s * NUM_CHANNELS * SEGMENT_SAMPLES;

      // Combine freq + time branches with crossfade and write to output
      for (let i = 0; i < segLength; i++) {
        const globalIdx = segStart + i;
        if (globalIdx >= numSamples) continue;

        const outIdx = globalIdx * NUM_CHANNELS;

        // freqAudio is planar [L, R], waveData is also planar per source
        const leftFreq = freqAudio[i];
        const rightFreq = freqAudio[SEGMENT_SAMPLES + i];
        const leftTime = waveData[sourceWaveOffset + i];
        const rightTime = waveData[sourceWaveOffset + SEGMENT_SAMPLES + i];

        const leftVal = leftFreq + leftTime;
        const rightVal = rightFreq + rightTime;

        // Crossfade weight for overlap regions
        let weight = 1.0;
        if (seg > 0 && i < OVERLAP) {
          weight = fadeIn[i];
        }
        if (seg < numSegments - 1 && i >= SEGMENT_SAMPLES - OVERLAP) {
          const fadeIdx = i - (SEGMENT_SAMPLES - OVERLAP);
          weight = fadeOut[fadeIdx];
        }

        outputs[MODEL_SOURCES[s]][outIdx] += leftVal * weight;
        outputs[MODEL_SOURCES[s]][outIdx + 1] += rightVal * weight;
      }
    }
  }

  // -----------------------------------------------------------------------
  // 4. Store stems to OPFS
  // -----------------------------------------------------------------------
  onProgress?.({step: 'storing', percent: 0.92});

  for (let i = 0; i < MODEL_SOURCES.length; i++) {
    const source = MODEL_SOURCES[i];
    await storeStem(projectId, source, outputs[source]);
    onProgress?.({
      step: 'storing',
      percent: 0.92 + ((i + 1) / MODEL_SOURCES.length) * 0.08,
    });
  }

  onProgress?.({step: 'done', percent: 1});

  return outputs as Record<SourceName, Float32Array>;
}

// ---------------------------------------------------------------------------
// Utilities for loading stems back from OPFS
// ---------------------------------------------------------------------------

/**
 * Loads a previously stored stem from OPFS.
 *
 * @param projectId - The OPFS project ID.
 * @param stemName  - One of 'drums', 'bass', 'other', 'vocals'.
 * @returns Interleaved stereo Float32 PCM at 44.1 kHz.
 * @throws {Error} if the stem file does not exist.
 */
export async function loadStem(
  projectId: string,
  stemName: SourceName,
): Promise<Float32Array> {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle('drum-transcription');
  const projectDir = await nsDir.getDirectoryHandle(projectId);
  const stemsDir = await projectDir.getDirectoryHandle('stems');
  const fileHandle = await stemsDir.getFileHandle(`${stemName}.pcm`);
  const file = await fileHandle.getFile();
  return new Float32Array(await file.arrayBuffer());
}

/**
 * Checks whether all 4 stems have been stored for a project.
 */
export async function hasSeparatedStems(
  projectId: string,
): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const nsDir = await root.getDirectoryHandle('drum-transcription');
    const projectDir = await nsDir.getDirectoryHandle(projectId);
    const stemsDir = await projectDir.getDirectoryHandle('stems');
    for (const source of MODEL_SOURCES) {
      await stemsDir.getFileHandle(`${source}.pcm`);
    }
    return true;
  } catch {
    return false;
  }
}
