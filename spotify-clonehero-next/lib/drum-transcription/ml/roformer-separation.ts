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
 * The actual ONNX inference runs off the main thread in
 * ml/separation-worker.ts (mirrors lib/tempo-map/pipeline-worker.ts /
 * pipeline-client.ts) — `separateDrums` below is a thin client: deinterleave,
 * run the worker, then interleave + store the results. Opus-encoding the
 * vocals stem stays on the main thread because it uses OfflineAudioContext,
 * which isn't available in workers.
 */

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import type {SeparationWorkerMessage} from './separation-worker';
import {
  computeStemFingerprint,
  storeCachedStem,
  loadCachedStem,
  hasCachedStem,
  storeCachedStemOpus,
  loadCachedStemOpus,
  hasCachedStemOpus,
} from '../storage/stem-cache';
import {
  getProject,
  updateProject,
  readSongOpus,
  readOriginalAudio,
  loadFullMixPcm,
} from '../storage/opfs';

// Identity string only — the model itself is loaded inside
// ml/separation-worker.ts (same URL, so the OPFS model-cache download is
// shared with lib/tempo-map/pipeline-worker.ts).
const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';

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
const VOCALS_STEM = 'vocals';

/**
 * Returns the project's stem-cache fingerprint, computing and persisting it
 * to project metadata on first use.
 *
 * Hashes the stored Opus-at-rest bytes for current projects (matches the
 * fingerprint computed at upload time). Falls back to the stored original
 * upload bytes, then the decoded full-mix PCM bytes, for legacy projects
 * created before Opus-at-rest storage.
 */
export async function ensureProjectStemFingerprint(
  projectId: string,
): Promise<string> {
  const meta = await getProject(projectId);
  if (meta.stemFingerprint) return meta.stemFingerprint;

  const opus = await readSongOpus(projectId);
  let bytes: ArrayBuffer;
  if (opus) {
    bytes = opus;
  } else {
    const original = await readOriginalAudio(projectId);
    bytes = original
      ? original.data
      : ((await loadFullMixPcm(projectId)).buffer as ArrayBuffer);
  }
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

/**
 * Loads the separated vocals stem for a project, Opus-encoded, from the
 * fingerprint-keyed cache. Written opportunistically alongside the drum stem
 * ({@link separateDrums}) — absent for cache entries separated before vocals
 * capture was added; callers (the lyrics flow) re-run separation in that
 * case rather than treating this as an error.
 *
 * @returns Raw `.opus` file bytes.
 * @throws {Error} if no vocals stem exists in the cache.
 */
export async function loadVocalsStem(projectId: string): Promise<Uint8Array> {
  const fingerprint = await ensureProjectStemFingerprint(projectId);
  return loadCachedStemOpus(fingerprint, VOCALS_STEM);
}

/** Whether a separated vocals stem is available for this project. */
export async function hasVocalsStem(projectId: string): Promise<boolean> {
  try {
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    return await hasCachedStemOpus(fingerprint, VOCALS_STEM);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Separation worker client
// ---------------------------------------------------------------------------

interface SeparationWorkerResult {
  drumsLeft: Float32Array;
  drumsRight: Float32Array;
  vocalsLeft: Float32Array;
  vocalsRight: Float32Array;
}

function defaultCreateSeparationWorker(): Worker {
  return new Worker(new URL('./separation-worker.ts', import.meta.url), {
    type: 'module',
  });
}

/**
 * Spawns ml/separation-worker.ts, runs one separation, and terminates it
 * (one-shot, like lib/lyrics-align/demucs-client.ts) to reclaim WASM/GPU
 * memory. `left`/`right` are transferred to the worker (detached for the
 * caller).
 *
 * `createWorker` is an injectable factory (defaults to the real
 * separation-worker.ts) so tests can substitute a fake Worker without a real
 * Worker/module-URL environment — exported for that reason; not part of the
 * public API surface used outside this module and its tests.
 */
export function runSeparationInWorker(
  left: Float32Array,
  right: Float32Array,
  onProgress?: DrumSeparationProgressCallback,
  createWorker: () => Worker = defaultCreateSeparationWorker,
): Promise<SeparationWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = createWorker();

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as SeparationWorkerMessage;
      if (msg.type === 'progress') {
        onProgress?.({
          step: msg.step,
          percent: msg.percent,
          etaSeconds: msg.etaSeconds,
        });
      } else if (msg.type === 'result') {
        worker.terminate();
        const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} = msg;
        resolve({drumsLeft, drumsRight, vocalsLeft, vocalsRight});
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = e => {
      worker.terminate();
      reject(new Error(e.message || 'Separation worker error'));
    };

    worker.postMessage({type: 'run', left, right}, [left.buffer, right.buffer]);
  });
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
  // ---- 1. Deinterleave to planar L/R ----
  const numSamples = Math.floor(interleavedAudio.length / NUM_CHANNELS);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    left[i] = interleavedAudio[i * 2];
    right[i] = interleavedAudio[i * 2 + 1];
  }

  // ---- 2. Model load + separation, off the main thread ----
  const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} =
    await runSeparationInWorker(left, right, onProgress);

  // ---- 3. Interleave and store to the fingerprint-keyed stem cache ----
  // Drums stay raw PCM (may be reprocessed by the CRNN later); vocals are
  // Opus-encoded (only ever consumed for lyric alignment, not re-analyzed).
  // Opus encoding uses OfflineAudioContext, which is main-thread-only.
  onProgress?.({step: 'storing', percent: 0});
  const interleavedStem = new Float32Array(numSamples * NUM_CHANNELS);
  const interleavedVocals = new Float32Array(numSamples * NUM_CHANNELS);
  for (let i = 0; i < numSamples; i++) {
    interleavedStem[i * 2] = drumsLeft[i];
    interleavedStem[i * 2 + 1] = drumsRight[i];
    interleavedVocals[i * 2] = vocalsLeft[i];
    interleavedVocals[i * 2 + 1] = vocalsRight[i];
  }
  const fingerprint = await ensureProjectStemFingerprint(projectId);
  await storeCachedStem(fingerprint, DRUMS_STEM, interleavedStem);
  const vocalsOpus = await encodePcmToOpus(
    interleavedVocals,
    44100,
    NUM_CHANNELS,
  );
  await storeCachedStemOpus(fingerprint, VOCALS_STEM, vocalsOpus);

  onProgress?.({step: 'done', percent: 1});
  return interleavedStem;
}
