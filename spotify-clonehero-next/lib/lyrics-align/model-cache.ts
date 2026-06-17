/**
 * Cache ONNX models in the Origin Private File System (OPFS).
 * Downloads once, then loads from local storage on subsequent visits.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/model-cache.ts
 */

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
  onProgress?: (msg: string) => void,
  minBytes: number = 1_000_000,
  label: string = 'model',
): Promise<ArrayBuffer> {
  const log = onProgress ?? console.log;

  // Try loading from OPFS cache
  try {
    const root = await navigator.storage.getDirectory();
    const dirHandle = await root.getDirectoryHandle('model-cache', {
      create: true,
    });

    try {
      const fileHandle = await dirHandle.getFileHandle(cacheKey);
      const file = await fileHandle.getFile();
      const buffer = await file.arrayBuffer();
      assertLooksLikeModel(buffer, minBytes);
      log(`Loaded ${label} from cache (${(file.size / 1e6).toFixed(0)} MB)`);
      return buffer;
    } catch (e) {
      // Missing, too small, or corrupt cache entry. Drop it so a bad
      // download can't poison the origin permanently, then re-download.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/object could not be found|not be found|NotFoundError/i.test(msg)) {
        log(`Ignoring bad cached model (${msg}) — re-downloading`);
        await dirHandle.removeEntry(cacheKey).catch(() => {});
      }
    }

    const buffer = await downloadModel(url, log, minBytes, label);

    log(`Caching for next time...`);
    await writeToCache(dirHandle, cacheKey, buffer);
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

class ModelDownloadError extends Error {}

async function downloadModel(
  url: string,
  log: (msg: string) => void,
  minBytes: number,
  label: string,
): Promise<ArrayBuffer> {
  log(`Downloading ${label}...`);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ModelDownloadError(
      "Couldn't reach the AI model server. Check your internet " +
        `connection and reload to try again. (${msg})`,
    );
  }
  if (!response.ok) {
    throw new ModelDownloadError(
      `Couldn't download the AI model (server responded ` +
        `HTTP ${response.status}). It may be temporarily unavailable or ` +
        `rate-limited — try again in a few minutes.`,
    );
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength) : 0;

  let buffer: ArrayBuffer;
  if (!response.body) {
    buffer = await response.arrayBuffer();
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      if (totalBytes > 0) {
        const pct = Math.round((receivedBytes / totalBytes) * 100);
        const mb = (receivedBytes / 1e6).toFixed(0);
        const totalMb = (totalBytes / 1e6).toFixed(0);
        log(`Downloading ${label} ${mb}/${totalMb} MB (${pct}%)`);
      } else {
        log(`Downloading ${label} ${(receivedBytes / 1e6).toFixed(0)} MB...`);
      }
    }

    // A stream that ends short of the advertised length is a truncated
    // download — caching it would poison the origin.
    if (totalBytes > 0 && receivedBytes !== totalBytes) {
      throw new ModelDownloadError(
        `The AI model download was cut off (got ` +
          `${(receivedBytes / 1e6).toFixed(0)} of ` +
          `${(totalBytes / 1e6).toFixed(0)} MB). Check your connection ` +
          `and reload to retry.`,
      );
    }

    buffer = new ArrayBuffer(receivedBytes);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.length;
    }
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
