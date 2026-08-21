/**
 * Where cached data is written, and everywhere it is read from.
 *
 * The point of the bucket is that the browser evicts it before it touches the
 * chart projects. That only holds if new entries actually land in it — and it
 * only stays useful if entries written before it existed are still found,
 * since the alternative is a 336 MB download and a fresh separation per song.
 */

import {
  getCacheRoot,
  getCacheRoots,
  resetCacheBucketForTests,
} from '../browser-storage';
import {
  hasStem,
  hasStemOpus,
  loadStem,
  loadStemOpus,
  storeStemBytes,
  storeStemOpus,
  encodeStemCacheBytes,
  listStemCacheEntries,
  deleteStemEntry,
  pruneStemCache,
} from '../audio-pipeline/stem-cache';
import {getCachedModel, hasCachedModel} from '../lyrics-align/model-cache';
import {installFakeOPFS} from '../drum-transcription/storage/__tests__/fake-opfs';

const opfs = installFakeOPFS();

/**
 * A `navigator.storageBuckets` whose buckets are directories of the same fake
 * OPFS, so a test can see which root a write landed in by its path.
 */
function installFakeBuckets(): {opened: string[]} {
  const opened: string[] = [];
  const storage = navigator.storage;
  Object.defineProperty(navigator, 'storageBuckets', {
    value: {
      open: async (name: string) => {
        opened.push(name);
        const root = await storage.getDirectory();
        return {
          name,
          getDirectory: () =>
            root.getDirectoryHandle(`bucket:${name}`, {create: true}),
        };
      },
    },
    configurable: true,
  });
  return {opened};
}

function removeBuckets(): void {
  Object.defineProperty(navigator, 'storageBuckets', {
    value: undefined,
    configurable: true,
  });
}

/**
 * What the fake cannot show. `FakeDirectoryHandle.getDirectoryHandle` returns
 * a handle for any name, so a root that holds nothing still answers — the
 * "nothing was ever cached in this root" branches are unreachable here, and
 * the assertions below rest on file paths instead.
 */

/** Paths of every file the fake holds, so a test can assert on location. */
function paths(): string[] {
  return [...opfs.store.keys()].sort();
}

beforeEach(() => {
  opfs.reset();
  resetCacheBucketForTests();
  removeBuckets();
});

describe('getCacheRoots', () => {
  it('is the default root alone where the browser has no buckets', async () => {
    const roots = await getCacheRoots();

    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(await navigator.storage.getDirectory());
  });

  it('is the bucket first, then the default root', async () => {
    installFakeBuckets();

    const roots = await getCacheRoots();

    expect(roots).toHaveLength(2);
    expect(roots[0]).toBe(await getCacheRoot());
    expect(roots[1]).toBe(await navigator.storage.getDirectory());
  });

  it('opens the bucket once, however many callers ask', async () => {
    const buckets = installFakeBuckets();

    await Promise.all([getCacheRoots(), getCacheRoots(), getCacheRoot()]);

    expect(buckets.opened).toEqual(['cache']);
  });

  it('falls back to the default root when opening the bucket fails', async () => {
    Object.defineProperty(navigator, 'storageBuckets', {
      value: {
        open: async () => {
          throw new Error('buckets disabled by policy');
        },
      },
      configurable: true,
    });

    // A browser that has the API and refuses the bucket still needs somewhere
    // to cache. Losing the bucket costs eviction order, not the feature.
    expect(await getCacheRoots()).toEqual([
      await navigator.storage.getDirectory(),
    ]);
  });
});

describe('the stem cache, with a bucket', () => {
  it('writes new entries into the bucket', async () => {
    installFakeBuckets();

    await storeStemBytes('aaa', 'drums', new Uint8Array([1, 2, 3]));

    expect(paths()).toEqual([
      '/bucket:cache/audio-pipeline/stem-cache/aaa/drums.f32.gz',
      '/bucket:cache/audio-pipeline/stem-cache/aaa/drums.f32.gz.ok',
    ]);
  });

  it('finds an entry left in the default root, without copying it', async () => {
    // Cached before the bucket existed. Re-separating it would cost minutes
    // of GPU; copying it would need its size again on a disk that is short.
    const bytes = await encodeStemCacheBytes({
      left: new Float32Array([0.5]),
      right: new Float32Array([-0.5]),
    });
    await storeStemBytes('legacy', 'drums', bytes);
    const before = paths();
    installFakeBuckets();

    expect(await hasStem('legacy', 'drums')).toBe(true);
    const stem = await loadStem('legacy', 'drums');

    expect(Array.from(stem?.left ?? [])).toEqual([0.5]);
    expect(paths()).toEqual(before);
  });

  it('measures and deletes entries in both roots', async () => {
    await storeStemBytes('legacy', 'drums', new Uint8Array([1, 2, 3]));
    installFakeBuckets();
    await storeStemBytes('fresh', 'drums', new Uint8Array([1, 2, 3, 4]));

    const entries = await listStemCacheEntries();
    expect(entries.map(entry => entry.fingerprint).sort()).toEqual([
      'fresh',
      'legacy',
    ]);

    // The old root is reclaimed by the pruner, which is why nothing had to be
    // copied out of it.
    expect(await deleteStemEntry('legacy')).toBe(true);
    expect(
      (await listStemCacheEntries()).map(entry => entry.fingerprint),
    ).toEqual(['fresh']);
  });

  it('deletes a fingerprint that is in both roots', async () => {
    await storeStemBytes('both', 'drums', new Uint8Array([1, 2, 3]));
    installFakeBuckets();
    await storeStemBytes('both', 'drums', new Uint8Array([1, 2, 3, 4]));

    // Two copies, two lots of disk. Stopping at the first hit would leave the
    // older one behind forever.
    expect(await listStemCacheEntries()).toHaveLength(2);
    expect(await deleteStemEntry('both')).toBe(true);
    expect(await listStemCacheEntries()).toEqual([]);
  });
});

describe('an entry split across the two roots', () => {
  it('resolves each payload in the root that holds it', async () => {
    // A song separated before the bucket existed, whose drums were re-stored
    // later. Resolving the entry directory rather than the payload would send
    // every vocals read to the bucket and re-separate the song on each run.
    const drums = await encodeStemCacheBytes({
      left: new Float32Array([0.25]),
      right: new Float32Array([0.25]),
    });
    await storeStemOpus('split', 'vocals', new Uint8Array([9, 9, 9]));
    installFakeBuckets();
    await storeStemBytes('split', 'drums', drums);

    expect(await hasStem('split', 'drums')).toBe(true);
    expect(await hasStemOpus('split', 'vocals')).toBe(true);
    expect(Array.from((await loadStem('split', 'drums'))?.left ?? [])).toEqual([
      0.25,
    ]);
    expect(Array.from((await loadStemOpus('split', 'vocals')) ?? [])).toEqual([
      9, 9, 9,
    ]);
  });

  it('looks past an interrupted store in the bucket', async () => {
    // getFileHandle(…, {create: true}) leaves a zero-length payload behind
    // when a store never completes. Taking that as the answer would hide the
    // complete copy in the older root.
    await storeStemOpus('interrupted', 'vocals', new Uint8Array([1, 2, 3]));
    installFakeBuckets();
    const bucketEntry = await (
      await (
        await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle('bucket:cache', {create: true})
      ).getDirectoryHandle('audio-pipeline', {create: true})
    ).getDirectoryHandle('stem-cache', {create: true});
    const dir = await bucketEntry.getDirectoryHandle('interrupted', {
      create: true,
    });
    await dir.getFileHandle('vocals.opus', {create: true});

    expect(await hasStemOpus('interrupted', 'vocals')).toBe(true);
    expect(
      Array.from((await loadStemOpus('interrupted', 'vocals')) ?? []),
    ).toEqual([1, 2, 3]);
  });

  it('prunes entries out of whichever root holds them', async () => {
    opfs.setNow(1_000);
    await storeStemBytes('legacy', 'drums', new Uint8Array([1, 2, 3]));
    installFakeBuckets();
    opfs.setNow(2_000);
    await storeStemBytes('fresh', 'drums', new Uint8Array([1, 2, 3]));

    const result = await pruneStemCache({targetBytes: 3});

    // Deleting through the wrong root's handle would throw, be reported as a
    // refusal, and leave the cache over budget for good.
    expect(result?.deletedFingerprints).toEqual(['legacy']);
    expect(
      (await listStemCacheEntries()).map(entry => entry.fingerprint),
    ).toEqual(['fresh']);
  });
});

describe('the model cache, with a bucket', () => {
  const MB = 1_000_000;
  const model = () => {
    // Big enough to pass the size check, and not HTML/JSON/LFS text.
    const bytes = new Uint8Array(MB).fill(8);
    return bytes;
  };

  async function writeLegacyModel(cacheKey: string): Promise<void> {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('model-cache', {create: true});
    const handle = await dir.getFileHandle(cacheKey, {create: true});
    const writable = await handle.createWritable();
    await writable.write(model());
    await writable.close();
  }

  it('finds a model cached before the bucket existed', async () => {
    await writeLegacyModel('model.onnx');
    const before = paths();
    installFakeBuckets();

    expect(await hasCachedModel('model.onnx', MB)).toBe(true);
    // 336 MB in the real case: found where it is, not copied.
    expect(paths()).toEqual(before);
  });

  it('writes a downloaded model into the bucket', async () => {
    installFakeBuckets();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(model()));

    await getCachedModel('https://example.test/model.onnx', 'model.onnx');

    expect(paths()).toEqual(['/bucket:cache/model-cache/model.onnx']);
    fetchMock.mockRestore();
  });
});
