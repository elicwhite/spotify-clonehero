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
