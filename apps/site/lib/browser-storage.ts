/**
 * How full this origin's storage is, and whether the browser has promised to
 * keep it.
 *
 * Chrome evicts an origin's stored data under storage pressure — all of it at
 * once, with no warning event and no API that announces it — which takes the
 * user's chart projects with it. Two evictions have been reported and neither
 * carried a number, so these readings exist to attach to the next one.
 *
 * Both readings answer for a browser that supports neither call, and for a
 * call that throws, without the caller handling it. This is instrumentation:
 * a failed reading must never take a feature down with it.
 */

export interface StoragePressure {
  /**
   * Bytes the whole origin holds — OPFS, IndexedDB, the Cache API, everything
   * the browser counts against one quota. It is not the size of the OPFS tree.
   */
  usageBytes: number;
  /** The origin's quota. 0 when the browser reports none. */
  quotaBytes: number;
  /**
   * Share of the quota in use, 0 to 1. An unknown quota reads as 0, not as
   * full: a reading nobody can trust must not be the reason something is
   * deleted or a warning is shown.
   */
  ratio: number;
}

/** Returns null where `navigator.storage.estimate` is missing or fails. */
export async function getStoragePressure(): Promise<StoragePressure | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  try {
    const {usage, quota} = await navigator.storage.estimate();
    const usageBytes = usage ?? 0;
    const quotaBytes = quota ?? 0;
    return {
      usageBytes,
      quotaBytes,
      ratio: quotaBytes > 0 ? usageBytes / quotaBytes : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Whether this origin's default bucket is exempt from automatic eviction.
 *
 * False covers three different states — not granted, not supported, and the
 * call failed — because no caller can act on the difference. What every
 * caller does with a false is the same: assume the data can disappear.
 */
export async function isStoragePersisted(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/**
 * What `requestPersistentStorage()` would do, asked without doing it.
 *
 * `'unknown'` covers a browser with no Permissions API and one that does not
 * recognize the `persistent-storage` permission name — for which the query
 * throws rather than answering.
 */
export async function getPersistencePermission(): Promise<
  PermissionState | 'unknown'
> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unknown';
  }
  try {
    const status = await navigator.permissions.query({
      name: 'persistent-storage',
    });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/**
 * Asks the browser to exempt this origin's default bucket from automatic
 * eviction — the bucket holding the chart projects, the project audio and the
 * database.
 *
 * Some browsers answer this with a permission prompt, so call it from a user
 * gesture. `persistIfAlreadyPermitted()` is the one that is safe on load.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Takes persistence where it is already permitted, and asks for it nowhere
 * else. True only when this call newly won it, so the caller can tell "we
 * changed something" from "there was nothing to do".
 *
 * A permission that is already granted is not persistence: the bit stays
 * unset until something calls `persist()`. This is the call that collects
 * what the origin has already earned.
 *
 * The gate is the permission state, not the browser name. A browser that
 * would put a prompt in front of the user reports `'prompt'`, never
 * `'granted'`, so it is not asked — and an unexplained "store data
 * permanently?" on first paint, before the visitor knows what the site is,
 * is worth less than the persistence it would win, because a refusal sticks.
 * Everywhere the state is not `'granted'`, the ask belongs behind a button
 * with an explanation beside it.
 *
 * This assumes a browser never decides the question inside `persist()` that
 * `query()` reported as undecided. If one does, a user it would have granted
 * silently is never asked and stays evictable. `lib/sentry/storage-context`
 * reports the permission state so that case is visible rather than assumed.
 */
export async function collectEarnedPersistence(): Promise<boolean> {
  if (await isStoragePersisted()) return false;
  if ((await getPersistencePermission()) !== 'granted') return false;
  return requestPersistentStorage();
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/**
 * Name of the bucket holding data the browser is welcome to take.
 *
 * A bucket has its own eviction state and its own OPFS root. The browser
 * evicts buckets that are not persisted before ones that are, so separating
 * the caches from the projects gives it something to take that is not the
 * user's charts.
 */
export const CACHE_BUCKET_NAME = 'cache';

/**
 * The opened bucket's root, or null where this browser has no buckets.
 *
 * Only the bucket is remembered. `navigator.storage.getDirectory()` is cheap
 * and always answers with the same root, and memoizing it would hand back a
 * root that no longer exists to a test that installed a new fake OPFS.
 */
let cacheBucketPromise: Promise<FileSystemDirectoryHandle | null> | null = null;

/**
 * The OPFS root for data that can be rebuilt: separated stems and downloaded
 * models. Never for chart projects, project audio or the database.
 *
 * Falls back to the default bucket's root where `storageBuckets` does not
 * exist, so Firefox and Safari keep working exactly as before — with the
 * caches back in the same bucket as the projects, which is what the cache
 * budget is for.
 */
export async function getCacheRoot(): Promise<FileSystemDirectoryHandle> {
  return (await openCacheBucket()) ?? navigator.storage.getDirectory();
}

/**
 * Every root a cache entry may be in, the one new entries are written to
 * first.
 *
 * Two only where a bucket was opened: entries written before the bucket
 * existed are still in the default root, and are read there rather than
 * copied across. Copying would double the footprint of a user who is, by
 * hypothesis, already short of room — the moment a copy is most likely to
 * fail, or to cause the eviction it was meant to prevent.
 */
export async function getCacheRoots(): Promise<FileSystemDirectoryHandle[]> {
  const defaultRoot = await navigator.storage.getDirectory();
  const bucketRoot = await openCacheBucket();
  return bucketRoot == null ? [defaultRoot] : [bucketRoot, defaultRoot];
}

async function openCacheBucket(): Promise<FileSystemDirectoryHandle | null> {
  const buckets = navigator.storageBuckets;
  if (buckets == null) return null;

  const attempt = (cacheBucketPromise ??= openCacheBucketRoot(buckets));
  const root = await attempt;
  // A failure is not remembered. This is the bucket the browser is meant to
  // take first, so failing to open it is an expected event rather than a
  // permanent state, and a session that remembered one failure would write
  // every later cache entry into the bucket that must not be evicted.
  if (root == null && cacheBucketPromise === attempt) cacheBucketPromise = null;
  return root;
}

async function openCacheBucketRoot(
  buckets: StorageBucketManager,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    // Not persisted, deliberately: this is the bucket that should go first.
    // 'relaxed' durability lets the browser batch these writes, which is the
    // right trade for bytes that can be recomputed. Neither option changes
    // what the browser evicts first; the bucket itself is what does that.
    const bucket = await buckets.open(CACHE_BUCKET_NAME, {
      durability: 'relaxed',
    });
    return await bucket.getDirectory();
  } catch {
    // A browser that has the API and refuses the bucket still needs somewhere
    // to cache. What is lost is the eviction order, and — until the bucket
    // opens again — sight of anything an earlier session wrote into it, which
    // the pruner then cannot measure or reclaim.
    return null;
  }
}

/**
 * The directory `path` names inside the cache root, creating what is missing.
 *
 * This is where new cache data is written, and it is the cache bucket
 * wherever there is one. It throws rather than falling back to the default
 * root: writing cache data beside the chart projects, silently, is the exact
 * outcome the bucket exists to prevent.
 */
export async function getCacheDir(
  path: readonly string[],
): Promise<FileSystemDirectoryHandle> {
  try {
    return await descend(await getCacheRoot(), path, true);
  } catch (error) {
    // The bucket can be evicted mid-session — that is what it is for — and a
    // handle to an evicted bucket keeps failing until it is thrown away.
    if (cacheBucketPromise == null) throw error;
    cacheBucketPromise = null;
    return descend(await getCacheRoot(), path, true);
  }
}

/**
 * The directory `path` names in every root that has it, the one written to
 * first.
 *
 * A root without it is skipped, not created: reading must not leave empty
 * directories in the default root of every user who never cached anything
 * there.
 */
export async function getCacheDirs(
  path: readonly string[],
): Promise<FileSystemDirectoryHandle[]> {
  const dirs: FileSystemDirectoryHandle[] = [];
  for (const root of await getCacheRoots()) {
    try {
      dirs.push(await descend(root, path, false));
    } catch {
      // Nothing was ever cached in this root.
    }
  }
  return dirs;
}

async function descend(
  root: FileSystemDirectoryHandle,
  path: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const segment of path) {
    dir = await dir.getDirectoryHandle(segment, {create});
  }
  return dir;
}

/** Forgets the opened bucket. For tests, which install a new fake OPFS. */
export function resetCacheBucketForTests(): void {
  cacheBucketPromise = null;
}
