import {Kysely, Migrator, SqliteDialect, type Migration} from 'kysely';

import {migrations} from '..';

jest.mock('sqlocal/kysely', () => ({SQLocalKysely: jest.fn()}), {
  virtual: true,
});

const Database = require('better-sqlite3') as new (path: string) => unknown;

function noOpMigration(): Migration {
  return {
    async up() {},
    async down() {},
  };
}

it('accepts databases that already recorded the reverted 014 migration', async () => {
  const db = new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({database: new Database(':memory:') as never}),
  });

  try {
    expect(migrations).toHaveProperty('014_local_chart_source_song');

    const recordedMigrations = Object.fromEntries(
      Object.keys(migrations).map(name => [name, noOpMigration()]),
    );
    const recorder = new Migrator({
      db,
      provider: {
        async getMigrations() {
          return recordedMigrations;
        },
      },
    });
    expect((await recorder.migrateToLatest()).error).toBeUndefined();

    const verifier = new Migrator({
      db,
      provider: {
        async getMigrations() {
          return migrations;
        },
      },
    });
    const result = await verifier.migrateToLatest();

    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([]);
  } finally {
    await db.destroy();
  }
});
