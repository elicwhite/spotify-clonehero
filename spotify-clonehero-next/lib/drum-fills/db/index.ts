import {Kysely, Selectable} from 'kysely';
import {getDrumFillsDb} from './client';
import type {DB, ScanRuns} from './types';
import {
  buildGrooveClusters,
  type GrooveCluster,
  type GrooveClusterInput,
} from '@/lib/drum-fills/grooveClusters';

export type {GrooveCluster} from '@/lib/drum-fills/grooveClusters';

export type ScanRun = Selectable<ScanRuns>;

export type Subdivision = '8ths' | '16ths' | 'triplets' | 'mixed';
export type FillMode =
  | 'song-context'
  | 'isolated'
  | 'speed-trainer'
  | 'roulette';
export type SrsState = 'new' | 'learning' | 'mastered';

/**
 * A detected fill ready to be persisted. JSON columns (`voicing_tags`,
 * `features`, `judgments`) are accepted as parsed values here and serialized by
 * the helpers, so callers never touch JSON.stringify.
 */
export type FillInput = {
  id: string;
  chartHash: string;
  libraryPath: string;
  song: string;
  artist: string;
  charter: string;
  startTick: number;
  endTick: number;
  grooveStartTick: number;
  grooveEndTick: number;
  tempoBpm: number;
  lengthBars: number;
  subdivision: Subdivision;
  complexity: number;
  voicingTags: string[];
  /** Continuous difficulty in [0, 100] for ladder ordering. */
  difficultyScore: number;
  fingerprint: string;
  /** Canonical groove fingerprint of the fill's preceding-groove span. */
  grooveFingerprint: string;
  /** Groove similarity key (cymbal collapsed, coarse grid) for clustering. */
  grooveSimilarityKey: string;
  /** Cross-song fill similarity key (dynamics stripped) for library dedupe. */
  fillSimilarityKey: string;
  confidence: number;
  features: Record<string, unknown>;
};

export type AttemptInput = {
  fillId: string;
  mode: FillMode;
  tempoPct: number;
  score: number;
  judgments: unknown;
  /** Defaults to Date.now() when omitted. */
  ts?: number;
};

export type SrsInput = {
  fillId: string;
  state: SrsState;
  ease: number;
  intervalDays: number;
  dueAt: number;
  passStreak: number;
  /** Defaults to Date.now() when omitted. */
  updatedAt?: number;
};

/** A fill row joined with its SRS state (null when never practiced). */
export type FillWithSrs = {
  id: string;
  chartHash: string;
  libraryPath: string;
  song: string;
  artist: string;
  charter: string;
  startTick: number;
  endTick: number;
  grooveStartTick: number;
  grooveEndTick: number;
  tempoBpm: number;
  lengthBars: number;
  subdivision: Subdivision;
  complexity: number;
  voicingTags: string[];
  /** Continuous difficulty in [0, 100]; null on fills detected before migration 012. */
  difficultyScore: number | null;
  fingerprint: string;
  /** Canonical groove fingerprint; null on fills detected before migration 011. */
  grooveFingerprint: string | null;
  /** Groove similarity key; null on fills detected before migration 011. */
  grooveSimilarityKey: string | null;
  /** Cross-song fill similarity key; null on fills detected before migration 012. */
  fillSimilarityKey: string | null;
  confidence: number;
  features: Record<string, unknown>;
  createdAt: number;
  srs: {
    state: SrsState;
    ease: number;
    intervalDays: number;
    dueAt: number;
    passStreak: number;
    updatedAt: number;
  } | null;
};

export type FillFilters = {
  subdivision?: Subdivision[];
  /** Inclusive complexity range. */
  minComplexity?: number;
  maxComplexity?: number;
  /** Match fills whose voicing_tags include ALL of these tags. */
  voicingTags?: string[];
  lengthBars?: number[];
  state?: SrsState[];
  limit?: number;
};

function rowToFillWithSrs(row: any): FillWithSrs {
  return {
    id: row.id,
    chartHash: row.chart_hash,
    libraryPath: row.library_path,
    song: row.song,
    artist: row.artist,
    charter: row.charter,
    startTick: row.start_tick,
    endTick: row.end_tick,
    grooveStartTick: row.groove_start_tick,
    grooveEndTick: row.groove_end_tick,
    tempoBpm: row.tempo_bpm,
    lengthBars: row.length_bars,
    subdivision: row.subdivision as Subdivision,
    complexity: row.complexity,
    voicingTags: parseJson<string[]>(row.voicing_tags, []),
    difficultyScore: row.difficulty_score ?? null,
    fingerprint: row.fingerprint,
    grooveFingerprint: row.groove_fingerprint ?? null,
    grooveSimilarityKey: row.groove_similarity_key ?? null,
    fillSimilarityKey: row.fill_similarity_key ?? null,
    confidence: row.confidence,
    features: parseJson<Record<string, unknown>>(row.features, {}),
    createdAt: row.created_at,
    srs:
      row.srs_state == null
        ? null
        : {
            state: row.srs_state as SrsState,
            ease: row.srs_ease,
            intervalDays: row.srs_interval_days,
            dueAt: row.srs_due_at,
            passStreak: row.srs_pass_streak,
            updatedAt: row.srs_updated_at,
          },
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  // ParseJSONResultsPlugin may already have parsed it.
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Replace all of a song's fills with the supplied set. Keyed by chart_hash so a
 * rescan of one song doesn't disturb others. Deletes orphaned fills (cascades
 * to attempts/srs) then inserts the new set.
 */
export async function replaceFillsForSong(
  chartHash: string,
  fills: FillInput[],
  db?: Kysely<DB>,
): Promise<void> {
  const database = db ?? (await getDrumFillsDb());
  const createdAt = Date.now();

  await database.transaction().execute(async trx => {
    await trx.deleteFrom('fills').where('chart_hash', '=', chartHash).execute();

    if (fills.length === 0) return;

    const values = fills.map(f => ({
      id: f.id,
      chart_hash: f.chartHash,
      library_path: f.libraryPath,
      song: f.song,
      artist: f.artist,
      charter: f.charter,
      start_tick: f.startTick,
      end_tick: f.endTick,
      groove_start_tick: f.grooveStartTick,
      groove_end_tick: f.grooveEndTick,
      tempo_bpm: f.tempoBpm,
      length_bars: f.lengthBars,
      subdivision: f.subdivision,
      complexity: f.complexity,
      voicing_tags: JSON.stringify(f.voicingTags),
      difficulty_score: f.difficultyScore,
      fingerprint: f.fingerprint,
      groove_fingerprint: f.grooveFingerprint,
      groove_similarity_key: f.grooveSimilarityKey,
      fill_similarity_key: f.fillSimilarityKey,
      confidence: f.confidence,
      features: JSON.stringify(f.features),
      created_at: createdAt,
    }));

    await trx.insertInto('fills').values(values).execute();
  });
}

/**
 * Query fills with taxonomy filters, left-joined with their SRS state.
 */
export async function queryFills(
  filters: FillFilters = {},
  db?: Kysely<DB>,
): Promise<FillWithSrs[]> {
  const database = db ?? (await getDrumFillsDb());

  let query = database
    .selectFrom('fills')
    .leftJoin('fill_srs', 'fill_srs.fill_id', 'fills.id')
    .select([
      'fills.id as id',
      'fills.chart_hash as chart_hash',
      'fills.library_path as library_path',
      'fills.song as song',
      'fills.artist as artist',
      'fills.charter as charter',
      'fills.start_tick as start_tick',
      'fills.end_tick as end_tick',
      'fills.groove_start_tick as groove_start_tick',
      'fills.groove_end_tick as groove_end_tick',
      'fills.tempo_bpm as tempo_bpm',
      'fills.length_bars as length_bars',
      'fills.subdivision as subdivision',
      'fills.complexity as complexity',
      'fills.voicing_tags as voicing_tags',
      'fills.difficulty_score as difficulty_score',
      'fills.fingerprint as fingerprint',
      'fills.groove_fingerprint as groove_fingerprint',
      'fills.groove_similarity_key as groove_similarity_key',
      'fills.fill_similarity_key as fill_similarity_key',
      'fills.confidence as confidence',
      'fills.features as features',
      'fills.created_at as created_at',
      'fill_srs.state as srs_state',
      'fill_srs.ease as srs_ease',
      'fill_srs.interval_days as srs_interval_days',
      'fill_srs.due_at as srs_due_at',
      'fill_srs.pass_streak as srs_pass_streak',
      'fill_srs.updated_at as srs_updated_at',
    ]);

  if (filters.subdivision && filters.subdivision.length > 0) {
    query = query.where('fills.subdivision', 'in', filters.subdivision);
  }
  if (filters.minComplexity != null) {
    query = query.where('fills.complexity', '>=', filters.minComplexity);
  }
  if (filters.maxComplexity != null) {
    query = query.where('fills.complexity', '<=', filters.maxComplexity);
  }
  if (filters.lengthBars && filters.lengthBars.length > 0) {
    query = query.where('fills.length_bars', 'in', filters.lengthBars);
  }
  if (filters.state && filters.state.length > 0) {
    query = query.where('fill_srs.state', 'in', filters.state);
  }
  if (filters.limit != null) {
    query = query.limit(filters.limit);
  }

  const rows = await query.execute();

  let result = rows.map(rowToFillWithSrs);

  // voicing_tags is a JSON array; filter in JS (SQLite can't index into it
  // portably without json1 extension queries). Requires ALL tags present.
  if (filters.voicingTags && filters.voicingTags.length > 0) {
    const required = filters.voicingTags;
    result = result.filter(f =>
      required.every(tag => f.voicingTags.includes(tag)),
    );
  }

  return result;
}

export async function getFillById(
  id: string,
  db?: Kysely<DB>,
): Promise<FillWithSrs | null> {
  const database = db ?? (await getDrumFillsDb());
  const rows = await queryFillsRaw(database, eb =>
    eb.where('fills.id', '=', id),
  );
  return rows.length > 0 ? rowToFillWithSrs(rows[0]) : null;
}

/**
 * Fetch a set of fills by id (with SRS join), returned in the same order as
 * `ids`. Ids with no matching row are dropped. Used by groove sessions to load
 * the fills of one cluster.
 */
export async function getFillsByIds(
  ids: string[],
  db?: Kysely<DB>,
): Promise<FillWithSrs[]> {
  if (ids.length === 0) return [];
  const database = db ?? (await getDrumFillsDb());
  const rows = await queryFillsRaw(database, qb =>
    qb.where('fills.id', 'in', ids),
  );
  const byId = new Map(rows.map(r => [r.id, rowToFillWithSrs(r)]));
  return ids.map(id => byId.get(id)).filter((f): f is FillWithSrs => f != null);
}

/**
 * All fill instances sharing a `fill_similarity_key` (the same unique pattern
 * across songs), ordered by tempo ascending. Powers the instance switcher inside
 * PracticeView when practicing a grouped card. Returns just the one fill when no
 * key (pre-migration) so callers always get at least the requested instance.
 */
export async function getFillSiblings(
  fillSimilarityKey: string,
  db?: Kysely<DB>,
): Promise<FillWithSrs[]> {
  if (!fillSimilarityKey) return [];
  const database = db ?? (await getDrumFillsDb());
  const rows = await queryFillsRaw(database, qb =>
    qb.where('fills.fill_similarity_key', '=', fillSimilarityKey),
  );
  return rows
    .map(rowToFillWithSrs)
    .sort((a, b) => a.tempoBpm - b.tempoBpm || (a.id < b.id ? -1 : 1));
}

// Shared select used by getFillById and the due/today queries.
async function queryFillsRaw(
  database: Kysely<DB>,
  apply: (qb: any) => any,
): Promise<any[]> {
  const base = database
    .selectFrom('fills')
    .leftJoin('fill_srs', 'fill_srs.fill_id', 'fills.id')
    .select([
      'fills.id as id',
      'fills.chart_hash as chart_hash',
      'fills.library_path as library_path',
      'fills.song as song',
      'fills.artist as artist',
      'fills.charter as charter',
      'fills.start_tick as start_tick',
      'fills.end_tick as end_tick',
      'fills.groove_start_tick as groove_start_tick',
      'fills.groove_end_tick as groove_end_tick',
      'fills.tempo_bpm as tempo_bpm',
      'fills.length_bars as length_bars',
      'fills.subdivision as subdivision',
      'fills.complexity as complexity',
      'fills.voicing_tags as voicing_tags',
      'fills.difficulty_score as difficulty_score',
      'fills.fingerprint as fingerprint',
      'fills.groove_fingerprint as groove_fingerprint',
      'fills.groove_similarity_key as groove_similarity_key',
      'fills.fill_similarity_key as fill_similarity_key',
      'fills.confidence as confidence',
      'fills.features as features',
      'fills.created_at as created_at',
      'fill_srs.state as srs_state',
      'fill_srs.ease as srs_ease',
      'fill_srs.interval_days as srs_interval_days',
      'fill_srs.due_at as srs_due_at',
      'fill_srs.pass_streak as srs_pass_streak',
      'fill_srs.updated_at as srs_updated_at',
    ]);
  return apply(base).execute();
}

/**
 * Per-fill attempt counts and last-attempt timestamps across the whole library,
 * keyed by fill id. One grouped query (cheaper than N per-card queries) used to
 * annotate library cards with practice history. Fills with no attempts are
 * simply absent from the map.
 */
export async function getAttemptStats(
  db?: Kysely<DB>,
): Promise<Map<string, {count: number; lastTs: number}>> {
  const database = db ?? (await getDrumFillsDb());
  const rows = await database
    .selectFrom('fill_attempts')
    .select(eb => [
      'fill_id',
      eb.fn.countAll<number>().as('count'),
      eb.fn.max('ts').as('last_ts'),
    ])
    .groupBy('fill_id')
    .execute();

  const map = new Map<string, {count: number; lastTs: number}>();
  for (const r of rows) {
    map.set(r.fill_id, {count: Number(r.count), lastTs: Number(r.last_ts)});
  }
  return map;
}

/** Record a single practice attempt. Returns the new attempt's row id. */
export async function recordAttempt(
  attempt: AttemptInput,
  db?: Kysely<DB>,
): Promise<number> {
  const database = db ?? (await getDrumFillsDb());
  const result = await database
    .insertInto('fill_attempts')
    .values({
      fill_id: attempt.fillId,
      ts: attempt.ts ?? Date.now(),
      mode: attempt.mode,
      tempo_pct: attempt.tempoPct,
      score: attempt.score,
      judgments: JSON.stringify(attempt.judgments),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(result.id);
}

/** A single recorded judgment as persisted in a fill_attempts row. */
export type StoredJudgment = {
  id: string | number;
  judgment: 'perfect' | 'good' | 'miss';
  deltaMs: number | null;
};

/** The best recorded attempt for a fill, with its judgments. */
export type FillBest = {
  /** Attempt score on the 0–100 scale. */
  score: number;
  /** Mode the best attempt was recorded in. */
  mode: FillMode;
  /** Tempo percentage of the best attempt. */
  tempoPct: number;
  /** Timestamp (ms) the best attempt was recorded. */
  ts: number;
  /** Per-note judgments of the best attempt. */
  judgments: StoredJudgment[];
};

/**
 * The best recorded attempt for a fill: highest `score`, breaking ties toward
 * the most recent (so a fresh equal-best re-marks the stave). Returns null when
 * the fill has never been attempted. Used to seed + persist the HUD's "best"
 * readout across reloads.
 */
export async function getFillBest(
  fillId: string,
  db?: Kysely<DB>,
): Promise<FillBest | null> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('fill_attempts')
    .select(['score', 'mode', 'tempo_pct', 'ts', 'judgments'])
    .where('fill_id', '=', fillId)
    .orderBy('score', 'desc')
    .orderBy('ts', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row) return null;
  return {
    score: row.score,
    mode: row.mode as FillMode,
    tempoPct: row.tempo_pct,
    ts: row.ts,
    judgments: parseJson<StoredJudgment[]>(row.judgments, []),
  };
}

/** Insert or replace the SRS row for a fill. */
export async function upsertSrs(srs: SrsInput, db?: Kysely<DB>): Promise<void> {
  const database = db ?? (await getDrumFillsDb());
  const updatedAt = srs.updatedAt ?? Date.now();
  await database
    .insertInto('fill_srs')
    .values({
      fill_id: srs.fillId,
      state: srs.state,
      ease: srs.ease,
      interval_days: srs.intervalDays,
      due_at: srs.dueAt,
      pass_streak: srs.passStreak,
      updated_at: updatedAt,
    })
    .onConflict(oc =>
      oc.column('fill_id').doUpdateSet(eb => ({
        state: eb.ref('excluded.state'),
        ease: eb.ref('excluded.ease'),
        interval_days: eb.ref('excluded.interval_days'),
        due_at: eb.ref('excluded.due_at'),
        pass_streak: eb.ref('excluded.pass_streak'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

/**
 * Fills whose SRS review is due at or before `now` (default Date.now()),
 * soonest-due first. Only mastered/learning fills have SRS rows.
 */
export async function getDueFills(
  now: number = Date.now(),
  limit?: number,
  db?: Kysely<DB>,
): Promise<FillWithSrs[]> {
  const database = db ?? (await getDrumFillsDb());
  const rows = await queryFillsRaw(database, qb => {
    let q = qb
      .where('fill_srs.due_at', '<=', now)
      .orderBy('fill_srs.due_at', 'asc');
    if (limit != null) q = q.limit(limit);
    return q;
  });
  return rows.map(rowToFillWithSrs);
}

/**
 * The "Today" queue: due reviews first (soonest-due), then new fills (no SRS
 * row) for variety, up to `limit` total.
 */
export async function getTodayQueue(
  now: number = Date.now(),
  limit = 20,
  db?: Kysely<DB>,
): Promise<FillWithSrs[]> {
  const database = db ?? (await getDrumFillsDb());

  const due = await getDueFills(now, limit, database);
  if (due.length >= limit) return due.slice(0, limit);

  const remaining = limit - due.length;
  const newRows = await queryFillsRaw(database, qb =>
    qb.where('fill_srs.fill_id', 'is', null).limit(remaining),
  );

  return [...due, ...newRows.map(rowToFillWithSrs)];
}

// --- Groove clusters --------------------------------------------------------

/**
 * Whether any fills still lack a groove fingerprint (detected before migration
 * 011, or before the groove-aware scan). Drives the "rescan to enable Grooves"
 * hint. Returns false when there are no fills at all (nothing to enable).
 */
export async function hasFillsNeedingGrooveRescan(
  db?: Kysely<DB>,
): Promise<boolean> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('fills')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .where('groove_fingerprint', 'is', null)
    .executeTakeFirst();
  return (row ? Number(row.n) : 0) > 0;
}

/**
 * Whether any fills still lack the migration-012 columns (fill similarity key /
 * difficulty score), i.e. were detected before cross-song dedupe + the
 * continuous difficulty score shipped. Drives the "rescan" hint for the grouped
 * library + ladder. Returns false when there are no fills at all.
 */
export async function hasFillsNeedingRescan(db?: Kysely<DB>): Promise<boolean> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('fills')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .where(eb =>
      eb.or([
        eb('fill_similarity_key', 'is', null),
        eb('difficulty_score', 'is', null),
      ]),
    )
    .executeTakeFirst();
  return (row ? Number(row.n) : 0) > 0;
}

// --- Grouped library (cross-song dedupe) ------------------------------------

/**
 * One row of the grouped library: all fills sharing a `fill_similarity_key`
 * collapsed into a single unique-pattern entry. The representative fill is the
 * one a "practice this pattern" action opens by default.
 */
export type GroupedFill = {
  /** The shared fill similarity key (group identity). */
  fillSimilarityKey: string;
  /** Representative fill instance (prefers higher confidence, then lower tempo). */
  representative: FillWithSrs;
  /** Total fill instances in the group (the "in N songs" badge basis). */
  instanceCount: number;
  /** Distinct songs (by chart hash) the pattern appears in. */
  distinctSongs: number;
  /** Distinct song titles, for the expandable instance list. */
  songs: string[];
  tempoMin: number;
  tempoMedian: number;
  tempoMax: number;
  /** Representative difficulty score (null if pre-migration). */
  difficultyScore: number | null;
  /**
   * Aggregated mastery for the whole pattern-group (SRS applies per pattern,
   * plan §5): 'mastered' only when every practiced instance is mastered,
   * 'learning' when any instance is learning/mastered, else 'new'.
   */
  state: SrsState;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Group the whole library by `fill_similarity_key` (cross-song dedupe). Returns
 * one `GroupedFill` per unique pattern, sorted by instance count descending
 * then difficulty ascending. Fills with a NULL key (pre-migration) are skipped.
 *
 * Filters reuse `queryFills`; grouping/aggregation is done in JS because SQLite
 * can't pick a representative row + aggregate SRS state in one portable query.
 */
export async function getGroupedLibrary(
  filters: FillFilters = {},
  db?: Kysely<DB>,
): Promise<GroupedFill[]> {
  const database = db ?? (await getDrumFillsDb());
  // queryFills applies taxonomy/state filters and the SRS join for us.
  const fills = await queryFills({...filters, limit: undefined}, database);

  const byKey = new Map<string, FillWithSrs[]>();
  for (const f of fills) {
    if (!f.fillSimilarityKey) continue;
    const list = byKey.get(f.fillSimilarityKey);
    if (list) list.push(f);
    else byKey.set(f.fillSimilarityKey, [f]);
  }

  const groups: GroupedFill[] = [];
  for (const [key, members] of byKey) {
    // Representative: highest confidence, then lowest tempo, then id for
    // determinism.
    const representative = [...members].sort(
      (a, b) =>
        b.confidence - a.confidence ||
        a.tempoBpm - b.tempoBpm ||
        (a.id < b.id ? -1 : 1),
    )[0];

    const tempos = members.map(m => m.tempoBpm);
    const songSet = new Set(members.map(m => m.chartHash));
    const songTitles = [...new Set(members.map(m => m.song))].sort();

    // Aggregate SRS state across the group.
    let anyLearningOrMastered = false;
    let allMastered = true;
    let anyPracticed = false;
    for (const m of members) {
      if (m.srs) {
        anyPracticed = true;
        if (m.srs.state === 'mastered' || m.srs.state === 'learning') {
          anyLearningOrMastered = true;
        }
        if (m.srs.state !== 'mastered') allMastered = false;
      } else {
        allMastered = false;
      }
    }
    const state: SrsState =
      anyPracticed && allMastered
        ? 'mastered'
        : anyLearningOrMastered
          ? 'learning'
          : 'new';

    groups.push({
      fillSimilarityKey: key,
      representative,
      instanceCount: members.length,
      distinctSongs: songSet.size,
      songs: songTitles,
      tempoMin: Math.min(...tempos),
      tempoMedian: median(tempos),
      tempoMax: Math.max(...tempos),
      difficultyScore: representative.difficultyScore,
      state,
    });
  }

  groups.sort(
    (a, b) =>
      b.instanceCount - a.instanceCount ||
      (a.difficultyScore ?? 0) - (b.difficultyScore ?? 0) ||
      (a.fillSimilarityKey < b.fillSimilarityKey ? -1 : 1),
  );
  return groups;
}

// --- Groove fill ladder -----------------------------------------------------

/**
 * One rung of a groove's difficulty ladder: a unique fill pattern (deduped by
 * fill similarity key) within the cluster, with its representative instance.
 */
export type LadderRung = {
  fillSimilarityKey: string;
  representative: FillWithSrs;
  difficultyScore: number;
  instanceCount: number;
  /** Aggregated mastery across the pattern's instances (see getGroupedLibrary). */
  state: SrsState;
};

/**
 * Build a groove cluster's fill ladder: every fill whose groove matches
 * `grooveSimilarityKey`, deduped by fill similarity key (one rung per unique
 * pattern, plan §6), ordered by difficulty score ascending so the user climbs
 * from simple to complex.
 */
export async function getGrooveLadder(
  grooveSimilarityKey: string,
  db?: Kysely<DB>,
): Promise<LadderRung[]> {
  const database = db ?? (await getDrumFillsDb());
  const rows = await queryFillsRaw(database, qb =>
    qb.where('fills.groove_similarity_key', '=', grooveSimilarityKey),
  );
  const fills = rows.map(rowToFillWithSrs);

  const byKey = new Map<string, FillWithSrs[]>();
  for (const f of fills) {
    const key = f.fillSimilarityKey;
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }

  const rungs: LadderRung[] = [];
  for (const [key, members] of byKey) {
    const representative = [...members].sort(
      (a, b) =>
        b.confidence - a.confidence ||
        a.tempoBpm - b.tempoBpm ||
        (a.id < b.id ? -1 : 1),
    )[0];

    let anyLearningOrMastered = false;
    let allMastered = true;
    let anyPracticed = false;
    for (const m of members) {
      if (m.srs) {
        anyPracticed = true;
        if (m.srs.state === 'mastered' || m.srs.state === 'learning') {
          anyLearningOrMastered = true;
        }
        if (m.srs.state !== 'mastered') allMastered = false;
      } else {
        allMastered = false;
      }
    }
    const state: SrsState =
      anyPracticed && allMastered
        ? 'mastered'
        : anyLearningOrMastered
          ? 'learning'
          : 'new';

    rungs.push({
      fillSimilarityKey: key,
      representative,
      difficultyScore: representative.difficultyScore ?? 0,
      instanceCount: members.length,
      state,
    });
  }

  rungs.sort(
    (a, b) =>
      a.difficultyScore - b.difficultyScore ||
      (a.fillSimilarityKey < b.fillSimilarityKey ? -1 : 1),
  );
  return rungs;
}

/** Per-groove ladder progress (current rung position). */
export type LadderProgress = {
  grooveSimilarityKey: string;
  currentRungFillId: string | null;
  updatedAt: number;
};

/** Read a groove's saved ladder progress, or null if none recorded yet. */
export async function getLadderProgress(
  grooveSimilarityKey: string,
  db?: Kysely<DB>,
): Promise<LadderProgress | null> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('groove_ladder_progress')
    .selectAll()
    .where('groove_similarity_key', '=', grooveSimilarityKey)
    .executeTakeFirst();
  if (!row) return null;
  return {
    grooveSimilarityKey: row.groove_similarity_key,
    currentRungFillId: row.current_rung_fill_id ?? null,
    updatedAt: row.updated_at,
  };
}

/** Insert or update a groove's ladder progress (current rung). */
export async function setLadderProgress(
  progress: {
    grooveSimilarityKey: string;
    currentRungFillId: string | null;
    updatedAt?: number;
  },
  db?: Kysely<DB>,
): Promise<void> {
  const database = db ?? (await getDrumFillsDb());
  const updatedAt = progress.updatedAt ?? Date.now();
  await database
    .insertInto('groove_ladder_progress')
    .values({
      groove_similarity_key: progress.grooveSimilarityKey,
      current_rung_fill_id: progress.currentRungFillId,
      updated_at: updatedAt,
    })
    .onConflict(oc =>
      oc.column('groove_similarity_key').doUpdateSet(eb => ({
        current_rung_fill_id: eb.ref('excluded.current_rung_fill_id'),
        updated_at: eb.ref('excluded.updated_at'),
      })),
    )
    .execute();
}

/**
 * Build groove clusters across the whole library: fills grouped by their
 * groove similarity key, each summarized with fill count, ids, tempo range,
 * distinct songs, and taxonomy spread, sorted by fill count descending.
 *
 * Fills with a NULL similarity key (pre-migration) are skipped. Clustering math
 * lives in `lib/drum-fills/grooveClusters` (pure, unit-tested); this only feeds
 * it the minimal projected rows.
 */
export async function getGrooveClusters(
  db?: Kysely<DB>,
): Promise<GrooveCluster[]> {
  const database = db ?? (await getDrumFillsDb());
  const rows = await database
    .selectFrom('fills')
    .select([
      'id',
      'groove_fingerprint',
      'groove_similarity_key',
      'chart_hash',
      'song',
      'artist',
      'tempo_bpm',
      'subdivision',
      'complexity',
      'length_bars',
    ])
    .where('groove_similarity_key', 'is not', null)
    .execute();

  const inputs: GrooveClusterInput[] = rows.map(r => ({
    id: r.id,
    grooveFingerprint: r.groove_fingerprint,
    grooveSimilarityKey: r.groove_similarity_key,
    chartHash: r.chart_hash,
    song: r.song,
    artist: r.artist,
    tempoBpm: r.tempo_bpm,
    subdivision: r.subdivision,
    complexity: r.complexity,
    lengthBars: r.length_bars,
  }));

  return buildGrooveClusters(inputs);
}

// --- Scan run bookkeeping ---------------------------------------------------

export async function startScanRun(
  startedAt: number = Date.now(),
  db?: Kysely<DB>,
): Promise<number> {
  const database = db ?? (await getDrumFillsDb());
  const result = await database
    .insertInto('scan_runs')
    .values({started_at: startedAt})
    .returning('id')
    .executeTakeFirstOrThrow();
  return Number(result.id);
}

export async function finishScanRun(
  id: number,
  stats: {songsScanned: number; fillsFound: number; finishedAt?: number},
  db?: Kysely<DB>,
): Promise<void> {
  const database = db ?? (await getDrumFillsDb());
  await database
    .updateTable('scan_runs')
    .set({
      finished_at: stats.finishedAt ?? Date.now(),
      songs_scanned: stats.songsScanned,
      fills_found: stats.fillsFound,
    })
    .where('id', '=', id)
    .execute();
}

export async function getLatestScanRun(
  db?: Kysely<DB>,
): Promise<ScanRun | null> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('scan_runs')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

// --- Progress surface (plan §7) ---------------------------------------------

/** Total fill rows in the DB — drives the first-run / has-data home gate. */
export async function getFillCount(db?: Kysely<DB>): Promise<number> {
  const database = db ?? (await getDrumFillsDb());
  const row = await database
    .selectFrom('fills')
    .select(eb => eb.fn.countAll<number>().as('n'))
    .executeTakeFirst();
  return row ? Number(row.n) : 0;
}

/**
 * Aggregate learning-arc counters for the practice-first home (plan §7): one
 * place that shows grooves started, rungs climbed, fills mastered, and reviews
 * due. All counts are derived read-side; nothing is materialized.
 *
 * - groovesStarted: groove clusters with saved ladder progress.
 * - rungsClimbed: total rungs cleared across started ladders — the index of the
 *   saved rung in each ladder (rung 1 = index 0 = zero climbed). A groove parked
 *   on rung 5 contributes 4.
 * - fillsMastered: distinct fill patterns (fill_similarity_key) every instance of
 *   which is mastered — the same per-pattern mastery the grouped library shows.
 * - dueNow: fills with an SRS review due at or before `now`.
 * - totalGrooves: drillable groove clusters (≥2 fills), for "started X of Y".
 */
export type ProgressSummary = {
  groovesStarted: number;
  totalGrooves: number;
  rungsClimbed: number;
  fillsMastered: number;
  dueNow: number;
};

export async function getProgressSummary(
  now: number = Date.now(),
  db?: Kysely<DB>,
): Promise<ProgressSummary> {
  const database = db ?? (await getDrumFillsDb());

  const [clusters, ladderRows, dueRow, masteredRows] = await Promise.all([
    getGrooveClusters(database),
    database.selectFrom('groove_ladder_progress').selectAll().execute(),
    database
      .selectFrom('fill_srs')
      .select(eb => eb.fn.countAll<number>().as('n'))
      .where('due_at', '<=', now)
      .executeTakeFirst(),
    // Per-pattern mastery: a pattern counts as mastered only when it has ≥1
    // instance and every instance with an SRS row is mastered and no instance
    // is unpracticed. Pull the minimal projection and fold in JS (SQLite can't
    // express "all members mastered" portably).
    database
      .selectFrom('fills')
      .leftJoin('fill_srs', 'fill_srs.fill_id', 'fills.id')
      .select(['fills.fill_similarity_key as key', 'fill_srs.state as state'])
      .where('fills.fill_similarity_key', 'is not', null)
      .execute(),
  ]);

  const drillable = clusters.filter(c => c.fillCount >= 2);

  // rungsClimbed: resolve each saved rung to its index in its ladder.
  let rungsClimbed = 0;
  let groovesStarted = 0;
  for (const row of ladderRows) {
    const ladder = await getGrooveLadder(row.groove_similarity_key, database);
    if (ladder.length === 0) continue;
    groovesStarted += 1;
    const idx = ladder.findIndex(
      r => r.fillSimilarityKey === row.current_rung_fill_id,
    );
    rungsClimbed += idx > 0 ? idx : 0;
  }

  // Per-pattern mastery fold.
  const byPattern = new Map<string, {all: boolean; any: boolean}>();
  for (const r of masteredRows) {
    if (!r.key) continue;
    const entry = byPattern.get(r.key) ?? {all: true, any: false};
    entry.any = true;
    if (r.state !== 'mastered') entry.all = false;
    byPattern.set(r.key, entry);
  }
  let fillsMastered = 0;
  for (const v of byPattern.values()) {
    if (v.any && v.all) fillsMastered += 1;
  }

  return {
    groovesStarted,
    totalGrooves: drillable.length,
    rungsClimbed,
    fillsMastered,
    dueNow: dueRow ? Number(dueRow.n) : 0,
  };
}

/**
 * Groove clusters with saved ladder progress, newest-touched first, for the
 * "Continue climbing" home section (plan §7). Each carries the cluster (for the
 * resume card sketch/counts) plus the current rung index and ladder length so
 * the card can render "Rung k of N" without a second round-trip.
 */
export type ActiveLadder = {
  cluster: GrooveCluster;
  rungIndex: number;
  rungCount: number;
  updatedAt: number;
};

export async function getActiveLadders(
  limit = 6,
  db?: Kysely<DB>,
): Promise<ActiveLadder[]> {
  const database = db ?? (await getDrumFillsDb());
  const [progressRows, clusters] = await Promise.all([
    database
      .selectFrom('groove_ladder_progress')
      .selectAll()
      .orderBy('updated_at', 'desc')
      .execute(),
    getGrooveClusters(database),
  ]);

  const byKey = new Map(clusters.map(c => [c.similarityKey, c]));
  const out: ActiveLadder[] = [];
  for (const row of progressRows) {
    const cluster = byKey.get(row.groove_similarity_key);
    if (!cluster) continue;
    const ladder = await getGrooveLadder(row.groove_similarity_key, database);
    if (ladder.length === 0) continue;
    const idx = ladder.findIndex(
      r => r.fillSimilarityKey === row.current_rung_fill_id,
    );
    out.push({
      cluster,
      rungIndex: idx >= 0 ? idx : 0,
      rungCount: ladder.length,
      updatedAt: row.updated_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}
