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
    options: {mode: 'exclusive'},
    callback: () => Promise<T>,
  ): Promise<T>;
};

/** Replacing the whole Chorus catalog, or scanning charts into it. */
export const CHORUS_CATALOG_LOCK = 'spotify-clonehero-chorus-catalog';
/** Opening the local database and running its migrations. */
export const LOCAL_DB_MIGRATION_LOCK = 'spotify-clonehero-local-db-migrations';

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
