import Database from 'better-sqlite3';
import {Kysely, ParseJSONResultsPlugin, SqliteDialect} from 'kysely';
import {applyMigrations} from '../../migrations-runner';
import {normalizeStrForMatching} from '../../normalize';
import {
  __resetLocalDbForTesting,
  __setLocalDbForTesting,
} from '../../test-override';
import type {DB} from '../../types';

/**
 * Build a fresh in-memory SQLite database with the same migrations + scalar
 * function setup the production SQLocal client uses. The `normalize` scalar
 * MUST be registered before migrations run — migrations 004, 005, and 009
 * call it from SQL.
 */
export async function createTestDb(): Promise<Kysely<DB>> {
  const sqlite = new Database(':memory:');
  sqlite.function('normalize', (str: unknown) =>
    typeof str === 'string' ? normalizeStrForMatching(str) : null,
  );
  sqlite.pragma('foreign_keys = ON');

  const db = new Kysely<DB>({
    dialect: new SqliteDialect({database: sqlite}),
    plugins: [new ParseJSONResultsPlugin()],
  });

  await applyMigrations(db);
  return db;
}

/**
 * Build a test DB and install it as the override returned by `getLocalDb()`,
 * so production code paths that call `getLocalDb()` internally hit this DB.
 */
export async function installTestDb(): Promise<Kysely<DB>> {
  const db = await createTestDb();
  __setLocalDbForTesting(db);
  return db;
}

/**
 * Drop the override and destroy the test DB. Intended for `afterEach`.
 */
export async function teardownTestDb(db: Kysely<DB>): Promise<void> {
  __resetLocalDbForTesting();
  await db.destroy();
}
