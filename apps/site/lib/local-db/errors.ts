/**
 * What a caller sees when the local database cannot be opened.
 *
 * Its own module for the same reason as `path.ts`: a page deciding how to word
 * a failure should not pull in SQLocal, Kysely and every migration to ask what
 * kind of failure it was.
 */

/**
 * The database could not be opened, whatever the reason underneath.
 *
 * Every feature awaits `getLocalDb`, so a half-applied migration reaches the
 * user as several unrelated-looking failures each printing a SQLite message.
 * One named error is what lets a page say the true thing once and point at the
 * reset in `/storage`. The original is kept as `cause`, because the SQLite
 * message is what makes a Sentry report worth reading.
 */
export class LocalDbUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The local database could not be opened.', {cause});
    this.name = 'LocalDbUnavailableError';
  }
}

/** Whether a caught error means the database itself is unusable. */
export function isLocalDbUnavailableError(error: unknown): boolean {
  return error instanceof LocalDbUnavailableError;
}
