import {Kysely, SqliteDialect} from 'kysely';
// better-sqlite3 ships no bundled types and the project has no @types for it;
// a minimal local declaration keeps this test typechecking under strict mode.
const Database = require('better-sqlite3') as new (path: string) => {
  pragma(source: string): unknown;
};

// The drum-fills helpers import getDrumFillsDb from ../client, which pulls in
// sqlocal (browser-only). Every query in these tests passes an explicit db, so
// the real client is never invoked — mock it to avoid loading sqlocal in jest.
jest.mock('../client', () => ({
  getDrumFillsDb: jest.fn(async () => {
    throw new Error('getDrumFillsDb should not be called in tests');
  }),
}));

import {InitialMigration} from '../migrations/001_initial';
import type {DB} from '../types';
import {
  type FillInput,
  finishScanRun,
  getActiveLadders,
  getAttemptStats,
  getDueFills,
  getFillBest,
  getFillById,
  getFillsByIds,
  getFillSiblings,
  getGroupedLibrary,
  getGrooveClusters,
  getGrooveClusterByKey,
  getGrooveLadder,
  getLadderProgress,
  getLatestScanRun,
  getProgressSummary,
  getTodayQueue,
  hasFillsNeedingRescan,
  hasFillsNeedingGrooveRescan,
  queryFills,
  recordAttempt,
  replaceFillsForSong,
  setLadderProgress,
  startScanRun,
  upsertSrs,
} from '../';

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
    difficultyScore: 50,
    fingerprint: 'fp1',
    grooveFingerprint: 'gfp1',
    grooveSimilarityKey: 'gsk1',
    fillSimilarityKey: 'fsk1',
    confidence: 0.9,
    features: {nps: 8},
    ...overrides,
  };
}

describe('drum-fills queries', () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = makeDb();
    await InitialMigration.up(db as unknown as Kysely<any>);
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

  it('getFillsByIds returns fills in the requested order, dropping misses', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'a1'}), fill({id: 'a2'}), fill({id: 'a3'})],
      db,
    );
    const got = await getFillsByIds(['a3', 'missing', 'a1'], db);
    expect(got.map(f => f.id)).toEqual(['a3', 'a1']);
  });

  it('getFillsByIds returns [] for an empty id list', async () => {
    expect(await getFillsByIds([], db)).toEqual([]);
  });

  it('getFillSiblings returns all instances of a pattern, tempo-ordered', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({id: 'a1', fillSimilarityKey: 'PAT', tempoBpm: 150}),
        fill({id: 'a2', fillSimilarityKey: 'PAT', tempoBpm: 90}),
      ],
      db,
    );
    await replaceFillsForSong(
      'hashB',
      [
        fill({id: 'b1', fillSimilarityKey: 'PAT', tempoBpm: 120}),
        fill({id: 'b2', fillSimilarityKey: 'OTHER', tempoBpm: 100}),
      ],
      db,
    );
    const got = await getFillSiblings('PAT', db);
    expect(got.map(f => f.id)).toEqual(['a2', 'b1', 'a1']);
  });

  it('getFillSiblings returns [] for an empty key', async () => {
    expect(await getFillSiblings('', db)).toEqual([]);
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

  it('aggregates attempt counts and last-attempt timestamps per fill', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'a1'}), fill({id: 'a2'}), fill({id: 'a3'})],
      db,
    );
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 100,
        score: 0.5,
        judgments: [],
        ts: 1000,
      },
      db,
    );
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 100,
        score: 0.8,
        judgments: [],
        ts: 5000,
      },
      db,
    );
    await recordAttempt(
      {
        fillId: 'a2',
        mode: 'song-context',
        tempoPct: 100,
        score: 1,
        judgments: [],
        ts: 3000,
      },
      db,
    );

    const stats = await getAttemptStats(db);
    expect(stats.get('a1')).toEqual({count: 2, lastTs: 5000});
    expect(stats.get('a2')).toEqual({count: 1, lastTs: 3000});
    // a3 has no attempts → absent.
    expect(stats.has('a3')).toBe(false);
  });

  it('getFillBest returns the highest-scoring attempt with its judgments', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    expect(await getFillBest('a1', db)).toBeNull();

    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 80,
        score: 60,
        judgments: [{id: '0:red:p', judgment: 'good', deltaMs: 40}],
        ts: 1000,
      },
      db,
    );
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'song-context',
        tempoPct: 100,
        score: 95,
        judgments: [{id: '0:red:p', judgment: 'perfect', deltaMs: 5}],
        ts: 2000,
      },
      db,
    );
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 90,
        score: 70,
        judgments: [],
        ts: 3000,
      },
      db,
    );

    const best = await getFillBest('a1', db);
    expect(best).not.toBeNull();
    expect(best!.score).toBe(95);
    expect(best!.mode).toBe('song-context');
    expect(best!.tempoPct).toBe(100);
    expect(best!.judgments).toEqual([
      {id: '0:red:p', judgment: 'perfect', deltaMs: 5},
    ]);
  });

  it('getFillBest breaks score ties toward the most recent attempt', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 100,
        score: 90,
        judgments: [{id: 'old', judgment: 'good', deltaMs: 10}],
        ts: 1000,
      },
      db,
    );
    await recordAttempt(
      {
        fillId: 'a1',
        mode: 'isolated',
        tempoPct: 100,
        score: 90,
        judgments: [{id: 'new', judgment: 'perfect', deltaMs: 1}],
        ts: 2000,
      },
      db,
    );
    const best = await getFillBest('a1', db);
    expect(best!.judgments).toEqual([
      {id: 'new', judgment: 'perfect', deltaMs: 1},
    ]);
  });

  it('returns an empty attempt-stats map when nothing is practiced', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    const stats = await getAttemptStats(db);
    expect(stats.size).toBe(0);
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

  it('round-trips groove fingerprint + similarity key', async () => {
    await replaceFillsForSong(
      'hashA',
      [fill({id: 'a1', grooveFingerprint: 'GF', grooveSimilarityKey: 'GS'})],
      db,
    );
    const row = await getFillById('a1', db);
    expect(row!.grooveFingerprint).toBe('GF');
    expect(row!.grooveSimilarityKey).toBe('GS');
  });

  it('hasFillsNeedingGrooveRescan: false when all fills have fingerprints', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    expect(await hasFillsNeedingGrooveRescan(db)).toBe(false);
  });

  it('hasFillsNeedingGrooveRescan: true when a fill has a NULL fingerprint', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    // Simulate a pre-migration row by nulling its groove fingerprint.
    await db
      .updateTable('fills')
      .set({groove_fingerprint: null})
      .where('id', '=', 'a1')
      .execute();
    expect(await hasFillsNeedingGrooveRescan(db)).toBe(true);
  });

  it('getGrooveClusters groups fills across songs by similarity key', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({id: 'a1', grooveSimilarityKey: 'beat', tempoBpm: 120}),
        fill({id: 'a2', grooveSimilarityKey: 'beat', tempoBpm: 140}),
      ],
      db,
    );
    await replaceFillsForSong(
      'hashB',
      [
        fill({
          id: 'b1',
          chartHash: 'hashB',
          grooveSimilarityKey: 'beat',
          tempoBpm: 100,
        }),
        fill({
          id: 'b2',
          chartHash: 'hashB',
          grooveSimilarityKey: 'other',
        }),
      ],
      db,
    );

    const clusters = await getGrooveClusters(db);
    expect(clusters[0].similarityKey).toBe('beat');
    expect(clusters[0].fillCount).toBe(3);
    expect(clusters[0].distinctSongs).toBe(2);
    expect(clusters[0].tempoMin).toBe(100);
    expect(clusters[0].tempoMax).toBe(140);
    expect(clusters.find(c => c.similarityKey === 'other')!.fillCount).toBe(1);
  });

  it('getGrooveClusters ignores fills with NULL similarity key', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    await db
      .updateTable('fills')
      .set({groove_similarity_key: null})
      .where('id', '=', 'a1')
      .execute();
    expect(await getGrooveClusters(db)).toEqual([]);
  });

  it('getGrooveClusterByKey returns the cluster matching the similarity key', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({id: 'a1', grooveSimilarityKey: 'beat', tempoBpm: 100}),
        fill({id: 'a2', grooveSimilarityKey: 'beat', tempoBpm: 140}),
        fill({id: 'a3', grooveSimilarityKey: 'other', tempoBpm: 90}),
      ],
      db,
    );

    const cluster = await getGrooveClusterByKey('beat', db);
    expect(cluster).not.toBeNull();
    expect(cluster!.similarityKey).toBe('beat');
    expect(cluster!.fillIds.sort()).toEqual(['a1', 'a2']);
    expect(cluster!.fillCount).toBe(2);
    expect(cluster!.tempoMin).toBe(100);
    expect(cluster!.tempoMax).toBe(140);
  });

  it('getGrooveClusterByKey returns null for an unknown key', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    expect(await getGrooveClusterByKey('does-not-exist', db)).toBeNull();
  });

  it('hasFillsNeedingRescan: false when all fills have §5/§6 columns', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    expect(await hasFillsNeedingRescan(db)).toBe(false);
  });

  it('hasFillsNeedingRescan: true when a fill has a NULL new column', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    await db
      .updateTable('fills')
      .set({fill_similarity_key: null})
      .where('id', '=', 'a1')
      .execute();
    expect(await hasFillsNeedingRescan(db)).toBe(true);
  });

  it('getGroupedLibrary collapses fills across songs by fill similarity key', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({
          id: 'a1',
          fillSimilarityKey: 'PAT',
          tempoBpm: 100,
          song: 'SongA',
        }),
        fill({
          id: 'a2',
          fillSimilarityKey: 'PAT',
          tempoBpm: 140,
          song: 'SongA',
        }),
      ],
      db,
    );
    await replaceFillsForSong(
      'hashB',
      [
        fill({
          id: 'b1',
          chartHash: 'hashB',
          fillSimilarityKey: 'PAT',
          tempoBpm: 120,
          song: 'SongB',
        }),
        fill({
          id: 'b2',
          chartHash: 'hashB',
          fillSimilarityKey: 'OTHER',
          song: 'SongB',
        }),
      ],
      db,
    );

    const groups = await getGroupedLibrary({}, db);
    expect(groups[0].fillSimilarityKey).toBe('PAT');
    expect(groups[0].instanceCount).toBe(3);
    expect(groups[0].distinctSongs).toBe(2);
    expect(groups[0].tempoMin).toBe(100);
    expect(groups[0].tempoMedian).toBe(120);
    expect(groups[0].tempoMax).toBe(140);
    expect(groups[0].songs).toEqual(['SongA', 'SongB']);
    expect(
      groups.find(g => g.fillSimilarityKey === 'OTHER')!.instanceCount,
    ).toBe(1);
  });

  it('getGroupedLibrary skips NULL fill similarity keys', async () => {
    await replaceFillsForSong('hashA', [fill({id: 'a1'})], db);
    await db
      .updateTable('fills')
      .set({fill_similarity_key: null})
      .where('id', '=', 'a1')
      .execute();
    expect(await getGroupedLibrary({}, db)).toEqual([]);
  });

  it('getGroupedLibrary aggregates mastery: mastered only when all instances mastered', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({id: 'a1', fillSimilarityKey: 'PAT'}),
        fill({id: 'a2', fillSimilarityKey: 'PAT'}),
      ],
      db,
    );
    const now = Date.now();
    await upsertSrs(
      {
        fillId: 'a1',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 10,
        dueAt: now + 1000,
        passStreak: 3,
      },
      db,
    );
    // a2 still 'new' (no SRS row) → group is 'learning', not 'mastered'.
    let groups = await getGroupedLibrary({}, db);
    expect(groups[0].state).toBe('learning');

    await upsertSrs(
      {
        fillId: 'a2',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 10,
        dueAt: now + 1000,
        passStreak: 3,
      },
      db,
    );
    groups = await getGroupedLibrary({}, db);
    expect(groups[0].state).toBe('mastered');
  });

  it('getGrooveLadder orders cluster fills by difficulty, deduped by pattern', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({
          id: 'easy',
          grooveSimilarityKey: 'GROOVE',
          fillSimilarityKey: 'EASY',
          difficultyScore: 10,
        }),
        fill({
          id: 'hard',
          grooveSimilarityKey: 'GROOVE',
          fillSimilarityKey: 'HARD',
          difficultyScore: 80,
        }),
        // Duplicate of EASY pattern (same fill similarity key) — one rung.
        fill({
          id: 'easy-dup',
          grooveSimilarityKey: 'GROOVE',
          fillSimilarityKey: 'EASY',
          difficultyScore: 10,
        }),
        // Different groove — excluded.
        fill({
          id: 'other-groove',
          grooveSimilarityKey: 'OTHER',
          fillSimilarityKey: 'X',
          difficultyScore: 50,
        }),
      ],
      db,
    );

    const ladder = await getGrooveLadder('GROOVE', db);
    expect(ladder.map(r => r.fillSimilarityKey)).toEqual(['EASY', 'HARD']);
    expect(ladder[0].difficultyScore).toBe(10);
    expect(ladder[0].instanceCount).toBe(2);
    expect(ladder[1].difficultyScore).toBe(80);
  });

  it('ladder progress: get returns null until set, then round-trips + upserts', async () => {
    expect(await getLadderProgress('GROOVE', db)).toBeNull();

    await setLadderProgress(
      {
        grooveSimilarityKey: 'GROOVE',
        currentRungFillId: 'easy',
        updatedAt: 111,
      },
      db,
    );
    let p = await getLadderProgress('GROOVE', db);
    expect(p).toEqual({
      grooveSimilarityKey: 'GROOVE',
      currentRungFillId: 'easy',
      updatedAt: 111,
    });

    await setLadderProgress(
      {
        grooveSimilarityKey: 'GROOVE',
        currentRungFillId: 'hard',
        updatedAt: 222,
      },
      db,
    );
    p = await getLadderProgress('GROOVE', db);
    expect(p!.currentRungFillId).toBe('hard');
    expect(p!.updatedAt).toBe(222);
  });

  it('getProgressSummary aggregates grooves, rungs, mastery, and due counts', async () => {
    // One drillable groove (≥2 distinct patterns) + one singleton groove.
    await replaceFillsForSong(
      'hashA',
      [
        fill({
          id: 'r1',
          grooveSimilarityKey: 'G',
          fillSimilarityKey: 'P1',
          difficultyScore: 10,
        }),
        fill({
          id: 'r2',
          grooveSimilarityKey: 'G',
          fillSimilarityKey: 'P2',
          difficultyScore: 50,
        }),
        fill({
          id: 'r3',
          grooveSimilarityKey: 'G',
          fillSimilarityKey: 'P3',
          difficultyScore: 90,
        }),
        // Singleton groove — not drillable.
        fill({
          id: 'solo',
          grooveSimilarityKey: 'SOLO',
          fillSimilarityKey: 'PS',
          difficultyScore: 30,
        }),
      ],
      db,
    );

    // Master pattern P1 (its only instance).
    await upsertSrs(
      {
        fillId: 'r1',
        state: 'mastered',
        ease: 2.5,
        intervalDays: 30,
        dueAt: Date.now() + 1_000_000,
        passStreak: 3,
      },
      db,
    );
    // P2 due now (learning).
    await upsertSrs(
      {
        fillId: 'r2',
        state: 'learning',
        ease: 2.0,
        intervalDays: 1,
        dueAt: 500,
        passStreak: 0,
      },
      db,
    );

    // Park the ladder on rung index 1 (P2 — two rungs climbed-from-zero = 1).
    await setLadderProgress(
      {grooveSimilarityKey: 'G', currentRungFillId: 'P2', updatedAt: 100},
      db,
    );

    const summary = await getProgressSummary(1000, db);
    expect(summary.totalGrooves).toBe(1); // only G is drillable
    expect(summary.groovesStarted).toBe(1);
    expect(summary.rungsClimbed).toBe(1); // parked on index 1
    expect(summary.fillsMastered).toBe(1); // P1
    expect(summary.dueNow).toBe(1); // P2 due_at <= 1000
  });

  it('getActiveLadders returns started ladders newest-first with rung position', async () => {
    await replaceFillsForSong(
      'hashA',
      [
        fill({
          id: 'g1a',
          grooveSimilarityKey: 'GA',
          fillSimilarityKey: 'A1',
          difficultyScore: 10,
        }),
        fill({
          id: 'g1b',
          grooveSimilarityKey: 'GA',
          fillSimilarityKey: 'A2',
          difficultyScore: 60,
        }),
        fill({
          id: 'g2a',
          grooveSimilarityKey: 'GB',
          fillSimilarityKey: 'B1',
          difficultyScore: 20,
        }),
        fill({
          id: 'g2b',
          grooveSimilarityKey: 'GB',
          fillSimilarityKey: 'B2',
          difficultyScore: 70,
        }),
      ],
      db,
    );

    await setLadderProgress(
      {grooveSimilarityKey: 'GA', currentRungFillId: 'A1', updatedAt: 100},
      db,
    );
    await setLadderProgress(
      {grooveSimilarityKey: 'GB', currentRungFillId: 'B2', updatedAt: 200},
      db,
    );

    const active = await getActiveLadders(6, db);
    expect(active.map(a => a.cluster.similarityKey)).toEqual(['GB', 'GA']);
    expect(active[0].rungIndex).toBe(1); // GB parked on B2 (index 1)
    expect(active[0].rungCount).toBe(2);
    expect(active[1].rungIndex).toBe(0); // GA parked on A1 (index 0)
  });
});
