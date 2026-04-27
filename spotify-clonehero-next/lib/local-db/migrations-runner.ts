import {Migrator, type Kysely} from 'kysely';
import type {DB} from './types';

/**
 * Run all pending Kysely migrations against the given database.
 *
 * Assumes the underlying connection already has the `normalize` scalar
 * function registered (migrations 004, 005, and 009 invoke it from SQL).
 * Production wires this up in `client.ts`; tests register it directly on
 * the better-sqlite3 connection before calling this helper.
 */
export async function applyMigrations(db: Kysely<DB>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: {
      async getMigrations() {
        const {migrations} = await import('./migrations/');
        return migrations;
      },
    },
  });

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
}
