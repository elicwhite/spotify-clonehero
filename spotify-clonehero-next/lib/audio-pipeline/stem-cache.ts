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

import {MODEL_URLS} from '@/lib/lyrics-align/model-urls';
import {
  getCacheDir,
  getCacheDirs,
  getStoragePressure,
} from '@/lib/browser-storage';
import {
  getWebLocks,
  STEM_CACHE_PRUNE_LOCK,
  withWebLockIfAvailable,
} from '@/lib/web-locks';
import {
  DEFAULT_STEM_CACHE_BUDGETS,
  stemCacheBudgetBytes,
  type StemCacheBudgets,
} from '@/lib/audio-pipeline/stem-cache-budget';

const NAMESPACE = 'audio-pipeline';

/** The rate every cached stem is stored at — the separator's own, and the
 *  one a reader has to assume, since neither the gzipped planar format nor
 *  the fingerprint carries a rate. */
export const STEM_CACHE_SAMPLE_RATE = 44100;

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

/** Sample rate the Demucs vocals stem is produced (and cached) at — the
 *  aligner's input rate, which is all that separation is run for. */
export const DEMUCS_VOCALS_SAMPLE_RATE = 16000;

/**
 * Identity of the `add-lyrics` Demucs fallback separation, which produces
 * 16 kHz MONO vocals rather than BS-Roformer's 44.1 kHz stereo. It has its own
 * id — and therefore its own cache entry — precisely because the two are not
 * interchangeable: a `vocals` entry under {@link ROFORMER_SEPARATOR_ID} is
 * handed to callers as roformer output, and a mono 16 kHz stem there would be
 * a silent quality regression for every one of them.
 */
export const DEMUCS_SEPARATOR_ID = `${MODEL_URLS.demucs}|vocals|mono|${DEMUCS_VOCALS_SAMPLE_RATE}|fp32`;

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

/**
 * Where cache entries are written, and everywhere they are read from.
 *
 * New entries go to the cache bucket. Entries written before that bucket
 * existed stay where they are and are read in place — copying them would
 * double the footprint of a user who is, by hypothesis, already short of
 * room, which is the moment a copy is most likely to fail or to cause the
 * eviction it was meant to prevent. The pruner walks both roots, so an entry
 * in the old one is reclaimed once it falls out of use.
 */
const STEM_CACHE_PATH = [NAMESPACE, STEM_CACHE_DIR];

/** The directory new entries are written to. */
function getStemCacheDir(): Promise<FileSystemDirectoryHandle> {
  return getCacheDir(STEM_CACHE_PATH);
}

/** Every directory entries are read from, the written-to one first. */
function getStemCacheDirs(): Promise<FileSystemDirectoryHandle[]> {
  return getCacheDirs(STEM_CACHE_PATH);
}

/** The directory a new entry is written into. */
async function createCacheEntryDir(
  fingerprint: string,
): Promise<FileSystemDirectoryHandle> {
  const cacheDir = await getStemCacheDir();
  return cacheDir.getDirectoryHandle(fingerprint, {create: true});
}

/**
 * The entry directory holding a usable `payloadName`, or null.
 *
 * A usable payload picks the root, not the entry directory and not the file's
 * mere existence. `getFileHandle(name, {create: true})` materializes a
 * zero-length file before anything is written to it, so an interrupted store
 * leaves a payload that exists and holds nothing. Selecting on existence
 * would let that placeholder in the bucket hide a complete copy of the same
 * stem in the older root, and the song would be separated again on every run.
 *
 * An entry can also be split across the roots — the drums re-stored into the
 * bucket while the vocals of the same song are still in the older one — so
 * each payload is resolved on its own. This is the rule `opfsProjectStore`
 * uses to decide which namespace owns a project.
 */
async function findCacheEntryDir(
  fingerprint: string,
  payloadName: string,
): Promise<FileSystemDirectoryHandle | null> {
  for (const cacheDir of await getStemCacheDirs()) {
    try {
      const dir = await cacheDir.getDirectoryHandle(fingerprint);
      if (await hasMarked(dir, payloadName)) return dir;
    } catch {
      // No entry for this fingerprint in this root.
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry completion marker.
//
// A payload write is already atomic on its own: `createWritable()` writes to
// a swap file and commits it to the target on `close()`, so an interrupted
// store (cancelled fetch, worker terminated mid-store, tab closed) leaves the
// file exactly as it was — previous contents for a re-store, or the
// zero-length file `getFileHandle(…, {create: true})` materialized for a
// first store. A partially-written payload is never observable.
//
// The one thing that isn't self-describing is that zero-length placeholder,
// so each payload `<name>` gets a sibling `<name>.ok`, written once the
// payload has fully landed. Probes and loads agree on what counts as present:
//
//   - `<name>.ok` present            -> complete, hit.
//   - no marker, payload non-empty   -> an entry written before the marker
//                                       existed (or a store interrupted
//                                       between close and marker). Loaders
//                                       validate the payload and backfill the
//                                       marker; probes accept it.
//   - no marker, payload empty       -> an interrupted first store, miss.
//
// Emptiness is read from the file's size, so probes stay a metadata check —
// no decode, no payload read.
//
// The marker carries a second thing: its modification time is when the entry
// was last used, which is what the pruner sorts on. A read leaves no trace of
// its own, so a load stamps the marker on the way out — after it has
// validated the payload, never before. That makes a load a write, and a probe
// still not one.
// ---------------------------------------------------------------------------

function markerName(payloadName: string): string {
  return `${payloadName}.ok`;
}

/** Creates an empty file, overwriting any existing one. */
async function touchFile(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<void> {
  const handle = await dir.getFileHandle(name, {create: true});
  const writable = await handle.createWritable();
  await writable.close();
}

async function entryExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** Whether `name` exists and holds at least one byte. Metadata only. */
async function nonEmptyEntryExists(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<boolean> {
  try {
    const handle = await dir.getFileHandle(name);
    return (await handle.getFile()).size > 0;
  } catch {
    return false;
  }
}

/** Writes `bytes` to `payloadName` inside `dir`, then marks it complete. */
async function writeMarked(
  dir: FileSystemDirectoryHandle,
  payloadName: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(payloadName, {create: true});
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  await touchFile(dir, markerName(payloadName));
}

/** Reads `payloadName`'s bytes. Throws (callers catch and treat as a miss)
 * when the payload itself is missing. The marker is not consulted: a loader
 * validates the payload itself, and stamps the marker afterwards whether or
 * not one was already there. */
async function readPayload(
  dir: FileSystemDirectoryHandle,
  payloadName: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const fileHandle = await dir.getFileHandle(payloadName);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * Stamps a payload's marker after a loader has read it.
 *
 * The marker does two jobs. It says the payload is complete, so a later probe
 * accepts it without re-reading. Its modification time also says when the
 * entry was last used, which is what the pruner sorts on — a read leaves no
 * trace of its own, so the write here is the only record that the entry is
 * still wanted.
 *
 * Best effort. A failure costs the next probe a validation pass, and makes
 * the entry look older than it is.
 */
async function markUsed(
  dir: FileSystemDirectoryHandle,
  payloadName: string,
): Promise<void> {
  try {
    await touchFile(dir, markerName(payloadName));
  } catch {
    // Read-only/quota-exhausted storage: the entry stays unmarked.
  }
}

/** Cheap existence probe: the completion marker, or a non-empty unmarked
 * payload. Metadata only - no decode, no payload read. */
async function hasMarked(
  dir: FileSystemDirectoryHandle,
  payloadName: string,
): Promise<boolean> {
  if (await entryExists(dir, markerName(payloadName))) return true;
  return nonEmptyEntryExists(dir, payloadName);
}

/** Stores an already-encoded (`encodeStemCacheBytes`) stem payload. The entry
 * point for callers that gzipped elsewhere - on the main thread that means
 * `pcm-worker.ts`, since Blink deflates a single write in one uninterrupted
 * task. Atomic: an interrupted store never leaves a later load/probe seeing a
 * truncated payload. Prunes the cache to its budget afterwards, protecting
 * the fingerprint just written. */
export async function storeStemBytes(
  fingerprint: string,
  stemName: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = await createCacheEntryDir(fingerprint);
  await writeMarked(
    dir,
    `${stemName}.f32.gz`,
    bytes as Uint8Array<ArrayBuffer>,
  );
  await pruneStemCacheToBudget([fingerprint]);
}

/** Stores a stem (planar stereo Float32 @ 44.1 kHz) in the cache, gzipping it
 * on the calling thread. Used from worker contexts (e.g. the tempo pipeline
 * worker), which are already off the main thread. */
export async function storeStem(
  fingerprint: string,
  stemName: string,
  stem: StereoStem,
): Promise<void> {
  await storeStemBytes(fingerprint, stemName, await encodeStemCacheBytes(stem));
}

/** Loads a cached stem. Returns null on a cache miss, an interrupted write,
 * or a corrupt entry — never throws — matching the safer default for a
 * cache. A hit stamps the entry's marker on the way out: that is what makes
 * it complete for later probes, and what records it as recently used. */
export async function loadStem(
  fingerprint: string,
  stemName: string,
): Promise<StereoStem | null> {
  const payloadName = `${stemName}.f32.gz`;
  const dir = await findCacheEntryDir(fingerprint, payloadName);
  if (dir == null) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readPayload(dir, payloadName);
  } catch {
    return null;
  }
  const stem = await decodeStemCacheBytesAuto(bytes);
  if (!stem) return null;
  await markUsed(dir, payloadName);
  return stem;
}

/** Whether a stem is present in the cache for this fingerprint. Metadata
 * check only (the completion marker, or a non-empty unmarked payload) - no
 * decode, no payload read. An entry left behind by an interrupted first
 * store reports false. */
export async function hasStem(
  fingerprint: string,
  stemName: string,
): Promise<boolean> {
  return (await findCacheEntryDir(fingerprint, `${stemName}.f32.gz`)) != null;
}

// ---------------------------------------------------------------------------
// Opus-encoded stems (e.g. vocals — kept Opus-encoded rather than raw PCM,
// unlike drums, which may be reprocessed by the CRNN later)
// ---------------------------------------------------------------------------

/** Stores an already Opus-encoded stem in the cache. Atomic: an interrupted
 * store never leaves a later load/probe seeing a truncated payload. Prunes
 * the cache to its budget afterwards, protecting the fingerprint just
 * written. */
export async function storeStemOpus(
  fingerprint: string,
  stemName: string,
  opusBytes: Uint8Array,
): Promise<void> {
  const dir = await createCacheEntryDir(fingerprint);
  await writeMarked(
    dir,
    `${stemName}.opus`,
    opusBytes as Uint8Array<ArrayBuffer>,
  );
  await pruneStemCacheToBudget([fingerprint]);
}

/** Loads a cached Opus-encoded stem's raw bytes (undecoded). Returns null
 * on a cache miss, an interrupted write, or an empty payload — never throws.
 * A hit stamps the entry's marker on the way out: that is what makes it
 * complete for later probes, and what records it as recently used. */
export async function loadStemOpus(
  fingerprint: string,
  stemName: string,
): Promise<Uint8Array | null> {
  const payloadName = `${stemName}.opus`;
  const dir = await findCacheEntryDir(fingerprint, payloadName);
  if (dir == null) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readPayload(dir, payloadName);
  } catch {
    return null;
  }
  if (bytes.byteLength === 0) return null;
  await markUsed(dir, payloadName);
  return bytes;
}

/** Whether an Opus-encoded stem is present in the cache for this
 * fingerprint. Metadata check only (the completion marker, or a non-empty
 * unmarked payload) - no decode, no payload read. An entry left behind by an
 * interrupted first store reports false. */
export async function hasStemOpus(
  fingerprint: string,
  stemName: string,
): Promise<boolean> {
  return (await findCacheEntryDir(fingerprint, `${stemName}.opus`)) != null;
}

// ---------------------------------------------------------------------------
// Pruning
//
// Chrome evicts an origin under storage pressure and takes everything: the
// chart projects and the database go with the stems. The stems are the large
// regenerable part, so holding them inside a budget is the one part of the
// origin this code can keep from growing without limit. It does not make
// eviction impossible — the projects, the project audio, the database and the
// model cache are all unbounded — it keeps the cache from being the reason.
//
// Every store prunes, because `separateStems` is not the only thing that
// writes here: the tempo worker separates and stores on its own, and so does
// the drum-transcription path for a project with no stored original. The
// store functions are the one place all of them pass through.
// ---------------------------------------------------------------------------

export interface StemCacheEntry {
  fingerprint: string;
  /** Every file in the entry: payloads and markers. */
  sizeBytes: number;
  /**
   * Newest marker time in the entry, in ms. An entry holds several payloads —
   * `/tempo` reads the drums, `/add-lyrics` the vocals — and any one of them
   * being read means the entry is in use, so the newest marker wins.
   *
   * 0 for an entry with no marker at all: one written before markers existed,
   * or one whose store was interrupted. Both sort oldest, which is where a
   * cache entry nobody can date belongs.
   */
  lastUsedMs: number;
}

export interface PruneResult {
  deletedFingerprints: string[];
  freedBytes: number;
  /** Cache size after the prune, including entries `keep` protected. */
  remainingBytes: number;
}

/**
 * Measures every entry in the cache. Metadata only — no payload is read.
 *
 * An entry that cannot be measured is skipped rather than reported as empty,
 * because a zero-byte entry sorts as free to delete and would be deleted for
 * nothing. Such an entry is also never reclaimed, which is the right trade
 * while the alternative is deleting stems on a failed read.
 */
export async function listStemCacheEntries(): Promise<StemCacheEntry[]> {
  return (await measureAllEntries()).map(
    ({fingerprint, sizeBytes, lastUsedMs}) => ({
      fingerprint,
      sizeBytes,
      lastUsedMs,
    }),
  );
}

/** An entry, plus the directory it has to be deleted from. The same
 *  fingerprint can be in both roots: a re-store lands in the bucket while the
 *  older copy is still in the default root, and both take up room. */
interface LocatedEntry extends StemCacheEntry {
  parent: FileSystemDirectoryHandle;
}

async function measureAllEntries(): Promise<LocatedEntry[]> {
  const entries: LocatedEntry[] = [];
  for (const cacheDir of await getStemCacheDirs()) {
    for await (const [fingerprint, handle] of cacheDir.entries()) {
      if (handle.kind !== 'directory') continue;
      try {
        entries.push({
          ...(await measureEntry(fingerprint, handle)),
          parent: cacheDir,
        });
      } catch {
        // Deleted by another tab mid-walk, or unreadable. Not a candidate.
      }
    }
  }
  return entries;
}

async function measureEntry(
  fingerprint: string,
  dir: FileSystemDirectoryHandle,
): Promise<StemCacheEntry> {
  let sizeBytes = 0;
  let lastUsedMs = 0;
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    const file = await handle.getFile();
    sizeBytes += file.size;
    if (name.endsWith('.ok')) {
      lastUsedMs = Math.max(lastUsedMs, file.lastModified);
    }
  }
  return {fingerprint, sizeBytes, lastUsedMs};
}

/**
 * Removes one entry and everything in it. False when it is still there
 * afterwards: never stored, or a file inside it is open in another context,
 * which OPFS refuses to remove.
 */
export async function deleteStemEntry(fingerprint: string): Promise<boolean> {
  let deleted = false;
  for (const cacheDir of await getStemCacheDirs()) {
    // Every root, not the first hit: an entry in both takes room in both.
    if (await removeEntryFrom(cacheDir, fingerprint)) deleted = true;
  }
  return deleted;
}

async function removeEntryFrom(
  cacheDir: FileSystemDirectoryHandle,
  fingerprint: string,
): Promise<boolean> {
  try {
    await cacheDir.removeEntry(fingerprint, {recursive: true});
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes whole entries, least recently used first, until the cache fits in
 * `targetBytes`. Answers null when another context is already pruning.
 *
 * Whole entries, because half an entry is a cache miss that still occupies
 * the disk. `keep` names the fingerprints the caller is working with; they
 * count toward the total but are never deleted, so a caller that is about to
 * write a stem cannot have it deleted underneath itself.
 *
 * `keep` covers the calling context only. Another tab mid-pipeline is
 * invisible here, and an entry deleted under it costs that tab a separation —
 * `loadStem` answers null for every failure, so nothing breaks, it only takes
 * longer.
 */
export async function pruneStemCache(options: {
  targetBytes: number;
  keep?: Iterable<string>;
  /**
   * Room to leave for this many entries the size of the largest one, even
   * where `targetBytes` is smaller. A cache that cannot hold two songs makes
   * a user working across two of them re-separate on every switch, which
   * costs minutes of GPU to save disk that is about to be used again.
   *
   * 0, the default, prunes to exactly `targetBytes` — which is how the cache
   * is emptied on request.
   */
  keepRoomForLargest?: number;
}): Promise<PruneResult | null> {
  const locks = getWebLocks();
  if (locks == null) return pruneUnlocked(options);
  return withWebLockIfAvailable(STEM_CACHE_PRUNE_LOCK, locks, () =>
    pruneUnlocked(options),
  );
}

async function pruneUnlocked(options: {
  targetBytes: number;
  keep?: Iterable<string>;
  keepRoomForLargest?: number;
}): Promise<PruneResult> {
  const keep = new Set(options.keep ?? []);

  const entries = await measureAllEntries();
  let totalBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const largestBytes = entries.reduce(
    (max, entry) => Math.max(max, entry.sizeBytes),
    0,
  );
  const targetBytes = Math.max(
    options.targetBytes,
    largestBytes * (options.keepRoomForLargest ?? 0),
  );

  const deletedFingerprints: string[] = [];
  let freedBytes = 0;

  // Oldest first, and by fingerprint where the times are equal: two entries
  // stamped in the same millisecond must not make the deletion order depend
  // on the order the directory happened to list them in.
  const candidates = entries
    .filter(entry => !keep.has(entry.fingerprint))
    .sort(
      (a, b) =>
        a.lastUsedMs - b.lastUsedMs || (a.fingerprint < b.fingerprint ? -1 : 1),
    );

  for (const entry of candidates) {
    if (totalBytes <= targetBytes) break;
    // An entry that would not delete stays on the disk and in the total.
    // Counting it as freed would end the prune early and report bytes that
    // are still there.
    if (!(await removeEntryFrom(entry.parent, entry.fingerprint))) continue;
    totalBytes -= entry.sizeBytes;
    freedBytes += entry.sizeBytes;
    deletedFingerprints.push(entry.fingerprint);
  }

  return {deletedFingerprints, freedBytes, remainingBytes: totalBytes};
}

/**
 * Prunes to the budget the current origin pressure allows.
 *
 * Returns null when the prune did not run — another context holds the lock,
 * or something failed. Nothing here is worth failing a store over: the cost
 * of a skipped prune is disk, and the next store prunes again.
 */
export async function pruneStemCacheToBudget(
  keep: Iterable<string> = [],
  budgets: StemCacheBudgets = DEFAULT_STEM_CACHE_BUDGETS,
): Promise<PruneResult | null> {
  try {
    const pressure = await getStoragePressure();
    return await pruneStemCache({
      targetBytes: stemCacheBudgetBytes(pressure, budgets),
      keep,
      keepRoomForLargest: 2,
    });
  } catch {
    return null;
  }
}
