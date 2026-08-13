import fs from 'fs';
import path from 'path';
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

// A migration file that is written but never added to the record is invisible:
// it type-checks, it lints if something imports it, and it silently never runs.
it('registers every migration file that exists on disk', () => {
  const files = fs
    .readdirSync(path.join(__dirname, '..'))
    .filter(name => /^\d{3}_.*\.ts$/.test(name))
    .map(name => name.replace(/\.ts$/, ''))
    .sort();

  expect(Object.keys(migrations).sort()).toEqual(files);
});

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

it('indexes chorus_charts for the group-revision lookup', async () => {
  const db = makeDb();
  try {
    await new Migrator({
      db,
      provider: {
        async getMigrations() {
          return migrations;
        },
      },
    }).migrateToLatest();
    const indexes = await sql<{name: string}>`
      PRAGMA index_list('chorus_charts')
    `.execute(db);
    expect(indexes.rows.map(row => row.name)).toContain(
      'idx_chorus_charts_group_revision',
    );
  } finally {
    await db.destroy();
  }
});

it('adds instrument presence columns to a populated pre-019 database', async () => {
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
    const partial = await migrator.migrateTo('018_find_music_ranking_signals');
    expect(partial.error).toBeUndefined();

    await sql`
      INSERT INTO chorus_charts (
        md5, name, artist, charter, modified_time, has_video_background,
        group_id, artist_normalized, name_normalized, charter_normalized,
        has_guitar, has_bass, has_keys, has_pro_drums
      ) VALUES (
        'legacy-md5', 'Legacy Song', 'Legacy Artist', 'Someone',
        '2026-01-01', 0, 1, 'legacy artist', 'legacy song', 'someone',
        1, 0, 0, 1
      )
    `.execute(db);
    await sql`
      INSERT INTO chorus_metadata (key, value)
      VALUES ('charts_data_version', '5')
    `.execute(db);

    const result = await migrator.migrateToLatest();
    expect(result.error).toBeUndefined();

    const rows = await sql<{
      has_drums: number;
      has_other_instruments: number;
    }>`
      SELECT has_drums, has_other_instruments
      FROM chorus_charts
      WHERE md5 = 'legacy-md5'
    `.execute(db);
    expect(rows.rows[0]).toEqual({has_drums: 0, has_other_instruments: 0});

    // The stored version is left alone: CHART_DB_DATA_VERSION is what tells a
    // client to re-ingest, and one trigger is enough.
    const metadata = await sql<{value: string}>`
      SELECT value FROM chorus_metadata WHERE key = 'charts_data_version'
    `.execute(db);
    expect(metadata.rows[0]?.value).toBe('5');
  } finally {
    await db.destroy();
  }
});
