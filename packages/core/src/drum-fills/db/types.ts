import type {ColumnType} from 'kysely';

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;

export interface Fills {
  id: string;
  chart_hash: string;
  library_path: string;
  song: string;
  artist: string;
  charter: string;
  start_tick: number;
  end_tick: number;
  groove_start_tick: number;
  groove_end_tick: number;
  tempo_bpm: number;
  length_bars: number;
  subdivision: string;
  complexity: number;
  voicing_tags: string;
  fingerprint: string;
  confidence: number;
  features: string;
  created_at: number;
  groove_fingerprint: string | null;
  groove_similarity_key: string | null;
  fill_similarity_key: string | null;
  difficulty_score: number | null;
}

export interface GrooveLadderProgress {
  groove_similarity_key: string;
  current_rung_fill_id: string | null;
  updated_at: number;
}

export interface FillAttempts {
  id: Generated<number>;
  fill_id: string;
  ts: number;
  mode: string;
  tempo_pct: number;
  score: number;
  judgments: string;
}

export interface FillSrs {
  fill_id: string;
  state: string;
  ease: number;
  interval_days: number;
  due_at: number;
  pass_streak: number;
  updated_at: number;
}

export interface ScanRuns {
  id: Generated<number>;
  started_at: number;
  finished_at: number | null;
  songs_scanned: Generated<number>;
  fills_found: Generated<number>;
}

export interface DB {
  fill_attempts: FillAttempts;
  fill_srs: FillSrs;
  fills: Fills;
  groove_ladder_progress: GrooveLadderProgress;
  scan_runs: ScanRuns;
}
