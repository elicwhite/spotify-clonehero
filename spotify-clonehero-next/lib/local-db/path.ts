/**
 * Where the local database file lives in OPFS.
 *
 * Its own module, so a caller that only needs to find the file on disk — the
 * storage readout measuring what the user's own data takes — does not pull in
 * SQLocal, Kysely and every migration to learn one filename.
 */
export const LOCAL_DB_PATH = 'spotify-clonehero-local.sqlite3';
