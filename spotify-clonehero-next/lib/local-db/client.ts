import {SQLocalKysely} from 'sqlocal/kysely';
import {Kysely, Migrator} from 'kysely';
import type {DB} from './types';

// Database client - will be initialized in initializeLocalDb()
let localDb: Kysely<DB> | null = null;

// Initialize the database with migrations
export async function getLocalDb(): Promise<Kysely<DB>> {
  if (localDb) {
    return localDb;
  }

  try {
    console.log('Initializing SQLocal database...');

    // Create the SQLocal database client
    const {dialect} = new SQLocalKysely('spotify-clonehero-local.sqlite3');
    localDb = new Kysely<DB>({dialect});

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

  return localDb;
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
