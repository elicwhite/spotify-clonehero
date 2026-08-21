import {
  deleteStemEntry,
  encodeStemCacheBytes,
  hasStem,
  hasStemOpus,
  storeStemOpus,
  listStemCacheEntries,
  loadStem,
  pruneStemCache,
  pruneStemCacheToBudget,
  storeStemBytes,
} from '../stem-cache';
import {
  DEFAULT_STEM_CACHE_BUDGETS,
  stemCacheBudgetBytes,
  type StemCacheBudgets,
} from '../stem-cache-budget';
import {installFakeOPFS} from '../../drum-transcription/storage/__tests__/fake-opfs';

const opfs = installFakeOPFS();

/** Bytes big enough that a size assertion reads clearly. */
function payload(size: number): Uint8Array {
  return new Uint8Array(size).fill(1);
}

/**
 * Writes one cache entry and dates it. `at` is the marker time, which is what
 * the pruner sorts on.
 */
async function writeEntry(
  fingerprint: string,
  {size, at}: {size: number; at: number},
): Promise<void> {
  opfs.setNow(at);
  await storeStemBytes(fingerprint, 'drums', payload(size));
}

/** Asserts a prune ran, and hands back its result. */
function ran(result: Awaited<ReturnType<typeof pruneStemCache>>) {
  if (result == null) throw new Error('the prune did not run');
  return result;
}

/** Fingerprints still in the cache, sorted so an assertion reads stably. */
async function remaining(): Promise<string[]> {
  return (await listStemCacheEntries()).map(entry => entry.fingerprint).sort();
}

beforeEach(() => {
  opfs.reset();
});

describe('listStemCacheEntries', () => {
  it('is empty before anything is cached', async () => {
    expect(await listStemCacheEntries()).toEqual([]);
  });

  it('measures every file in an entry, and dates it by its marker', async () => {
    await writeEntry('aaa', {size: 100, at: 5_000});

    const [entry] = await listStemCacheEntries();
    // The payload plus the zero-length marker beside it.
    expect(entry).toEqual({
      fingerprint: 'aaa',
      sizeBytes: 100,
      lastUsedMs: 5_000,
    });
  });

  it('dates an entry by its newest marker, not its first', async () => {
    // Two pipelines cache different stems of one song. Either being read
    // means the entry is in use.
    opfs.setNow(1_000);
    await storeStemBytes('aaa', 'drums', payload(10));
    opfs.setNow(9_000);
    await storeStemBytes('aaa', 'vocals', payload(10));

    expect((await listStemCacheEntries())[0]?.lastUsedMs).toBe(9_000);
  });

  it('dates an entry with no marker as oldest', async () => {
    // Written before markers existed: the payload is there, nothing says when
    // it was last wanted.
    opfs.store.set(
      '/audio-pipeline/stem-cache/old/drums.f32.gz',
      payload(50).buffer as ArrayBuffer,
    );

    expect(await listStemCacheEntries()).toEqual([
      {fingerprint: 'old', sizeBytes: 50, lastUsedMs: 0},
    ]);
  });
});

describe('deleteStemEntry', () => {
  it('removes the payloads and the markers', async () => {
    await writeEntry('aaa', {size: 100, at: 1_000});

    await deleteStemEntry('aaa');

    expect(await hasStem('aaa', 'drums')).toBe(false);
    expect(await listStemCacheEntries()).toEqual([]);
  });

  it('reports false for an entry that was never there', async () => {
    expect(await deleteStemEntry('missing')).toBe(false);
  });
});

describe('pruneStemCache', () => {
  it('deletes nothing when the cache is inside the budget', async () => {
    await writeEntry('aaa', {size: 100, at: 1_000});

    const result = ran(await pruneStemCache({targetBytes: 1_000}));

    expect(result.deletedFingerprints).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(await remaining()).toEqual(['aaa']);
  });

  it('deletes least recently used first, and stops at the target', async () => {
    await writeEntry('oldest', {size: 100, at: 1_000});
    await writeEntry('middle', {size: 100, at: 2_000});
    await writeEntry('newest', {size: 100, at: 3_000});

    const result = ran(await pruneStemCache({targetBytes: 150}));

    // 300 bytes down to 100: two deletions, not three. The prune stops as
    // soon as it fits.
    expect(result.deletedFingerprints).toEqual(['oldest', 'middle']);
    expect(result.freedBytes).toBe(200);
    expect(result.remainingBytes).toBe(100);
    expect(await remaining()).toEqual(['newest']);
  });

  it('deletes an undated entry before a dated one', async () => {
    opfs.store.set(
      '/audio-pipeline/stem-cache/undated/drums.f32.gz',
      payload(100).buffer as ArrayBuffer,
    );
    await writeEntry('dated', {size: 100, at: 1_000});

    await pruneStemCache({targetBytes: 100});

    expect(await remaining()).toEqual(['dated']);
  });

  it('orders entries stamped in the same millisecond deterministically', async () => {
    // Nothing forces two stores apart in time, and the directory listing
    // order is not something a caller can rely on.
    await writeEntry('bbb', {size: 100, at: 1_000});
    await writeEntry('aaa', {size: 100, at: 1_000});

    await pruneStemCache({targetBytes: 100});

    expect(await remaining()).toEqual(['bbb']);
  });

  it('never deletes a kept entry, even when it is the oldest', async () => {
    // The caller is separating this song right now.
    await writeEntry('in-use', {size: 100, at: 1_000});
    await writeEntry('other', {size: 100, at: 2_000});

    const result = ran(
      await pruneStemCache({targetBytes: 50, keep: ['in-use']}),
    );

    expect(result.deletedFingerprints).toEqual(['other']);
    expect(await remaining()).toEqual(['in-use']);
  });

  it('stops when only kept entries are left, over budget or not', async () => {
    await writeEntry('in-use', {size: 500, at: 1_000});

    const result = ran(
      await pruneStemCache({targetBytes: 100, keep: ['in-use']}),
    );

    expect(result.deletedFingerprints).toEqual([]);
    expect(result.remainingBytes).toBe(500);
    expect(await remaining()).toEqual(['in-use']);
  });

  it('leaves a surviving entry readable', async () => {
    // A prune that corrupted what it kept would be worse than no prune.
    const bytes = await encodeStemCacheBytes({
      left: new Float32Array([0.25, -0.5]),
      right: new Float32Array([0.75, -1]),
    });
    opfs.setNow(1_000);
    await storeStemBytes('old', 'drums', payload(400));
    opfs.setNow(2_000);
    await storeStemBytes('keeper', 'drums', bytes);

    await pruneStemCache({targetBytes: bytes.byteLength});

    const stem = await loadStem('keeper', 'drums');
    expect(Array.from(stem?.left ?? [])).toEqual([0.25, -0.5]);
  });

  it('keeps room for two songs, whatever the target says', async () => {
    // A budget under twice the largest entry makes a user working across two
    // songs re-separate on every switch: minutes of GPU to save disk that is
    // about to be used again.
    await writeEntry('a', {size: 100, at: 1_000});
    await writeEntry('b', {size: 100, at: 2_000});

    const result = ran(
      await pruneStemCache({targetBytes: 0, keepRoomForLargest: 2}),
    );

    expect(result.deletedFingerprints).toEqual([]);
    expect(await remaining()).toEqual(['a', 'b']);
  });

  it('refreshes an entry when it is read', async () => {
    // The whole point of stamping the marker on a load: the song the user is
    // working on must not be evicted because it was cached first. A real
    // payload, since only a load that decodes counts as a use.
    const bytes = await encodeStemCacheBytes({
      left: new Float32Array([0.5]),
      right: new Float32Array([0.5]),
    });
    opfs.setNow(1_000);
    await storeStemBytes('read-later', 'drums', bytes);
    await writeEntry('written-later', {size: bytes.byteLength, at: 2_000});

    opfs.setNow(3_000);
    expect(await loadStem('read-later', 'drums')).not.toBeNull();

    await pruneStemCache({targetBytes: bytes.byteLength});

    expect(await remaining()).toEqual(['read-later']);
  });

  it('counts nothing freed for an entry that would not delete', async () => {
    // OPFS refuses to remove a directory holding an open file, so a prune can
    // ask for a deletion and not get it. Reporting those bytes as freed would
    // end the prune early and overstate the room recovered.
    await writeEntry('stuck', {size: 100, at: 1_000});
    opfs.refuseRemovalOf('/audio-pipeline/stem-cache/stuck');

    const result = ran(await pruneStemCache({targetBytes: 0}));

    expect(result.deletedFingerprints).toEqual([]);
    expect(result.freedBytes).toBe(0);
    expect(result.remainingBytes).toBe(100);
    expect(await remaining()).toEqual(['stuck']);
  });
});

describe('stemCacheBudgetBytes', () => {
  const budgets = DEFAULT_STEM_CACHE_BUDGETS;

  it('relaxes when the origin has room', () => {
    expect(stemCacheBudgetBytes({ratio: 0.1})).toBe(budgets.relaxedBytes);
  });

  it('tightens when the origin is close to its quota', () => {
    expect(stemCacheBudgetBytes({ratio: budgets.pressureRatio})).toBe(
      budgets.underPressureBytes,
    );
  });

  it('relaxes when there is no reading', () => {
    // Deleting a user's stems on a number nobody could read is the worse of
    // the two mistakes.
    expect(stemCacheBudgetBytes(null)).toBe(budgets.relaxedBytes);
  });
});

describe('pruneStemCacheToBudget', () => {
  // Small budgets, so the wiring can be tested without allocating the real
  // ones. The policy itself is covered above.
  const budgets: StemCacheBudgets = {
    relaxedBytes: 1_000,
    underPressureBytes: 100,
    pressureRatio: 0.7,
  };

  const setStorageEstimate = (estimate: StorageEstimate | null) => {
    const getDirectory = navigator.storage.getDirectory.bind(navigator.storage);
    Object.defineProperty(navigator, 'storage', {
      value: {
        getDirectory,
        ...(estimate == null ? {} : {estimate: async () => estimate}),
      },
      configurable: true,
    });
  };

  it('prunes to the tight budget under origin pressure', async () => {
    setStorageEstimate({usage: 90, quota: 100});
    for (const [index, name] of ['a', 'b', 'c', 'd'].entries()) {
      await writeEntry(name, {size: 100, at: index + 1});
    }

    const result = await pruneStemCacheToBudget(['d'], budgets);

    // 400 bytes down to 200 — the tight budget is 100, but room for two
    // entries the size of the largest is kept whatever the budget says.
    expect(result?.deletedFingerprints).toEqual(['a', 'b']);
    expect(result?.remainingBytes).toBe(200);
  });

  it('keeps everything inside the relaxed budget when the origin has room', async () => {
    setStorageEstimate({usage: 1, quota: 100});
    await writeEntry('old', {size: 400, at: 1});
    await writeEntry('new', {size: 400, at: 2});

    const result = await pruneStemCacheToBudget(['new'], budgets);

    expect(result?.deletedFingerprints).toEqual([]);
  });

  it('runs without a quota reading', async () => {
    setStorageEstimate(null);

    await expect(pruneStemCacheToBudget([], budgets)).resolves.not.toBeNull();
  });
});

describe('a store that runs out of room', () => {
  /**
   * Verified in Chrome: exceeding the origin quota throws rather than evicting
   * anything. The browser frees nothing, so a store that fails this way leaves
   * the prune that follows it unreachable — and a user at their quota stuck
   * there, losing a separation that took minutes of GPU.
   */
  it('frees room and completes the store', async () => {
    await writeEntry('older', {size: 100, at: 1_000});
    opfs.failNextWrite('QuotaExceededError');

    opfs.setNow(2_000);
    await storeStemBytes('new', 'drums', payload(50));

    // The finished separation is kept; the cache is what was given up.
    expect(await hasStem('new', 'drums')).toBe(true);
    expect(await remaining()).toEqual(['new']);
  });

  it('keeps the entry it is writing while it frees the rest', async () => {
    // A first payload of this song is already cached; the second must not
    // delete it on the way in.
    await writeEntry('song', {size: 100, at: 1_000});
    await writeEntry('other', {size: 100, at: 2_000});
    opfs.failNextWrite('QuotaExceededError');

    await storeStemOpus('song', 'vocals', payload(10));

    expect(await remaining()).toEqual(['song']);
    expect(await hasStem('song', 'drums')).toBe(true);
    expect(await hasStemOpus('song', 'vocals')).toBe(true);
  });

  it('gives up with the original error when nothing can be freed', async () => {
    // An empty cache, or a lock another tab holds. Retrying the write into
    // room that was never made would fail the same way and lose the error the
    // caller needs.
    opfs.failNextWrite('QuotaExceededError', 'no room');

    await expect(storeStemBytes('new', 'drums', payload(50))).rejects.toThrow(
      'no room',
    );
    // The entry directory the failed store created is left behind, holding
    // nothing. It costs no space and sorts first for deletion.
    expect(await hasStem('new', 'drums')).toBe(false);
  });

  it('reclaims the cache location that predates audio-pipeline/', async () => {
    // These stems sit inside a project namespace, which the project readout
    // skips. If the cache did not reach them they would be counted by nothing
    // and freed by nothing.
    opfs.store.set(
      '/drum-transcription/stem-cache/old-fingerprint/drums.f32.gz',
      payload(300).buffer as ArrayBuffer,
    );

    expect(
      (await listStemCacheEntries()).map(entry => entry.fingerprint),
    ).toEqual(['old-fingerprint']);
    expect(await deleteStemEntry('old-fingerprint')).toBe(true);
    expect(await listStemCacheEntries()).toEqual([]);
  });

  it('does not swallow a failure that is not about room', async () => {
    opfs.failNextWrite('NotFoundError', 'gone');

    await expect(storeStemBytes('new', 'drums', payload(50))).rejects.toThrow(
      'gone',
    );
  });
});
