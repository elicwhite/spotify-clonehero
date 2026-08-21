/**
 * Cache ONNX models in the Origin Private File System (OPFS).
 * Downloads once, then loads from local storage on subsequent visits.
 *
 * Downloads are resilient to flaky connections: a stream that delivers no
 * bytes for STALL_TIMEOUT_MS is aborted and retried with an HTTP Range
 * request resuming from the bytes already received, up to MAX_ATTEMPTS
 * connections total.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/model-cache.ts
 */

import {getCacheDir, getCacheDirs} from '@/lib/browser-storage';

/** Directory inside OPFS every cached model file lives in. */
const MODEL_CACHE_DIR = 'model-cache';

/**
 * Where a cached model is written, and everywhere one is read from.
 *
 * Downloads go to the cache bucket, which the browser is welcome to evict
 * before it touches the chart projects. A model cached before that bucket
 * existed stays where it is and is read in place: it is 336 MB, and copying
 * it across would double that on the disk of a user who is by hypothesis
 * already short of room.
 */
const MODEL_CACHE_PATH = [MODEL_CACHE_DIR];

/** The cached file, from whichever root holds it. Null when none does. */
async function findCachedModel(
  cacheKey: string,
): Promise<FileSystemFileHandle | null> {
  for (const dir of await getCacheDirs(MODEL_CACHE_PATH)) {
    try {
      const handle = await dir.getFileHandle(cacheKey);
      // A zero-length file is what `getFileHandle(…, {create: true})` leaves
      // behind when a download never completed. Treating it as the cached
      // model would hide a good copy in the other root.
      if ((await handle.getFile()).size > 0) return handle;
    } catch {
      // Not in this root.
    }
  }
  return null;
}

export interface ModelDownloadProgress {
  loadedBytes: number;
  /** 0 when the server didn't report a size. */
  totalBytes: number;
}

export type ModelProgressFn = (
  msg: string,
  info?: ModelDownloadProgress,
) => void;

/**
 * Reject buffers that obviously aren't an ONNX model: too small, or an
 * error page / git-lfs pointer the host returned with a 200. ONNX files are
 * protobuf and never begin with these byte sequences, so a cheap prefix
 * sniff catches the realistic failure modes (HTML 403/404 pages, JSON
 * errors, LFS pointer text) without needing a protobuf parser.
 */
function assertLooksLikeModel(buffer: ArrayBuffer, minBytes: number): void {
  if (buffer.byteLength < minBytes) {
    throw new Error(
      `The AI model didn't download fully (got ` +
        `${(buffer.byteLength / 1e6).toFixed(1)} MB, expected ~` +
        `${(minBytes / 1e6).toFixed(0)} MB). The download was likely ` +
        `interrupted or blocked. Check your connection and reload to retry.`,
    );
  }
  const head = new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength));
  // Skip leading whitespace, then look for text-format markers.
  let i = 0;
  while (
    i < head.length &&
    (head[i] === 0x20 ||
      head[i] === 0x0a ||
      head[i] === 0x0d ||
      head[i] === 0x09)
  ) {
    i++;
  }
  const c = head[i];
  // '<' HTML, '{' or '[' JSON error body, 'v' git-lfs pointer ("version https://…").
  if (c === 0x3c || c === 0x7b || c === 0x5b) {
    throw new Error(
      "Couldn't download the AI model — the host returned an error " +
        'page instead of the model file. It may be temporarily ' +
        'blocking requests or the file moved. Try again in a few minutes.',
    );
  }
  const ascii = new TextDecoder().decode(head);
  if (ascii.startsWith('version https://git-lfs')) {
    throw new Error(
      "Couldn't download the AI model — the host returned a " +
        'placeholder instead of the model file. Try again later.',
    );
  }
}

/**
 * Get a model as an ArrayBuffer, loading from OPFS cache if available,
 * otherwise downloading and caching.
 *
 * @param url        Fetch URL for the model.
 * @param cacheKey   Filename used inside the OPFS `model-cache/` directory.
 * @param onProgress Optional log callback.
 * @param minBytes   Minimum valid file size. Cached or downloaded files
 *                   smaller than this are treated as corrupt (e.g. a cached
 *                   404 HTML page) and re-downloaded. Pass a value close to
 *                   the real model size so truncated multi-MB downloads are
 *                   rejected too. Defaults to 1 MB.
 * @param label      Human-readable name shown in progress messages, e.g.
 *                   "audio separator". Defaults to "model".
 */
export async function getCachedModel(
  url: string,
  cacheKey: string,
  onProgress?: ModelProgressFn,
  minBytes: number = 1_000_000,
  label: string = 'model',
): Promise<ArrayBuffer> {
  const log: ModelProgressFn = onProgress ?? (msg => console.log(msg));

  // Try loading from OPFS cache
  try {
    const cached = await findCachedModel(cacheKey);
    if (cached != null) {
      try {
        const file = await cached.getFile();
        const buffer = await file.arrayBuffer();
        assertLooksLikeModel(buffer, minBytes);
        log(`Loaded ${label} from cache (${(file.size / 1e6).toFixed(0)} MB)`);
        return buffer;
      } catch (e) {
        // Too small or corrupt. Drop it so a bad download can't poison the
        // origin permanently, then re-download.
        const msg = e instanceof Error ? e.message : String(e);
        log(`Ignoring bad cached model (${msg}) — re-downloading`);
        await removeCachedModel(cacheKey);
      }
    }

    const buffer = await downloadModel(url, log, minBytes, label);

    log(`Caching for next time...`);
    await writeToCache(await getCacheDir(MODEL_CACHE_PATH), cacheKey, buffer);
    log(`Downloaded ${label} (${(buffer.byteLength / 1e6).toFixed(0)} MB)`);
    return buffer;
  } catch (e) {
    // Re-throw our own validation/HTTP errors so the failure is explicit
    // instead of surfacing later as a cryptic ORT "protobuf parsing failed".
    if (e instanceof ModelDownloadError) throw e;
    // OPFS itself unavailable — download without caching, still validated.
    console.warn('OPFS not available, downloading without cache:', e);
    return downloadModel(url, log, minBytes, label);
  }
}

/**
 * Whether `getCachedModel(_, cacheKey, _, minBytes)` would return without
 * downloading — i.e. the OPFS cache already holds a file of a plausible
 * size. Lets a step list predict a model download the same way it predicts
 * any other cached work, instead of always announcing one.
 *
 * Answers false for every failure mode (no OPFS, no directory, no file,
 * short file). The cost of a wrong `false` is one step that finishes at
 * once; the cost of a wrong `true` would be a hidden multi-minute download.
 */
export async function hasCachedModel(
  cacheKey: string,
  minBytes: number = 1_000_000,
): Promise<boolean> {
  try {
    const cached = await findCachedModel(cacheKey);
    if (cached == null) return false;
    return (await cached.getFile()).size >= minBytes;
  } catch {
    return false;
  }
}

/** Drops a bad cache entry from every root that holds one. */
async function removeCachedModel(cacheKey: string): Promise<void> {
  for (const dir of await getCacheDirs(MODEL_CACHE_PATH)) {
    await dir.removeEntry(cacheKey).catch(() => {});
  }
}

class ModelDownloadError extends Error {}

/** Transient failure (network drop, stalled stream, 5xx) — the download
 *  loop retries these with an HTTP Range resume. */
class RetryableDownloadError extends Error {}

/** Abort a download whose stream delivers no bytes for this long. */
const STALL_TIMEOUT_MS = 30_000;
/** Total connection attempts (first try + resumes) before giving up. */
const MAX_ATTEMPTS = 4;

async function downloadModel(
  url: string,
  log: ModelProgressFn,
  minBytes: number,
  label: string,
): Promise<ArrayBuffer> {
  log(`Downloading ${label}...`);

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  let totalBytes = 0;
  let lastLoggedMb = -1;

  // One progress message per received MB — per-chunk messages flood the
  // console and re-render progress UIs hundreds of times per second.
  const reportProgress = () => {
    const mb = Math.floor(receivedBytes / 1e6);
    if (mb === lastLoggedMb) return;
    lastLoggedMb = mb;
    const info = {loadedBytes: receivedBytes, totalBytes};
    if (totalBytes > 0) {
      const pct = Math.round((receivedBytes / totalBytes) * 100);
      const totalMb = (totalBytes / 1e6).toFixed(0);
      log(`Downloading ${label} ${mb}/${totalMb} MB (${pct}%)`, info);
    } else {
      log(`Downloading ${label} ${mb} MB...`, info);
    }
  };

  const restart = () => {
    chunks.length = 0;
    receivedBytes = 0;
    lastLoggedMb = -1;
  };

  /**
   * One connection attempt. Streams into `chunks`, resuming from
   * `receivedBytes` via an HTTP Range request. Returns true when the file
   * is complete, false when the stream ended cleanly but short (the retry
   * loop resumes). Throws RetryableDownloadError on network drops, stalls,
   * and 5xx/429; ModelDownloadError on permanent HTTP failures.
   */
  const streamOnce = async (): Promise<boolean> => {
    const controller = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const armWatchdog = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), STALL_TIMEOUT_MS);
    };

    try {
      const headers: Record<string, string> = {};
      if (receivedBytes > 0) headers['Range'] = `bytes=${receivedBytes}-`;

      armWatchdog();
      let response: Response;
      try {
        response = await fetch(url, {signal: controller.signal, headers});
      } catch (e) {
        throw new RetryableDownloadError(
          controller.signal.aborted
            ? 'connection stalled'
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }

      if (response.status === 200 && receivedBytes > 0) {
        // Server ignored the Range request and is sending the full file.
        restart();
      } else if (response.status === 206) {
        // Content-Range: "bytes <start>-<end>/<total>"
        const m = /\/(\d+)\s*$/.exec(
          response.headers.get('content-range') ?? '',
        );
        if (m) totalBytes = parseInt(m[1]);
      } else if (response.status === 416) {
        // Our resume offset is no longer valid (file changed?) — start over.
        restart();
        throw new RetryableDownloadError('server rejected resume range');
      }

      if (!response.ok && response.status !== 206) {
        if (response.status >= 500 || response.status === 429) {
          throw new RetryableDownloadError(`HTTP ${response.status}`);
        }
        throw new ModelDownloadError(
          `Couldn't download the AI model (server responded ` +
            `HTTP ${response.status}). It may be temporarily unavailable or ` +
            `rate-limited — try again in a few minutes.`,
        );
      }

      if (totalBytes === 0) {
        const contentLength = response.headers.get('content-length');
        // On a 206 Content-Length is the remaining bytes, not the file size.
        if (contentLength) totalBytes = receivedBytes + parseInt(contentLength);
      }

      if (!response.body) {
        const buf = await response.arrayBuffer();
        chunks.push(new Uint8Array(buf));
        receivedBytes += buf.byteLength;
        return true;
      }

      const reader = response.body.getReader();
      while (true) {
        armWatchdog();
        let done: boolean;
        let value: Uint8Array | undefined;
        try {
          ({done, value} = await reader.read());
        } catch (e) {
          throw new RetryableDownloadError(
            controller.signal.aborted
              ? 'download stalled'
              : e instanceof Error
                ? e.message
                : String(e),
          );
        }
        if (done) break;
        chunks.push(value!);
        receivedBytes += value!.length;
        reportProgress();
      }

      // Stream ended cleanly — complete only if we got everything (or the
      // server never reported a size).
      return totalBytes === 0 || receivedBytes >= totalBytes;
    } finally {
      clearTimeout(stallTimer);
    }
  };

  for (let attempt = 1; ; attempt++) {
    let complete: boolean;
    try {
      complete = await streamOnce();
    } catch (e) {
      if (!(e instanceof RetryableDownloadError)) throw e;
      if (attempt >= MAX_ATTEMPTS) {
        throw new ModelDownloadError(
          receivedBytes === 0
            ? "Couldn't reach the AI model server. Check your internet " +
              `connection and reload to try again. (${e.message})`
            : `The AI model download kept stalling (got ` +
              `${(receivedBytes / 1e6).toFixed(0)}` +
              (totalBytes > 0 ? ` of ${(totalBytes / 1e6).toFixed(0)}` : '') +
              ` MB). Check your connection and reload to retry.`,
        );
      }
      log(
        `Download interrupted at ${(receivedBytes / 1e6).toFixed(0)} MB — ` +
          `resuming (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
      );
      continue;
    }
    if (complete) break;
    // Clean end-of-stream but short of the advertised size — resume.
    if (attempt >= MAX_ATTEMPTS) {
      throw new ModelDownloadError(
        `The AI model download was cut off (got ` +
          `${(receivedBytes / 1e6).toFixed(0)} of ` +
          `${(totalBytes / 1e6).toFixed(0)} MB). Check your connection ` +
          `and reload to retry.`,
      );
    }
    log(
      `Download ended early at ${(receivedBytes / 1e6).toFixed(0)} MB — ` +
        `resuming (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
    );
  }

  const buffer = new ArrayBuffer(receivedBytes);
  const view = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    view.set(chunk, offset);
    offset += chunk.length;
  }

  try {
    assertLooksLikeModel(buffer, minBytes);
  } catch (e) {
    throw new ModelDownloadError(e instanceof Error ? e.message : String(e));
  }
  return buffer;
}

async function writeToCache(
  dirHandle: FileSystemDirectoryHandle,
  cacheKey: string,
  buffer: ArrayBuffer,
): Promise<void> {
  try {
    const fileHandle = await dirHandle.getFileHandle(cacheKey, {create: true});
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
  } catch (e) {
    console.warn('Failed to write to OPFS cache:', e);
  }
}
