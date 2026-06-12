import {Kysely, Selectable} from 'kysely';
import {getLocalDb} from '../client';
import type {DB, ScanRuns} from '../types';

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
  fingerprint: string;
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
  fingerprint: string;
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
    fingerprint: row.fingerprint,
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
  const database = db ?? (await getLocalDb());
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
      fingerprint: f.fingerprint,
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
  const database = db ?? (await getLocalDb());

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
      'fills.fingerprint as fingerprint',
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
  const database = db ?? (await getLocalDb());
  const rows = await queryFillsRaw(database, eb =>
    eb.where('fills.id', '=', id),
  );
  return rows.length > 0 ? rowToFillWithSrs(rows[0]) : null;
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
      'fills.fingerprint as fingerprint',
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

/** Record a single practice attempt. Returns the new attempt's row id. */
export async function recordAttempt(
  attempt: AttemptInput,
  db?: Kysely<DB>,
): Promise<number> {
  const database = db ?? (await getLocalDb());
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

/** Insert or replace the SRS row for a fill. */
export async function upsertSrs(srs: SrsInput, db?: Kysely<DB>): Promise<void> {
  const database = db ?? (await getLocalDb());
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
  const database = db ?? (await getLocalDb());
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
  const database = db ?? (await getLocalDb());

  const due = await getDueFills(now, limit, database);
  if (due.length >= limit) return due.slice(0, limit);

  const remaining = limit - due.length;
  const newRows = await queryFillsRaw(database, qb =>
    qb.where('fill_srs.fill_id', 'is', null).limit(remaining),
  );

  return [...due, ...newRows.map(rowToFillWithSrs)];
}

// --- Scan run bookkeeping ---------------------------------------------------

export async function startScanRun(
  startedAt: number = Date.now(),
  db?: Kysely<DB>,
): Promise<number> {
  const database = db ?? (await getLocalDb());
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
  const database = db ?? (await getLocalDb());
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
  const database = db ?? (await getLocalDb());
  const row = await database
    .selectFrom('scan_runs')
    .selectAll()
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}
