/**
 * Canonical fingerprint-keyed OPFS cache for separated stems, shared by
 * every ML pipeline that runs BS-Roformer (`/drum-transcription`, `/tempo`,
 * `/add-lyrics`) — so separating a given file once, from any page, satisfies
 * the others instead of each page re-running the ~336MB model + a full GPU
 * pass on data already sitting in OPFS under a different name.
 *
 * Stems are keyed by a content fingerprint of the *input* audio plus the
 * identity of the separator that produced them — not by project — so two
 * projects created from the same upload (or a project regeneration) reuse
 * the already-separated stem.
 *
 * Layout:
 *   audio-pipeline/
 *     stem-cache/
 *       {fingerprint}/
 *         drums.f32.gz   - gzip-compressed planar [L‖R] Float32 @ 44.1 kHz
 *         vocals.opus    - Opus-encoded stem (lossy; fine for stems that
 *                            aren't fed back into a byte-exact-required
 *                            pipeline stage, e.g. vocals for alignment)
 *
 * The fingerprint is a SHA-256 over the raw audio bytes followed by a NUL
 * separator and the UTF-8 separator id, so changing either the audio or any
 * separation-relevant input (e.g. the model, resampler, or precision) yields
 * a different cache entry.
 */

const NAMESPACE = 'audio-pipeline';

/** Directory name under the namespace holding fingerprint-keyed stems. */
export const STEM_CACHE_DIR = 'stem-cache';

/**
 * Computes the cache fingerprint for an audio input + separator identity.
 *
 * @param audioBytes  - The raw uploaded audio file bytes (or, as a fallback
 *                      for projects without a stored original, the decoded
 *                      PCM bytes).
 * @param separatorId - Identity string of the separation configuration
 *                      (model + output format); see ROFORMER_SEPARATOR_ID.
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

export const ROFORMER_MODEL_URL =
  'https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx';

/**
 * Identity of the current BS-Roformer separation configuration. Both
 * `/drum-transcription` and `/tempo` run overlapFrac 0.25, the fp16 model
 * (also implicit in the model filename), and libsoxr resampling, so the id
 * is self-describing rather than relying on a human-maintained free-text
 * version string to bump on drift.
 *
 * Changing this string is a cache-invalidating identity bump: it changes
 * every future fingerprint, so it naturally never collides with entries
 * cached under the old id (old entries are simply abandoned, not migrated).
 */
export const ROFORMER_SEPARATOR_ID = `${ROFORMER_MODEL_URL}|drums|stereo|44100|overlap0.25|fp16|libsoxr`;

// ---------------------------------------------------------------------------
// Planar gzip format — [L‖R] Float32, gzip-compressed. Lossless, so cache-hit
// runs feed CRNN/Beat This! byte-identical audio to a fresh separation (a
// lossy codec like Opus would break that guarantee); drum stems' long
// near-silent stretches make it worthwhile anyway. Stereo is required
// because the CRNN transcriber is a stereo model.
// ---------------------------------------------------------------------------

export interface StereoStem {
  left: Float32Array;
  right: Float32Array;
}

/** Pack a planar stereo stem into a single [L‖R] buffer for storage.
 * Channels are truncated to the shorter of the two lengths. */
export function packStereoStem(stem: StereoStem): Float32Array<ArrayBuffer> {
  const n = Math.min(stem.left.length, stem.right.length);
  const packed = new Float32Array(n * 2);
  packed.set(stem.left.subarray(0, n), 0);
  packed.set(stem.right.subarray(0, n), n);
  return packed;
}

/**
 * Unpack a stored [L‖R] buffer back into planar stereo. Returns null when
 * the buffer isn't exactly 2×`sampleCount` floats (wrong song length or a
 * corrupt/legacy cache entry).
 */
export function unpackStereoStem(
  packed: Float32Array,
  sampleCount: number,
): StereoStem | null {
  if (packed.length !== sampleCount * 2) return null;
  return {
    left: packed.subarray(0, sampleCount),
    right: packed.subarray(sampleCount),
  };
}

/** Pump bytes through a gzip (de)compression transform. Written against
 * the stream classes directly — no Blob/Response — so it runs in web
 * workers and in Jest's node environment alike. The write side is not
 * awaited before reading: awaiting it first would deadlock once the
 * transform's internal queue fills. */
async function pumpThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<BufferSource>;
  },
): Promise<Uint8Array<ArrayBuffer>> {
  const writer = transform.writable.getWriter();
  const writeDone = writer.write(bytes).then(() => writer.close());
  // If the transform errors, the reader loop below throws first and this
  // rejection would otherwise be unhandled.
  writeDone.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = transform.readable.getReader();
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await writeDone;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Pack and gzip a stereo stem into the bytes stored in OPFS. */
export async function encodeStemCacheBytes(
  stem: StereoStem,
): Promise<Uint8Array<ArrayBuffer>> {
  const packed = packStereoStem(stem);
  return pumpThrough(
    new Uint8Array(packed.buffer, 0, packed.byteLength),
    new CompressionStream('gzip'),
  );
}

/**
 * Gunzip and unpack stored cache bytes back into planar stereo. Returns
 * null for anything unusable: gunzip failure (corrupt or legacy raw-f32
 * entry), a byte count that isn't whole float32s, or a sample count that
 * doesn't match the expected song length.
 */
export async function decodeStemCacheBytes(
  bytes: Uint8Array<ArrayBuffer>,
  sampleCount: number,
): Promise<StereoStem | null> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = await pumpThrough(bytes, new DecompressionStream('gzip'));
  } catch {
    return null;
  }
  if (raw.byteLength % 4 !== 0) return null;
  const packed = new Float32Array(raw.buffer, 0, raw.byteLength / 4);
  return unpackStereoStem(packed, sampleCount);
}

/**
 * Gunzip and unpack stored cache bytes back into planar stereo, inferring
 * the sample count from the stored length rather than requiring the caller
 * to already know it. Unlike `decodeStemCacheBytes` (used by the tempo
 * worker, which knows the expected song length up front), this is the
 * loader path for a fingerprint-keyed cache entry where the sample count
 * isn't known externally. Returns null for anything unusable: gunzip
 * failure (corrupt or legacy entry), or a byte count that isn't a whole,
 * non-empty number of [L‖R] float32 pairs.
 */
export async function decodeStemCacheBytesAuto(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<StereoStem | null> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = await pumpThrough(bytes, new DecompressionStream('gzip'));
  } catch {
    return null;
  }
  if (raw.byteLength === 0 || raw.byteLength % 8 !== 0) return null;
  const packed = new Float32Array(raw.buffer, 0, raw.byteLength / 4);
  const n = packed.length / 2;
  return unpackStereoStem(packed, n);
}

/** Mean-of-channels mono mixdown — the signal Beat This! and the
 * drum-onset stage consume. */
export function stereoStemToMono(stem: StereoStem): Float32Array {
  const n = Math.min(stem.left.length, stem.right.length);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mono[i] = (stem.left[i] + stem.right[i]) * 0.5;
  }
  return mono;
}

// ---------------------------------------------------------------------------
// OPFS cache API
// ---------------------------------------------------------------------------

async function getCacheEntryDir(
  fingerprint: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const nsDir = await root.getDirectoryHandle(NAMESPACE, {create});
  const cacheDir = await nsDir.getDirectoryHandle(STEM_CACHE_DIR, {create});
  return cacheDir.getDirectoryHandle(fingerprint, {create});
}

/** Stores a stem (planar stereo Float32 @ 44.1 kHz) in the cache, gzipped. */
export async function storeStem(
  fingerprint: string,
  stemName: string,
  stem: StereoStem,
): Promise<void> {
  const bytes = await encodeStemCacheBytes(stem);
  const dir = await getCacheEntryDir(fingerprint, true);
  const fileHandle = await dir.getFileHandle(`${stemName}.f32.gz`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

/** Loads a cached stem. Returns null on a cache miss or a corrupt entry —
 * never throws — matching the safer default for a cache. */
export async function loadStem(
  fingerprint: string,
  stemName: string,
): Promise<StereoStem | null> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const dir = await getCacheEntryDir(fingerprint, false);
    const fileHandle = await dir.getFileHandle(`${stemName}.f32.gz`);
    const file = await fileHandle.getFile();
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
  return decodeStemCacheBytesAuto(bytes);
}

/** Whether a stem is present in the cache for this fingerprint. */
export async function hasStem(
  fingerprint: string,
  stemName: string,
): Promise<boolean> {
  try {
    const dir = await getCacheEntryDir(fingerprint, false);
    await dir.getFileHandle(`${stemName}.f32.gz`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Opus-encoded stems (e.g. vocals — kept Opus-encoded rather than raw PCM,
// unlike drums, which may be reprocessed by the CRNN later)
// ---------------------------------------------------------------------------

/** Stores an already Opus-encoded stem in the cache. */
export async function storeStemOpus(
  fingerprint: string,
  stemName: string,
  opusBytes: Uint8Array,
): Promise<void> {
  const dir = await getCacheEntryDir(fingerprint, true);
  const fileHandle = await dir.getFileHandle(`${stemName}.opus`, {
    create: true,
  });
  const writable = await fileHandle.createWritable();
  await writable.write(opusBytes as Uint8Array<ArrayBuffer>);
  await writable.close();
}

/** Loads a cached Opus-encoded stem's raw bytes (undecoded). Returns null
 * on a cache miss — never throws. */
export async function loadStemOpus(
  fingerprint: string,
  stemName: string,
): Promise<Uint8Array | null> {
  try {
    const dir = await getCacheEntryDir(fingerprint, false);
    const fileHandle = await dir.getFileHandle(`${stemName}.opus`);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return null;
  }
}

/** Whether an Opus-encoded stem is present in the cache for this fingerprint. */
export async function hasStemOpus(
  fingerprint: string,
  stemName: string,
): Promise<boolean> {
  try {
    const dir = await getCacheEntryDir(fingerprint, false);
    await dir.getFileHandle(`${stemName}.opus`);
    return true;
  } catch {
    return false;
  }
}
