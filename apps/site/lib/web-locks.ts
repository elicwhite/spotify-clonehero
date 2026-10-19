/**
 * Cross-tab mutual exclusion over `navigator.locks`.
 *
 * Every tab opens its own SQLocal connection to the same OPFS file, so work
 * that assumes it is alone with the database has to say so. The lock names live
 * here rather than at their call sites: two names that were meant to be the same
 * string and are not is a bug that looks like nothing at all.
 */

/** The slice of `LockManager` used here, so a test can supply a fake. */
export type LockManagerLike = {
  request<T>(
    name: string,
    options: {mode: 'exclusive'; ifAvailable?: boolean},
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
};

/** Replacing the whole Chorus catalog, or scanning charts into it. */
export const CHORUS_CATALOG_LOCK = 'spotify-clonehero-chorus-catalog';
/** Opening the local database and running its migrations. */
export const LOCAL_DB_MIGRATION_LOCK = 'spotify-clonehero-local-db-migrations';
/** Measuring the stem cache and deleting from it. */
export const STEM_CACHE_PRUNE_LOCK = 'spotify-clonehero-stem-cache-prune';

export function getWebLocks(): LockManagerLike | undefined {
  return typeof navigator !== 'undefined'
    ? (navigator as Navigator & {locks?: LockManagerLike}).locks
    : undefined;
}

export async function withWebLock<T>(
  name: string,
  locks: LockManagerLike,
  work: () => Promise<T>,
): Promise<T> {
  return locks.request(name, {mode: 'exclusive'}, work);
}

/**
 * Runs `work` only if the lock is free at this moment, and answers null when
 * another context holds it.
 *
 * For work that is worth doing but never worth waiting for. An exclusive
 * request has no timeout, so a tab that holds the lock while it is stuck
 * would otherwise block every other tab for as long as it lives.
 */
export async function withWebLockIfAvailable<T>(
  name: string,
  locks: LockManagerLike,
  work: () => Promise<T>,
): Promise<T | null> {
  return locks.request<T | null>(
    name,
    {mode: 'exclusive', ifAvailable: true},
    async lock => (lock == null ? null : work()),
  );
}
