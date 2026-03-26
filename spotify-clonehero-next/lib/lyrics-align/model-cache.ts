/**
 * Cache ONNX models in the Origin Private File System (OPFS).
 * Downloads once, then loads from local storage on subsequent visits.
 *
 * Ported from ~/projects/vocal-alignment/browser-aligner/src/model-cache.ts
 */

/**
 * Get a model as an ArrayBuffer, loading from OPFS cache if available,
 * otherwise downloading and caching.
 */
/**
 * @param url        Fetch URL for the model.
 * @param cacheKey   Filename used inside the OPFS `model-cache/` directory.
 * @param onProgress Optional log callback.
 * @param minBytes   Minimum valid file size. Cached files smaller than this
 *                   are treated as corrupt (e.g. a cached 404 HTML page) and
 *                   re-downloaded. Defaults to 1 MB.
 */
export async function getCachedModel(
  url: string,
  cacheKey: string,
  onProgress?: (msg: string) => void,
  minBytes: number = 1_000_000,
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
      if (file.size >= minBytes) {
        log(`Loading from cache (${(file.size / 1e6).toFixed(0)} MB)...`);
        const buffer = await file.arrayBuffer();
        log(`Loaded from cache`);
        return buffer;
      }
      // Cached file too small — likely a corrupt/stale entry, re-download
      log(`Cached file too small (${file.size} bytes), re-downloading...`);
    } catch {
      // File doesn't exist in cache — will download
    }

    // Download with progress
    log(`Downloading...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength) : 0;

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      await writeToCache(dirHandle, cacheKey, buffer);
      return buffer;
    }

    // Stream download with progress
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
        log(`Downloading ${mb}/${totalMb} MB (${pct}%)`);
      } else {
        log(`Downloading ${(receivedBytes / 1e6).toFixed(0)} MB...`);
      }
    }

    // Combine chunks
    const buffer = new ArrayBuffer(receivedBytes);
    const view = new Uint8Array(buffer);
    let offset = 0;
    for (const chunk of chunks) {
      view.set(chunk, offset);
      offset += chunk.length;
    }

    // Cache to OPFS
    log(`Caching for next time...`);
    await writeToCache(dirHandle, cacheKey, buffer);
    log(`Downloaded and cached (${(receivedBytes / 1e6).toFixed(0)} MB)`);

    return buffer;
  } catch (e) {
    // OPFS not available — fall back to plain fetch
    console.warn('OPFS not available, downloading without cache:', e);
    log(`Downloading (no cache)...`);
    const response = await fetch(url);
    return response.arrayBuffer();
  }
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
