import {Kysely, Migrator, SqliteDialect, sql} from 'kysely';

import {migrations} from '..';
import {normalizeStrForMatching} from '../../normalize';

jest.mock('sqlocal/kysely', () => ({SQLocalKysely: jest.fn()}), {
  virtual: true,
});

const Database = require('better-sqlite3') as new (path: string) => {
  function(name: string, fn: (value: string) => string): unknown;
};

function makeDb() {
  const sqlite = new Database(':memory:');
  // The real client registers this scalar function on the connection; the
  // renormalize migrations call it.
  sqlite.function('normalize', (value: string) =>
    normalizeStrForMatching(value ?? ''),
  );
  return new Kysely<Record<string, never>>({
    dialect: new SqliteDialect({database: sqlite as never}),
  });
}

it('runs every migration against an empty database', async () => {
  const db = makeDb();
  try {
    const result = await new Migrator({
      db,
      provider: {
        async getMigrations() {
          return migrations;
        },
      },
    }).migrateToLatest();

    expect(result.error).toBeUndefined();
    expect(result.results?.every(entry => entry.status === 'Success')).toBe(
      true,
    );
    expect(result.results).toHaveLength(Object.keys(migrations).length);
  } finally {
    await db.destroy();
  }
});

it('renormalizes stored identities that predate the edition-suffix rules', async () => {
  const db = makeDb();
  try {
    const migrator = new Migrator({
      db,
      provider: {
        async getMigrations() {
          return migrations;
        },
      },
    });
    // Stop just before the renormalize so a legacy row can be planted.
    const partial = await migrator.migrateTo('016_apple_music_library');
    expect(partial.error).toBeUndefined();

    await sql`
      INSERT INTO chorus_charts (
        md5, name, artist, charter, modified_time, has_video_background,
        group_id, artist_normalized, name_normalized, charter_normalized
      ) VALUES (
        'md5', 'Comfortably Numb - Remastered 2011', 'Pink Floyd', 'Someone',
        '2026-01-01', 0, 1,
        'pink floyd', 'comfortably numb remastered 2011', 'someone'
      )
    `.execute(db);

    const result = await migrator.migrateToLatest();
    expect(result.error).toBeUndefined();

    const rows = await sql<{
      name_normalized: string;
      first_seen: string | null;
    }>`SELECT name_normalized, first_seen FROM chorus_charts`.execute(db);
    expect(rows.rows[0]?.name_normalized).toBe('comfortably numb');
    expect(rows.rows[0]?.first_seen).toBeNull();
  } finally {
    await db.destroy();
  }
});
