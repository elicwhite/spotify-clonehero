import {SQLocalKysely} from 'sqlocal/kysely';
import {Kysely, Migrator, ParseJSONResultsPlugin} from 'kysely';
import type {DB} from './types';
import {normalizeStrForMatching} from './normalize';

// Database client - will be initialized in initializeLocalDb()
let localDb: Kysely<DB> | null = null;
let dbInitializationPromise: Promise<Kysely<DB>> | null = null;
let sqlocalClient: SQLocalKysely | null = null;

// Initialize the database with migrations
export async function getLocalDb(): Promise<Kysely<DB>> {
  // If database is already initialized, return it immediately
  if (localDb) {
    return localDb;
  }

  // If initialization is already in progress, return the existing promise
  if (dbInitializationPromise) {
    return dbInitializationPromise;
  }

  // Start initialization and store the promise
  dbInitializationPromise = initializeDatabase();
  return dbInitializationPromise;
}

if (typeof window !== 'undefined') {
  window.getLocalDb = getLocalDb;
}

async function initializeDatabase(): Promise<Kysely<DB>> {
  try {
    console.log('Initializing SQLocal database...');

    // Create the SQLocal database client
    const client = new SQLocalKysely('spotify-clonehero-local.sqlite3');
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

    localDb = db;
    return localDb;
  } catch (error) {
    console.error('Failed to initialize local database:', error);
    // Reset the promise so we can retry on next call
    dbInitializationPromise = null;
    throw error;
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
  localDb = null;
  dbInitializationPromise = null;
  await getLocalDb();
}
