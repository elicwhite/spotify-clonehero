/**
 * Glue between the MIDI hit matcher and the attempt scorer.
 *
 * `matchHits` (lib/drum-fills/midi/hitMatcher.ts) returns per-expected-note
 * judgments + extras in its own shape; `scoreAttempt` (./scoring.ts) consumes a
 * structurally different {@link AttemptJudgments}. This module converts one to
 * the other and runs a full attempt in one call, keeping that mapping in a pure,
 * tested place rather than inline in the practice React component.
 */

import {
  matchHits,
  type ExpectedNote,
  type TimedHit,
  type TimingWindows,
  DEFAULT_WINDOWS,
  type MatchResult,
} from '@/lib/drum-fills/midi/hitMatcher';
import {
  scoreAttempt,
  type AttemptJudgments,
  type AttemptScore,
  type ScoringOptions,
} from './scoring';

/**
 * Whether a loop pass counts as a real attempt: the player hit at least one drum
 * during it. Idle passes — no input at all, e.g. a water break or not yet
 * playing — are ignored entirely (not scored, not persisted, no ladder/SRS
 * movement) so they never register as a pass or a fail. Fills with no notes
 * never count.
 */
export function isRealAttempt(hitCount: number, noteCount: number): boolean {
  return noteCount > 0 && hitCount > 0;
}

/**
 * Whether a hit (loop-relative ms, 0 = the fill's first note) falls inside the
 * fill's playable span: within one timing window of the first or last note.
 * Hits outside it aren't part of the fill and must not be scored as extras —
 * most commonly the kick + crash a player lands on the downbeat *after* the
 * fill resolves.
 */
export function isHitWithinFill(
  msTime: number,
  lastNoteMs: number,
  windowMs: number,
): boolean {
  return msTime >= -windowMs && msTime <= lastNoteMs + windowMs;
}

/** Convert a matcher result into the scorer's input shape. */
export function matchResultToJudgments(result: MatchResult): AttemptJudgments {
  return {
    notes: result.judgments.map(j => ({
      quality: j.judgment,
      timingErrorMs: j.deltaMs ?? undefined,
    })),
    extraHits: result.extras.map(e => ({
      lane: e.hit.lane,
      timeMs: e.hit.msTime,
    })),
  };
}

export interface ScoredAttempt {
  match: MatchResult;
  score: AttemptScore;
}

/**
 * A compact best-attempt summary for the HUD + the sheet-music overlay. Derived
 * either from a freshly scored {@link ScoredAttempt} or seeded from a persisted
 * `fill_attempts` row (which stores per-note judgments but not extras).
 */
export interface BestAttempt {
  score: number;
  perfect: number;
  good: number;
  miss: number;
  /** Extra hits; null when seeded from history (not persisted per-attempt). */
  extra: number | null;
  /** Per-note judgments keyed by fill-note id, for the stave overlay. */
  judgments: Map<
    string,
    {judgment: 'perfect' | 'good' | 'miss'; deltaMs: number | null}
  >;
}

/** Build a {@link BestAttempt} summary from a freshly scored attempt. */
export function bestFromScored(result: ScoredAttempt): BestAttempt {
  const judgments = new Map<
    string,
    {judgment: 'perfect' | 'good' | 'miss'; deltaMs: number | null}
  >();
  for (const j of result.match.judgments) {
    judgments.set(String(j.note.id), {
      judgment: j.judgment,
      deltaMs: j.deltaMs,
    });
  }
  return {
    score: result.score.score,
    perfect: result.score.perfect,
    good: result.score.good,
    miss: result.score.miss,
    extra: result.score.extraHits,
    judgments,
  };
}

/**
 * Build a {@link BestAttempt} from persisted judgments (a `fill_attempts` row).
 * Counts are recomputed from the stored per-note judgments; extras are unknown.
 */
export function bestFromStored(
  score: number,
  stored: {
    id: string | number;
    judgment: 'perfect' | 'good' | 'miss';
    deltaMs: number | null;
  }[],
): BestAttempt {
  const judgments = new Map<
    string,
    {judgment: 'perfect' | 'good' | 'miss'; deltaMs: number | null}
  >();
  let perfect = 0;
  let good = 0;
  let miss = 0;
  for (const j of stored) {
    judgments.set(String(j.id), {judgment: j.judgment, deltaMs: j.deltaMs});
    if (j.judgment === 'perfect') perfect++;
    else if (j.judgment === 'good') good++;
    else miss++;
  }
  return {score, perfect, good, miss, extra: null, judgments};
}

/**
 * Whether `candidate` should replace `current` as the best attempt: a higher or
 * equal score wins, so a fresh equal-best re-marks the stave with the latest
 * pass. When `current` is null, any candidate is the new best. (The persisted
 * tie-break toward the most recent row lives in `getFillBest`.)
 */
export function isNewBest(
  current: BestAttempt | null,
  candidateScore: number,
): boolean {
  if (!current) return true;
  return candidateScore >= current.score;
}

/**
 * Run one practice attempt: match the player's hits against the expected notes
 * and score the result. `hits` must already be calibration-corrected and in the
 * same clock domain as the notes.
 */
export function evaluateAttempt(
  notes: ExpectedNote[],
  hits: TimedHit[],
  options: {
    windows?: TimingWindows;
    scoring?: Partial<ScoringOptions>;
  } = {},
): ScoredAttempt {
  const match = matchHits(notes, hits, options.windows ?? DEFAULT_WINDOWS);
  const score = scoreAttempt(matchResultToJudgments(match), options.scoring);
  return {match, score};
}
