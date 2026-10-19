import {SQLocalKysely} from 'sqlocal/kysely';
import {Kysely, Migrator, ParseJSONResultsPlugin} from 'kysely';
import type {DB} from './types';

// The drum-fills tool owns this database. It is separate from the shared
// `spotify-clonehero-local.sqlite3` so the rest of the app never runs (or
// depends on) drum-fills migrations. Only drum-fills code imports this module,
// so the DB is created and migrated lazily on first use of the tool.

let drumFillsDb: Kysely<DB> | null = null;
let dbInitializationPromise: Promise<Kysely<DB>> | null = null;
let sqlocalClient: SQLocalKysely | null = null;

export async function getDrumFillsDb(): Promise<Kysely<DB>> {
  if (drumFillsDb) {
    return drumFillsDb;
  }
  if (dbInitializationPromise) {
    return dbInitializationPromise;
  }
  dbInitializationPromise = initializeDatabase();
  return dbInitializationPromise;
}

if (typeof window !== 'undefined') {
  (
    window as unknown as {getDrumFillsDb?: typeof getDrumFillsDb}
  ).getDrumFillsDb = getDrumFillsDb;
}

async function initializeDatabase(): Promise<Kysely<DB>> {
  try {
    console.log('Initializing drum-fills database...');

    // `onInit` runs after every (re)connect — set page cache and temp store
    // here so all callers benefit. Negative cache_size values are KiB;
    // -65536 = 64 MiB. Per-tab.
    const client = new SQLocalKysely({
      databasePath: 'drum-fills.sqlite3',
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

    const migrator = new Migrator({
      db,
      provider: {
        async getMigrations() {
          const {migrations} = await import('./migrations/');
          return migrations;
        },
      },
    });

    console.log('Running drum-fills migrations...');
    const {error, results} = await migrator.migrateToLatest();

    if (error) {
      console.error('Drum-fills migration failed:', error);
      throw error;
    }

    if (results) {
      console.log('Drum-fills migrations completed:', results);
    } else {
      console.log('Drum-fills database is up to date');
    }

    console.log('Drum-fills database initialized successfully');

    drumFillsDb = db;
    return drumFillsDb;
  } catch (error) {
    console.error('Failed to initialize drum-fills database:', error);
    dbInitializationPromise = null;
    throw error;
  }
}

// Export the current OPFS database file.
export async function exportDrumFillsDbFile(): Promise<File> {
  await getDrumFillsDb();
  if (!sqlocalClient)
    throw new Error('Drum-fills SQLocal client not initialized');
  return await sqlocalClient.getDatabaseFile();
}

// Overwrite the OPFS database file with provided contents and reinitialize.
export async function overwriteDrumFillsDbFile(
  databaseFile:
    | File
    | Blob
    | ArrayBuffer
    | Uint8Array
    | ReadableStream<Uint8Array>,
): Promise<void> {
  await getDrumFillsDb();
  if (!sqlocalClient)
    throw new Error('Drum-fills SQLocal client not initialized');
  await sqlocalClient.overwriteDatabaseFile(databaseFile);
  // Force a fresh Kysely instance so connections see the new file.
  drumFillsDb = null;
  dbInitializationPromise = null;
  await getDrumFillsDb();
}
