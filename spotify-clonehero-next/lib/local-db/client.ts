import {SQLocalKysely} from 'sqlocal/kysely';
import {Kysely, Migrator} from 'kysely';
import type {Database} from './types';

// Database client - will be initialized in initializeLocalDb()
let localDb: Kysely<Database> | null = null;

// Get the database client (throws if not initialized)
export function getLocalDb(): Kysely<Database> {
  if (!localDb) {
    throw new Error(
      'Local database not initialized. Call initializeLocalDb() first.',
    );
  }
  return localDb;
}

// Initialize the database with migrations
export async function initializeLocalDb(): Promise<void> {
  try {
    console.log('Initializing SQLocal database...');

    // Create the SQLocal database client
    const {dialect} = new SQLocalKysely('spotify-clonehero-local.sqlite3');
    localDb = new Kysely<Database>({dialect});

    // Create migrator
    const migrator = new Migrator({
      db: localDb,
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
  } catch (error) {
    console.error('Failed to initialize local database:', error);
    throw error;
  }
}

// Health check function
export async function checkLocalDbHealth(): Promise<boolean> {
  try {
    const db = getLocalDb();
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
    const db = getLocalDb();
    const [playlists, albums, tracks] = await Promise.all([
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
    ]);

    return {
      spotify: {
        playlists: Number(playlists?.count || 0),
        albums: Number(albums?.count || 0),
        tracks: Number(tracks?.count || 0),
      },
    };
  } catch (error) {
    console.error('Failed to get database stats:', error);
    return null;
  }
}
