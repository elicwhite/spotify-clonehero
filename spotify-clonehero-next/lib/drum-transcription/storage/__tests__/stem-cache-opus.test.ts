/**
 * Opus-encoded stem-cache tests (plan 0063 Part B) — the vocals stem is kept
 * Opus-encoded rather than raw PCM (unlike drums, which may be reprocessed).
 */

import {installFakeOPFS} from './fake-opfs';
import {
  storeCachedStemOpus,
  loadCachedStemOpus,
  hasCachedStemOpus,
  storeCachedStem,
  loadCachedStem,
} from '../stem-cache';

describe('Opus-encoded stem cache', () => {
  beforeEach(() => {
    installFakeOPFS();
  });

  it('round-trips Opus-encoded bytes under {stemName}.opus', async () => {
    const opusBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);
    await storeCachedStemOpus('fp-1', 'vocals', opusBytes);

    await expect(hasCachedStemOpus('fp-1', 'vocals')).resolves.toBe(true);
    const loaded = await loadCachedStemOpus('fp-1', 'vocals');
    expect(loaded).toEqual(opusBytes);
  });

  it('hasCachedStemOpus is false when absent', async () => {
    await expect(hasCachedStemOpus('fp-none', 'vocals')).resolves.toBe(false);
  });

  it('loadCachedStemOpus throws when absent', async () => {
    await expect(loadCachedStemOpus('fp-none', 'vocals')).rejects.toThrow();
  });

  it('opus and pcm variants of the same stem name coexist independently', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const opus = new Uint8Array([9, 9, 9]);
    await storeCachedStem('fp-2', 'vocals', pcm);
    await storeCachedStemOpus('fp-2', 'vocals', opus);

    await expect(loadCachedStem('fp-2', 'vocals')).resolves.toEqual(pcm);
    await expect(loadCachedStemOpus('fp-2', 'vocals')).resolves.toEqual(opus);
  });
});
