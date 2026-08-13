import {Kysely, SqliteDialect, sql} from 'kysely';

import type {ChorusChartDbRow} from '@/lib/chorusChartDb/types';
import type {DB} from '@/lib/local-db/types';
import {upsertCharts} from '../index';

jest.mock('sqlocal/kysely', () => ({SQLocalKysely: jest.fn()}), {
  virtual: true,
});

const Database = require('better-sqlite3') as new (path: string) => unknown;

function makeDb() {
  const sqlite = new Database(':memory:') as {
    exec: (sql: string) => void;
  };
  sqlite.exec(`
    CREATE TABLE chorus_charts (
      md5 TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      charter TEXT NOT NULL,
      diff_drums INTEGER,
      diff_guitar INTEGER,
      diff_bass INTEGER,
      diff_keys INTEGER,
      diff_drums_real INTEGER,
      has_guitar INTEGER NOT NULL DEFAULT 0,
      has_bass INTEGER NOT NULL DEFAULT 0,
      has_keys INTEGER NOT NULL DEFAULT 0,
      has_pro_drums INTEGER NOT NULL DEFAULT 0,
      modified_time TEXT NOT NULL,
      song_length INTEGER,
      has_video_background INTEGER NOT NULL,
      album_art_md5 TEXT,
      group_id INTEGER NOT NULL,
      first_seen TEXT,
      artist_normalized TEXT,
      name_normalized TEXT,
      charter_normalized TEXT
    );
    CREATE TABLE spotify_tracks (
      id TEXT PRIMARY KEY,
      artist TEXT NOT NULL,
      name TEXT NOT NULL,
      artist_normalized TEXT,
      name_normalized TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE spotify_track_chart_matches (
      spotify_id TEXT NOT NULL,
      chart_md5 TEXT NOT NULL,
      matched_at INTEGER NOT NULL,
      UNIQUE (spotify_id, chart_md5)
    );
  `);
  return new Kysely<DB>({
    dialect: new SqliteDialect({database: sqlite as never}),
  });
}

function chart(
  difficulties: Pick<
    ChorusChartDbRow,
    'diff_drums' | 'diff_guitar' | 'diff_bass' | 'diff_keys' | 'diff_drums_real'
  >,
  overrides: Partial<ChorusChartDbRow> & {pro_drums?: boolean} = {},
): ChorusChartDbRow {
  return {
    md5: 'f3aed706fd4f7ab4723a95be70ddc3b6',
    artist: 'Franz Ferdinand',
    name: 'Take Me Out',
    charter: 'Harmonix',
    modifiedTime: '2024-01-08T06:20:56.000Z',
    hasVideoBackground: false,
    albumArtMd5: '',
    notesData: {},
    groupId: 1,
    ...difficulties,
    ...overrides,
  };
}

it('updates an existing Chorus chart when refreshed instrument data arrives', async () => {
  const db = makeDb();

  try {
    await db.transaction().execute(trx =>
      upsertCharts(trx, [
        chart({
          diff_drums: null,
          diff_guitar: null,
          diff_bass: null,
          diff_keys: null,
          diff_drums_real: null,
        }),
      ]),
    );
    await db.transaction().execute(trx =>
      upsertCharts(trx, [
        chart({
          diff_drums: 4,
          diff_guitar: 3,
          diff_bass: 0,
          diff_keys: -1,
          diff_drums_real: 4,
        }),
      ]),
    );

    const refreshed = await db
      .selectFrom('chorus_charts')
      .select([
        'diff_drums',
        'diff_guitar',
        'diff_bass',
        'diff_keys',
        'diff_drums_real',
      ])
      .where('md5', '=', 'f3aed706fd4f7ab4723a95be70ddc3b6')
      .executeTakeFirstOrThrow();

    expect(refreshed).toEqual({
      diff_drums: 4,
      diff_guitar: 3,
      diff_bass: 0,
      diff_keys: -1,
      diff_drums_real: 4,
    });
    expect(
      await sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM chorus_charts`.execute(db),
    ).toMatchObject({rows: [{count: 1}]});
  } finally {
    await db.destroy();
  }
});

it('persists track-level presence when Chorus has no numeric intensity', async () => {
  const db = makeDb();

  try {
    await db.transaction().execute(trx =>
      upsertCharts(trx, [
        chart(
          {
            diff_drums: -1,
            diff_guitar: -1,
            diff_bass: -1,
            diff_keys: -1,
            diff_drums_real: -1,
          },
          {
            md5: 'b26561a9d61bd5f4d2454a9169a42654',
            artist: 'Coldplay',
            name: 'Violet Hill',
            charter: 'Vicarious Visions',
            notesData: {
              trackHashes: [
                {instrument: 'guitar', difficulty: 'expert'},
                {instrument: 'bass', difficulty: 'expert'},
              ],
            },
          },
        ),
      ]),
    );

    const row = await db
      .selectFrom('chorus_charts')
      .select(['has_guitar', 'has_bass', 'has_keys', 'has_pro_drums'])
      .where('md5', '=', 'b26561a9d61bd5f4d2454a9169a42654')
      .executeTakeFirstOrThrow();

    expect(row).toEqual({
      has_guitar: 1,
      has_bass: 1,
      has_keys: 0,
      has_pro_drums: 0,
    });
  } finally {
    await db.destroy();
  }
});

it('does not infer drums from a stale pro_drums modifier', async () => {
  const db = makeDb();

  try {
    await db.transaction().execute(trx =>
      upsertCharts(trx, [
        chart(
          {
            diff_drums: -1,
            diff_guitar: 3,
            diff_bass: -1,
            diff_keys: -1,
            diff_drums_real: -1,
          },
          {
            md5: 'aed76d9d79512e16dd6c3439628e3345',
            artist: 'Escape the Fate',
            name: 'Situations',
            charter: 'Yhughu',
            pro_drums: true,
            notesData: {
              instruments: ['guitar', 'guitarghl'],
              trackHashes: [
                {instrument: 'guitar', difficulty: 'expert'},
                {instrument: 'guitarghl', difficulty: 'expert'},
              ],
            },
          },
        ),
      ]),
    );

    const row = await db
      .selectFrom('chorus_charts')
      .select(['has_guitar', 'has_pro_drums'])
      .where('md5', '=', 'aed76d9d79512e16dd6c3439628e3345')
      .executeTakeFirstOrThrow();

    expect(row).toEqual({has_guitar: 1, has_pro_drums: 0});
  } finally {
    await db.destroy();
  }
});

it('uses the actual drums track when drum intensity is unavailable', async () => {
  const db = makeDb();

  try {
    await db.transaction().execute(trx =>
      upsertCharts(trx, [
        chart(
          {
            diff_drums: -1,
            diff_guitar: -1,
            diff_bass: -1,
            diff_keys: -1,
            diff_drums_real: -1,
          },
          {
            md5: 'drums-without-intensity',
            pro_drums: false,
            notesData: {
              instruments: ['drums'],
              trackHashes: [{instrument: 'drums', difficulty: 'expert'}],
            },
          },
        ),
      ]),
    );

    const row = await db
      .selectFrom('chorus_charts')
      .select('has_pro_drums')
      .where('md5', '=', 'drums-without-intensity')
      .executeTakeFirstOrThrow();

    expect(row.has_pro_drums).toBe(1);
  } finally {
    await db.destroy();
  }
});
