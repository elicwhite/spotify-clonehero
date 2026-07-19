/**
 * BS-Roformer drum-stem separation for the drum transcription pipeline.
 *
 * Runs the shared bs-roformer-sw 6-stem separator
 * (lib/tempo-map/stem-separation.ts) and keeps only the drum stem, stored to
 * the fingerprint-keyed OPFS stem cache (storage/stem-cache.ts) as
 * interleaved stereo 44.1 kHz PCM. Keying by input fingerprint (audio bytes
 * + separator identity) rather than by project makes separation resumable
 * across tab closes AND reusable across projects created from the same
 * upload.
 *
 * The ORT session setup mirrors lib/tempo-map/pipeline-worker.ts (WebGPU with
 * WASM fallback, graph optimization disabled — required for this trace).
 */

import * as ort from 'onnxruntime-web';
import {getCachedModel} from '@/lib/lyrics-align/model-cache';
import {separateDrumStem} from '@/lib/tempo-map/stem-separation';
import {
  computeStemFingerprint,
  storeCachedStem,
  loadCachedStem,
  hasCachedStem,
} from '../storage/stem-cache';
import {
  getProject,
  updateProject,
  readOriginalAudio,
  loadAudioForDemucs,
} from '../storage/opfs';

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
// Fingerprint-keyed stem storage
// ---------------------------------------------------------------------------

/**
 * Identity of this separation configuration, hashed into the stem-cache
 * fingerprint. Includes the model URL plus the output shape, so a model bump
 * (or output-format change) invalidates cached stems.
 */
export const DRUM_SEPARATOR_ID = `${ROFORMER_MODEL_URL}|drums|stereo|44100`;

const DRUMS_STEM = 'drums';

/**
 * Returns the project's stem-cache fingerprint, computing and persisting it
 * to project metadata on first use.
 *
 * Hashes the stored original upload bytes when available (matches the
 * fingerprint computed at upload time for a fresh project); falls back to
 * the decoded full-mix PCM bytes for old projects created before the
 * original upload was stored.
 */
export async function ensureProjectStemFingerprint(
  projectId: string,
): Promise<string> {
  const meta = await getProject(projectId);
  if (meta.stemFingerprint) return meta.stemFingerprint;

  const original = await readOriginalAudio(projectId);
  const bytes = original
    ? original.data
    : ((await loadAudioForDemucs(projectId)).buffer as ArrayBuffer);
  const fingerprint = await computeStemFingerprint(bytes, DRUM_SEPARATOR_ID);
  await updateProject(projectId, {stemFingerprint: fingerprint});
  return fingerprint;
}

// Legacy per-project stem location ({projectId}/stems/drums.pcm), used by
// projects created before the fingerprint-keyed cache. Read-only fallback.
async function getLegacyStemsDir(projectId: string) {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle('drum-transcription', {
    create: false,
  });
  const projectDir = await nsDir.getDirectoryHandle(projectId, {create: false});
  return projectDir.getDirectoryHandle('stems', {create: false});
}

async function loadLegacyDrumStem(projectId: string): Promise<Float32Array> {
  const stemsDir = await getLegacyStemsDir(projectId);
  const fileHandle = await stemsDir.getFileHandle('drums.pcm');
  const file = await fileHandle.getFile();
  return new Float32Array(await file.arrayBuffer());
}

/**
 * Loads the separated drum stem for a project — from the fingerprint-keyed
 * cache, falling back to the legacy per-project location.
 *
 * @returns Interleaved stereo Float32 PCM at 44.1 kHz.
 * @throws {Error} if no stem exists in either location.
 */
export async function loadDrumStem(projectId: string): Promise<Float32Array> {
  try {
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    return await loadCachedStem(fingerprint, DRUMS_STEM);
  } catch {
    return loadLegacyDrumStem(projectId);
  }
}

/** Whether a separated drum stem is available for this project (in the
 * fingerprint cache or the legacy per-project location). */
export async function hasDrumStem(projectId: string): Promise<boolean> {
  try {
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    if (await hasCachedStem(fingerprint, DRUMS_STEM)) return true;
  } catch {
    // Fingerprint unavailable (e.g. no stored audio yet): legacy check below.
  }
  try {
    const stemsDir = await getLegacyStemsDir(projectId);
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
        onProgress?.({
          step: 'loading-model',
          percent: parseInt(m[1], 10) / 100,
        });
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

    // ---- 4. Interleave and store to the fingerprint-keyed stem cache ----
    onProgress?.({step: 'storing', percent: 0});
    const interleavedStem = new Float32Array(numSamples * NUM_CHANNELS);
    for (let i = 0; i < numSamples; i++) {
      interleavedStem[i * 2] = stem.left[i];
      interleavedStem[i * 2 + 1] = stem.right[i];
    }
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    await storeCachedStem(fingerprint, DRUMS_STEM, interleavedStem);

    onProgress?.({step: 'done', percent: 1});
    return interleavedStem;
  } finally {
    await session.release();
  }
}
