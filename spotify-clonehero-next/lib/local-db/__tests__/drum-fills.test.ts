import {Kysely, SqliteDialect} from 'kysely';
// better-sqlite3 ships no bundled types and the project has no @types for it;
// a minimal local declaration keeps this test typechecking under strict mode.
const Database = require('better-sqlite3') as new (path: string) => {
  pragma(source: string): unknown;
};

// The drum-fills helpers import getLocalDb from ../client, which pulls in
// sqlocal (browser-only). Every query in these tests passes an explicit db, so
// the real client is never invoked — mock it to avoid loading sqlocal in jest.
jest.mock('../client', () => ({
  getLocalDb: jest.fn(async () => {
    throw new Error('getLocalDb should not be called in tests');
  }),
}));

import {migration_010_drum_fills} from '../migrations/010_drum_fills';
import type {DB} from '../types';
import {
  type FillInput,
  finishScanRun,
  getDueFills,
  getFillById,
  getLatestScanRun,
  getTodayQueue,
  queryFills,
  recordAttempt,
  replaceFillsForSong,
  startScanRun,
  upsertSrs,
} from '../drum-fills';

function makeDb(): Kysely<DB> {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  return new Kysely<DB>({
    dialect: new SqliteDialect({database: sqlite as never}),
  });
}

function fill(overrides: Partial<FillInput> = {}): FillInput {
  return {
    id: 'fill-1',
    chartHash: 'hashA',
    libraryPath: '/Songs/Artist - Song',
    song: 'Song',
    artist: 'Artist',
    charter: 'Charter',
    startTick: 0,
    endTick: 480,
    grooveStartTick: 0,
    grooveEndTick: 0,
    tempoBpm: 120,
    lengthBars: 1,
    subdivision: '16ths',
    complexity: 3,
    voicingTags: ['toms', 'crash-end'],
    fingerprint: 'fp1',
    confidence: 0.9,
    features: {nps: 8},
    ...overrides,
  };
}

describe('drum-fills queries', () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = makeDb();
    await migration_010_drum_fills.up(db as unknown as Kysely<any>);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('replaces fills for a song without disturbing other songs', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'a1'}), fill({id: 'a2', subdivision: '8ths'})],
      db,
    );
    await replaceFillsForSong(
      'hashB',
      [fill({id: 'b1', chartHash: 'hashB', song: 'Other'})],
      db,
    );

    expect((await queryFills({}, db)).length).toBe(3);

    // Rescan hashA with a single fill — only hashA's fills change.
    await replaceFillsForSong('hashA', [fill({id: 'a3'})], db);

    const all = await queryFills({}, db);
    expect(all.map(f => f.id).sort()).toEqual(['a3', 'b1']);
  });

  it('round-trips JSON columns as parsed values', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    const got = await getFillById('a1', db);
    expect(got).not.toBeNull();
    expect(got!.voicingTags).toEqual(['toms', 'crash-end']);
    expect(got!.features).toEqual({nps: 8});
    expect(got!.srs).toBeNull();
  });

  it('applies taxonomy filters', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({
          id: 'a1',
          subdivision: '8ths',
          complexity: 1,
          voicingTags: ['snare-only'],
        }),
        fill({
          id: 'a2',
          subdivision: '16ths',
          complexity: 4,
          voicingTags: ['toms'],
        }),
        fill({
          id: 'a3',
          subdivision: 'triplets',
          complexity: 5,
          voicingTags: ['toms', 'flams'],
        }),
      ],
      db,
    );

    expect(
      (await queryFills({subdivision: ['16ths', 'triplets']}, db))
        .map(f => f.id)
        .sort(),
    ).toEqual(['a2', 'a3']);

    expect(
      (await queryFills({minComplexity: 4}, db)).map(f => f.id).sort(),
    ).toEqual(['a2', 'a3']);

    expect((await queryFills({maxComplexity: 1}, db)).map(f => f.id)).toEqual([
      'a1',
    ]);

    // voicingTags requires ALL tags present.
    expect(
      (await queryFills({voicingTags: ['toms']}, db)).map(f => f.id).sort(),
    ).toEqual(['a2', 'a3']);
    expect(
      (await queryFills({voicingTags: ['toms', 'flams']}, db)).map(f => f.id),
    ).toEqual(['a3']);
  });

  it('records attempts and cascades on fill delete', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    const id1 = await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 80,
        score: 0.95,
        judgments: [{n: 1}],
      },
      db,
    );
    expect(id1).toBeGreaterThan(0);

    const attempts = await db
      .selectFrom('fill_attempts')
      .selectAll()
      .where('fill_id', '=', 'a1')
      .execute();
    expect(attempts.length).toBe(1);
    expect(JSON.parse(attempts[0].judgments)).toEqual([{n: 1}]);

    // Re-scanning the song deletes the fill, cascading to attempts.
    await replaceFillsForSong('hashA', [], db);
    const after = await db.selectFrom('fill_attempts').selectAll().execute();
    expect(after.length).toBe(0);
  });

  it('upserts SRS state and joins it into queries', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);

    await upsertSrs(
      {
        fillId: 'a1',
        state: 'learning',
        ease: 2.5,
        intervalDays: 1,
        dueAt: 1000,
        passStreak: 1,
        updatedAt: 500,
      },
      db,
    );

    let got = await getFillById('a1', db);
    expect(got!.srs).toEqual({
      state: 'learning',
      ease: 2.5,
      intervalDays: 1,
      dueAt: 1000,
      passStreak: 1,
      updatedAt: 500,
    });

    // Upsert again updates in place.
    await upsertSrs(
      {
        fillId: 'a1',
        state: 'mastered',
        ease: 2.6,
        intervalDays: 4,
        dueAt: 2000,
        passStreak: 3,
        updatedAt: 600,
      },
      db,
    );
    got = await getFillById('a1', db);
    expect(got!.srs!.state).toBe('mastered');
    expect(got!.srs!.intervalDays).toBe(4);

    // State filter.
    expect(
      (await queryFills({state: ['mastered']}, db)).map(f => f.id),
    ).toEqual(['a1']);
    expect((await queryFills({state: ['new']}, db)).length).toBe(0);
  });

  it('returns due fills soonest-first', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'a1'}), fill({id: 'a2'}), fill({id: 'a3'})],
      db,
    );
    await upsertSrs(
      {
        fillId: 'a1',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 1,
        dueAt: 100,
        passStreak: 1,
      },
      db,
    );
    await upsertSrs(
      {
        fillId: 'a2',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 1,
        dueAt: 50,
        passStreak: 1,
      },
      db,
    );
    await upsertSrs(
      {
        fillId: 'a3',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 1,
        dueAt: 5000,
        passStreak: 1,
      },
      db,
    );

    const due = await getDueFills(200, undefined, db);
    expect(due.map(f => f.id)).toEqual(['a2', 'a1']);
  });

  it('builds today queue: due reviews then new fills', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'due1'}), fill({id: 'new1'}), fill({id: 'new2'})],
      db,
    );
    await upsertSrs(
      {
        fillId: 'due1',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 1,
        dueAt: 10,
        passStreak: 1,
      },
      db,
    );

    const queue = await getTodayQueue(100, 10, db);
    expect(queue[0].id).toBe('due1');
    expect(queue.map(f => f.id).sort()).toEqual(['due1', 'new1', 'new2']);

    // Respects limit, due first.
    const limited = await getTodayQueue(100, 1, db);
    expect(limited.map(f => f.id)).toEqual(['due1']);
  });

  it('tracks scan runs', async () => {
    const runId = await startScanRun(1000, db);
    let latest = await getLatestScanRun(db);
    expect(latest!.id).toBe(runId);
    expect(latest!.finished_at).toBeNull();

    await finishScanRun(
      runId,
      {songsScanned: 42, fillsFound: 7, finishedAt: 2000},
      db,
    );
    latest = await getLatestScanRun(db);
    expect(latest!.finished_at).toBe(2000);
    expect(latest!.songs_scanned).toBe(42);
    expect(latest!.fills_found).toBe(7);
  });
});
