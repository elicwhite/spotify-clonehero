/**
 * BS-Roformer drum-stem separation for the drum transcription pipeline.
 *
 * Delegates the actual separation + caching to the project-agnostic
 * `lib/audio-pipeline/separate-stems.ts`, which runs the shared
 * bs-roformer-sw 6-stem separator (lib/tempo-map/stem-separation.ts) and
 * stores results in the fingerprint-keyed OPFS stem cache
 * (lib/audio-pipeline/stem-cache.ts). Keying by input fingerprint (audio
 * bytes + separator identity) rather than by project makes separation
 * resumable across tab closes AND reusable across projects created from the
 * same upload — and across other pages (`/tempo`, `/add-lyrics`) that share
 * the same cache.
 *
 * `separateDrums` below is a thin wrapper: resolve the project's original
 * audio bytes, delegate to `separateStems`, then do OPFS-project
 * bookkeeping (fingerprint persistence).
 */

import {encodePcmToOpus} from '@/lib/audio/opus-encoder';
import {
  runSeparationInWorker,
  separateStems,
  type DrumSeparationProgressCallback,
} from '@/lib/audio-pipeline/separate-stems';
import {
  computeStemFingerprint,
  ROFORMER_SEPARATOR_ID,
  storeStem,
  loadStem,
  hasStem,
  storeStemOpus,
  loadStemOpus,
  hasStemOpus,
} from '@/lib/audio-pipeline/stem-cache';
import {
  getProject,
  updateProject,
  readSongOpus,
  readOriginalAudio,
  loadFullMixPcm,
} from '../storage/opfs';

const NUM_CHANNELS = 2;

// ---------------------------------------------------------------------------
// Fingerprint-keyed stem storage
// ---------------------------------------------------------------------------

const DRUMS_STEM = 'drums';
const VOCALS_STEM = 'vocals';

/**
 * Returns the project's stem-cache fingerprint, computing and persisting it
 * to project metadata on first use.
 *
 * Hashes the stored verbatim original upload bytes for current projects —
 * matches what `/tempo` hashes for the same file, so the two pages can share
 * a stem cache. Falls back to the stored Opus-at-rest bytes, then the
 * decoded full-mix PCM bytes, for projects created before original-at-rest
 * storage.
 */
export async function ensureProjectStemFingerprint(
  projectId: string,
): Promise<string> {
  const meta = await getProject(projectId);
  if (meta.stemFingerprint) return meta.stemFingerprint;

  const original = await readOriginalAudio(projectId);
  let bytes: ArrayBuffer;
  if (original) {
    bytes = original.data;
  } else {
    const opus = await readSongOpus(projectId);
    bytes = opus ?? ((await loadFullMixPcm(projectId)).buffer as ArrayBuffer);
  }
  const fingerprint = await computeStemFingerprint(
    bytes,
    ROFORMER_SEPARATOR_ID,
  );
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
    const stem = await loadStem(fingerprint, DRUMS_STEM);
    if (stem) {
      const n = Math.min(stem.left.length, stem.right.length);
      const interleaved = new Float32Array(n * NUM_CHANNELS);
      for (let i = 0; i < n; i++) {
        interleaved[i * 2] = stem.left[i];
        interleaved[i * 2 + 1] = stem.right[i];
      }
      return interleaved;
    }
  } catch {
    // Fingerprint unavailable (e.g. no stored audio yet): legacy fallback below.
  }
  return loadLegacyDrumStem(projectId);
}

/** Whether a separated drum stem is available for this project (in the
 * fingerprint cache or the legacy per-project location). */
export async function hasDrumStem(projectId: string): Promise<boolean> {
  try {
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    if (await hasStem(fingerprint, DRUMS_STEM)) return true;
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
  const vocals = await loadStemOpus(fingerprint, VOCALS_STEM);
  if (!vocals) throw new Error('No vocals stem in cache');
  return vocals;
}

/** Whether a separated vocals stem is available for this project. */
export async function hasVocalsStem(projectId: string): Promise<boolean> {
  try {
    const fingerprint = await ensureProjectStemFingerprint(projectId);
    return await hasStemOpus(fingerprint, VOCALS_STEM);
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
 * Thin wrapper around `separateStems`: for current projects (which store the
 * original upload verbatim), delegates to it directly against those bytes —
 * the fingerprint `separateStems` computes matches
 * `ensureProjectStemFingerprint`'s exactly (both hash `readOriginalAudio`
 * first), so the stem it stores is found under the project's fingerprint.
 * Legacy projects with no stored original (only `full.pcm`/`song.opus`) fall
 * back to separating the passed-in PCM directly, same as before this
 * refactor.
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
  const original = await readOriginalAudio(projectId);

  if (original) {
    const {drums} = await separateStems(
      new Uint8Array(original.data),
      {drums: true, vocals: true},
      onProgress,
    );
    await ensureProjectStemFingerprint(projectId);
    const stem = drums!;
    const n = Math.min(stem.left.length, stem.right.length);
    const interleavedStem = new Float32Array(n * NUM_CHANNELS);
    for (let i = 0; i < n; i++) {
      interleavedStem[i * 2] = stem.left[i];
      interleavedStem[i * 2 + 1] = stem.right[i];
    }
    return interleavedStem;
  }

  // ---- Legacy fallback: no stored original — separate the passed-in PCM
  // directly (the pre-Phase-3 path). ----
  const numSamples = Math.floor(interleavedAudio.length / NUM_CHANNELS);
  const left = new Float32Array(numSamples);
  const right = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    left[i] = interleavedAudio[i * 2];
    right[i] = interleavedAudio[i * 2 + 1];
  }

  const {drumsLeft, drumsRight, vocalsLeft, vocalsRight} =
    await runSeparationInWorker(left, right, onProgress);

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
  await storeStem(fingerprint, DRUMS_STEM, {
    left: drumsLeft,
    right: drumsRight,
  });
  const vocalsOpus = await encodePcmToOpus(
    interleavedVocals,
    44100,
    NUM_CHANNELS,
  );
  await storeStemOpus(fingerprint, VOCALS_STEM, vocalsOpus);

  onProgress?.({step: 'done', percent: 1});
  return interleavedStem;
}
