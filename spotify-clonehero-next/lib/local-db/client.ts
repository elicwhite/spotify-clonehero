import {SQLocalKysely} from 'sqlocal/kysely';
import {Kysely, Migrator, ParseJSONResultsPlugin} from 'kysely';
import type {DB} from './types';
import {normalizeStrForMatching} from './normalize';
import {
  LOCAL_DB_MIGRATION_LOCK,
  getWebLocks,
  withWebLock,
} from '@/lib/web-locks';

// The resolved promise IS the cache: `getLocalDb` awaits it on every call, so a
// second variable holding the same database could only ever disagree with it.
let dbInitializationPromise: Promise<Kysely<DB>> | null = null;
let sqlocalClient: SQLocalKysely | null = null;
export const LOCAL_DB_PATH = 'spotify-clonehero-local.sqlite3';

/** Checks OPFS without creating the SQLocal database or running migrations. */
export async function localDbExists(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return false;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle(LOCAL_DB_PATH);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

/**
 * Opens the database, or joins the open already running.
 *
 * Clearing the cached promise happens here, after the await, rather than inside
 * the failure path. `openAndMigrate` runs its `catch` before this function has
 * assigned the promise, so a reset made there is immediately overwritten by the
 * rejected promise — every later caller then replays the first rejection and
 * only a reload can clear it. The identity check stops a slow failure from
 * discarding a newer attempt.
 */
export async function getLocalDb(): Promise<Kysely<DB>> {
  const attempt = (dbInitializationPromise ??= initializeDatabase());
  try {
    return await attempt;
  } catch (error) {
    if (dbInitializationPromise === attempt) dbInitializationPromise = null;
    throw error;
  }
}

if (typeof window !== 'undefined') {
  window['getLocalDb'] = getLocalDb;
}

/**
 * Kysely's SQLite adapter makes `acquireMigrationLock` a no-op, and reports
 * `supportsTransactionalDdl: false` so migrations commit one at a time. Both
 * follow from its stated assumption that SQLite has a single connection. SQLocal
 * gives every tab its own connection to the same OPFS file, so two migrators can
 * reach the first `ALTER TABLE ... ADD COLUMN` together and the loser fails on a
 * duplicate column, taking the whole database down with it. This lock is what
 * makes that assumption true again.
 *
 * A browser without Web Locks runs unlocked. It still opens the database
 * correctly with one tab, and refusing to open it at all would remove a working
 * case to prevent a race that needs two.
 */
async function initializeDatabase(): Promise<Kysely<DB>> {
  // Closing the previous client happens outside the lock. `destroy()` posts to
  // the worker and waits for an answer with no timeout of its own, so a worker
  // that never booted would otherwise hold this origin-wide lock forever and
  // freeze `getLocalDb()` in every tab.
  await closeSqlocalClient();

  const locks = getWebLocks();
  return locks
    ? withWebLock(LOCAL_DB_MIGRATION_LOCK, locks, openAndMigrate)
    : openAndMigrate();
}

async function openAndMigrate(): Promise<Kysely<DB>> {
  let client: SQLocalKysely | undefined;
  try {
    console.log('Initializing SQLocal database...');

    // Create the SQLocal database client.
    //
    // `onInit` runs after every (re)connect — set page cache and temp store
    // here so all callers benefit. With the OPFS Async VFS each cache miss
    // costs an OPFS roundtrip (~1ms), so a bigger cache pays for itself
    // quickly on read-heavy workloads (snapshot SELECTs, chorus charts,
    // etc.). Negative values are KiB; -65536 = 64 MiB. Per-tab.
    client = new SQLocalKysely({
      databasePath: LOCAL_DB_PATH,
      onInit: sql => [
        sql`PRAGMA cache_size = -65536`,
        sql`PRAGMA temp_store = MEMORY`,
      ],
    });
    const {dialect} = client;
    sqlocalClient = client;
    const db = new Kysely<DB>({
      dialect,
      plugins: [new ParseJSONResultsPlugin()],
    });

    await client.createScalarFunction('normalize', (str: string) => {
      return normalizeStrForMatching(str);
    });

    // Create migrator
    const migrator = new Migrator({
      db,
      provider: {
        async getMigrations() {
          const {migrations} = await import('./migrations/');
          return migrations;
        },
      },
    });

    // Run migrations
    console.log('Running database migrations...');
    const {error, results} = await migrator.migrateToLatest();

    if (error) {
      console.error('Migration failed:', error);
      throw error;
    }

    if (results) {
      console.log('Migrations completed:', results);
    } else {
      console.log('Database is up to date');
    }

    console.log('Local database initialized successfully');

    return db;
  } catch (error) {
    console.error('Failed to initialize local database:', error);
    // Same reason as above, for the client this attempt just created.
    sqlocalClient = null;
    await destroyQuietly(client);
    throw error;
  }
}

async function closeSqlocalClient(): Promise<void> {
  const previous = sqlocalClient;
  sqlocalClient = null;
  await destroyQuietly(previous);
}

/**
 * A failed attempt leaves its worker, and that worker's connection to the OPFS
 * file, alive. Retrying without closing it puts two connections on one database
 * from a single page — the condition the migration lock exists to prevent
 * across tabs.
 *
 * A teardown failure must not replace the error that caused the teardown, and a
 * worker that never booted must not hold anything up: `destroy()` waits on a
 * worker reply with no timeout, so it is raced against one here.
 */
const DESTROY_TIMEOUT_MS = 3000;

async function destroyQuietly(
  client: SQLocalKysely | null | undefined,
): Promise<void> {
  if (!client) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.destroy(),
      new Promise<void>(resolve => {
        timer = setTimeout(() => {
          console.warn('Timed out destroying the previous SQLocal client');
          resolve();
        }, DESTROY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn('Could not destroy the previous SQLocal client', error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Health check function
export async function checkLocalDbHealth(): Promise<boolean> {
  try {
    const db = await getLocalDb();
    await db.selectFrom('spotify_playlists').select('id').limit(1).execute();
    return true;
  } catch (error) {
    console.error('Local database health check failed:', error);
    return false;
  }
}

// Get database statistics
export async function getLocalDbStats() {
  try {
    const db = await getLocalDb();

    // Add the number of local charts and the time of latest scan
    const [playlists, albums, tracks, chorusCharts, localCharts] =
      await Promise.all([
        db
          .selectFrom('spotify_playlists')
          .select(db.fn.count('id').as('count'))
          .executeTakeFirst(),
        db
          .selectFrom('spotify_albums')
          .select(db.fn.count('id').as('count'))
          .executeTakeFirst(),
        db
          .selectFrom('spotify_tracks')
          .select(db.fn.count('id').as('count'))
          .executeTakeFirst(),
        db
          .selectFrom('chorus_charts')
          .select(db.fn.count('md5').as('count'))
          .executeTakeFirst(),
        db
          .selectFrom('local_charts')
          .select(db.fn.count('id').as('count'))
          .select(db.fn.max('updated_at').as('latest_scan'))
          .executeTakeFirst(),
      ]);

    return {
      spotify: {
        playlists: Number(playlists?.count || 0),
        albums: Number(albums?.count || 0),
        tracks: Number(tracks?.count || 0),
      },
      chorus: {
        charts: Number(chorusCharts?.count || 0),
      },
      local: {
        charts: Number(localCharts?.count || 0),
        latest_scan: localCharts?.latest_scan || null,
      },
    };
  } catch (error) {
    console.error('Failed to get database stats:', error);
    return null;
  }
}

// Run a raw SQL query directly via SQLocal (bypassing Kysely query builder)
export async function runRawSql(sql: string): Promise<any[]> {
  if (!sql || !sql.trim()) return [];
  // Ensure DB (and sqlocalClient) is initialized
  await getLocalDb();
  if (!sqlocalClient) throw new Error('SQLocal client not initialized');
  return await sqlocalClient.sql(sql);
}

// Export the current OPFS database file
export async function exportLocalDbFile(): Promise<File> {
  await getLocalDb();
  if (!sqlocalClient) throw new Error('SQLocal client not initialized');
  return await sqlocalClient.getDatabaseFile();
}

// Overwrite the OPFS database file with provided contents and reinitialize
export async function overwriteLocalDbFile(
  databaseFile:
    | File
    | Blob
    | ArrayBuffer
    | Uint8Array
    | ReadableStream<Uint8Array>,
): Promise<void> {
  await getLocalDb();
  if (!sqlocalClient) throw new Error('SQLocal client not initialized');
  await sqlocalClient.overwriteDatabaseFile(databaseFile);
  // Force a fresh Kysely instance so connections see the new file
  await closeSqlocalClient();
  dbInitializationPromise = null;
  await getLocalDb();
}
