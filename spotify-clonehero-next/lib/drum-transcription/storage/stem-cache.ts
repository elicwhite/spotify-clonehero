/**
 * Fingerprint-keyed OPFS cache for separated stems.
 *
 * Stems are keyed by a content fingerprint of the *input* audio plus the
 * identity of the separator that produced them — not by project — so two
 * projects created from the same upload (or a project regeneration) reuse
 * the already-separated stem instead of re-running the GPU separation.
 *
 * Layout:
 *   drum-transcription/
 *     stem-cache/
 *       {fingerprint}/
 *         drums.pcm    - interleaved stereo Float32 @ 44.1 kHz
 *
 * The fingerprint is a SHA-256 over the raw audio bytes followed by a NUL
 * separator and the UTF-8 separator id, so changing either the audio or any
 * separation-relevant input (e.g. the model) yields a different cache entry.
 */

const NAMESPACE = 'drum-transcription';

/** Directory name under the namespace holding fingerprint-keyed stems.
 * Exported so project listing can skip it (it is not a project). */
export const STEM_CACHE_DIR = 'stem-cache';

/**
 * Computes the cache fingerprint for an audio input + separator identity.
 *
 * @param audioBytes  - The raw uploaded audio file bytes (or, as a fallback
 *                      for projects without a stored original, the decoded
 *                      PCM bytes).
 * @param separatorId - Identity string of the separation configuration
 *                      (model + output format); see DRUM_SEPARATOR_ID.
 * @returns Lowercase SHA-256 hex digest.
 */
export async function computeStemFingerprint(
  audioBytes: ArrayBuffer | Uint8Array,
  separatorId: string,
): Promise<string> {
  const audio =
    audioBytes instanceof Uint8Array ? audioBytes : new Uint8Array(audioBytes);
  const id = new TextEncoder().encode(separatorId);
  const input = new Uint8Array(audio.length + 1 + id.length);
  input.set(audio, 0);
  input[audio.length] = 0;
  input.set(id, audio.length + 1);

  const digest = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function getCacheEntryDir(
  fingerprint: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle(NAMESPACE, {create});
  const cacheDir = await nsDir.getDirectoryHandle(STEM_CACHE_DIR, {create});
  return cacheDir.getDirectoryHandle(fingerprint, {create});
}

/** Stores a stem (interleaved stereo Float32 @ 44.1 kHz) in the cache. */
export async function storeCachedStem(
  fingerprint: string,
  stemName: string,
  pcmData: Float32Array,
): Promise<void> {
  const dir = await getCacheEntryDir(fingerprint, true);
  const fileHandle = await dir.getFileHandle(`${stemName}.pcm`, {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(pcmData.buffer as ArrayBuffer);
  await writable.close();
}

/**
 * Loads a cached stem.
 *
 * @returns Interleaved stereo Float32 PCM at 44.1 kHz.
 * @throws {Error} if the cache entry does not exist.
 */
export async function loadCachedStem(
  fingerprint: string,
  stemName: string,
): Promise<Float32Array> {
  const dir = await getCacheEntryDir(fingerprint, false);
  const fileHandle = await dir.getFileHandle(`${stemName}.pcm`);
  const file = await fileHandle.getFile();
  return new Float32Array(await file.arrayBuffer());
}

/** Whether a stem is present in the cache for this fingerprint. */
export async function hasCachedStem(
  fingerprint: string,
  stemName: string,
): Promise<boolean> {
  try {
    const dir = await getCacheEntryDir(fingerprint, false);
    await dir.getFileHandle(`${stemName}.pcm`);
    return true;
  } catch {
    return false;
  }
}
