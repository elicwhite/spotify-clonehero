/**
 * `hasCachedModel`: the probe a step list uses to decide whether a model
 * download is work it should announce. It has to agree with what
 * `getCachedModel` would actually do — a "cached" answer for a file
 * `getCachedModel` would reject as too small would hide a real download.
 */

import {installFakeOPFS} from '@/lib/drum-transcription/storage/__tests__/fake-opfs';
import {hasCachedModel} from '@/lib/lyrics-align/model-cache';

const MB = 1_000_000;

async function writeCachedModel(cacheKey: string, size: number) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('model-cache', {create: true});
  const handle = await dir.getFileHandle(cacheKey, {create: true});
  const writable = await handle.createWritable();
  await writable.write(new Uint8Array(size));
  await writable.close();
}

describe('hasCachedModel', () => {
  beforeEach(() => installFakeOPFS());

  it('is true for a cached file at or above the expected size', async () => {
    await writeCachedModel('model.onnx', 2 * MB);
    await expect(hasCachedModel('model.onnx', 2 * MB)).resolves.toBe(true);
  });

  it('is false for a truncated cache entry, which getCachedModel re-downloads', async () => {
    await writeCachedModel('model.onnx', MB);
    await expect(hasCachedModel('model.onnx', 2 * MB)).resolves.toBe(false);
  });

  it('is false when the model was never cached', async () => {
    await expect(hasCachedModel('missing.onnx', MB)).resolves.toBe(false);
  });

  it('is false rather than throwing when OPFS is unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
      writable: true,
    });
    await expect(hasCachedModel('model.onnx', MB)).resolves.toBe(false);
  });
});
