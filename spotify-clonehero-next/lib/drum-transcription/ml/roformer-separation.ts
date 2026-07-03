/**
 * BS-Roformer drum-stem separation for the drum transcription pipeline.
 *
 * Runs the shared bs-roformer-sw 6-stem separator
 * (lib/tempo-map/stem-separation.ts) and keeps only the drum stem, stored to
 * OPFS as interleaved stereo 44.1 kHz PCM (stems/drums.pcm) so the pipeline is
 * resumable across tab closes.
 *
 * The ORT session setup mirrors lib/tempo-map/pipeline-worker.ts (WebGPU with
 * WASM fallback, graph optimization disabled — required for this trace).
 */

import * as ort from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {separateDrumStem} from '@/lib/tempo-map/stem-separation';

// Same model/cache constants as lib/tempo-map/pipeline-worker.ts so both
// features share one OPFS-cached download.
const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_CACHE_KEY = 'bs_roformer_sw_6stem_fp16.onnx';
const ROFORMER_MIN_BYTES = 300_000_000; // real size ~336 MB

const ORT_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/';

const NUM_CHANNELS = 2;

export interface DrumSeparationProgress {
  step: 'loading-model' | 'processing' | 'storing' | 'done';
  percent: number; // 0-1
  etaSeconds?: number | undefined;
}

export type DrumSeparationProgressCallback = (
  p: DrumSeparationProgress,
) => void;

// ---------------------------------------------------------------------------
// OPFS stem storage
// ---------------------------------------------------------------------------

async function getStemsDir(projectId: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle('drum-transcription', {create});
  const projectDir = await nsDir.getDirectoryHandle(projectId, {create});
  return projectDir.getDirectoryHandle('stems', {create});
}

/** Stores the drum stem (interleaved stereo Float32 @ 44.1 kHz) to OPFS. */
async function storeDrumStem(
  projectId: string,
  pcmData: Float32Array,
): Promise<void> {
  const stemsDir = await getStemsDir(projectId, true);
  const fileHandle = await stemsDir.getFileHandle('drums.pcm', {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(pcmData.buffer as ArrayBuffer);
  await writable.close();
}

/**
 * Loads the previously stored drum stem from OPFS.
 *
 * @returns Interleaved stereo Float32 PCM at 44.1 kHz.
 * @throws {Error} if the stem file does not exist.
 */
export async function loadDrumStem(projectId: string): Promise<Float32Array> {
  const stemsDir = await getStemsDir(projectId, false);
  const fileHandle = await stemsDir.getFileHandle('drums.pcm');
  const file = await fileHandle.getFile();
  return new Float32Array(await file.arrayBuffer());
}

/** Checks whether a drum stem has been stored for this project. */
export async function hasDrumStem(projectId: string): Promise<boolean> {
  try {
    const stemsDir = await getStemsDir(projectId, false);
    await stemsDir.getFileHandle('drums.pcm');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Separates the drum stem from a song and stores it to OPFS.
 *
 * @param projectId        - OPFS project ID.
 * @param interleavedAudio - Interleaved stereo Float32 PCM at 44.1 kHz.
 * @param onProgress       - Optional progress callback.
 * @returns Interleaved stereo drum-stem Float32 PCM at 44.1 kHz.
 */
export async function separateDrums(
  projectId: string,
  interleavedAudio: Float32Array,
  onProgress?: DrumSeparationProgressCallback,
): Promise<Float32Array> {
  ort.env.wasm.wasmPaths = ORT_WASM_CDN;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';

  // ---- 1. Load model (OPFS-cached download) ----
  onProgress?.({step: 'loading-model', percent: 0});
  const modelBytes = await getCachedModel(
    ROFORMER_MODEL_URL,
    ROFORMER_CACHE_KEY,
    msg => {
      const m = msg.match(/\((\d+)%\)/);
      if (m) {
        onProgress?.({step: 'loading-model', percent: parseInt(m[1], 10) / 100});
      }
    },
    ROFORMER_MIN_BYTES,
    'drum separator',
  );
  onProgress?.({step: 'loading-model', percent: 1});

  const session = await ort.InferenceSession.create(
    new Uint8Array(modelBytes),
    {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'disabled',
    },
  );

  try {
    // ---- 2. Deinterleave to planar L/R ----
    const numSamples = Math.floor(interleavedAudio.length / NUM_CHANNELS);
    const left = new Float32Array(numSamples);
    const right = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      left[i] = interleavedAudio[i * 2];
      right[i] = interleavedAudio[i * 2 + 1];
    }

    // ---- 3. Separate (stereo drum stem out) ----
    // Progress here is the within-step fraction (0-1); the caller maps each
    // step onto a monotonic sub-range of the overall separation bar.
    onProgress?.({step: 'processing', percent: 0});
    const stem = await separateDrumStem({
      ort,
      left,
      right,
      session,
      output: 'stereo',
      onProgress: ({segment, totalSegments, etaSec}) => {
        onProgress?.({
          step: 'processing',
          percent: segment / totalSegments,
          etaSeconds: etaSec,
        });
      },
    });

    // ---- 4. Interleave and store to OPFS ----
    onProgress?.({step: 'storing', percent: 0});
    const interleavedStem = new Float32Array(numSamples * NUM_CHANNELS);
    for (let i = 0; i < numSamples; i++) {
      interleavedStem[i * 2] = stem.left[i];
      interleavedStem[i * 2 + 1] = stem.right[i];
    }
    await storeDrumStem(projectId, interleavedStem);

    onProgress?.({step: 'done', percent: 1});
    return interleavedStem;
  } finally {
    await session.release();
  }
}
