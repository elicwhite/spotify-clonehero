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
