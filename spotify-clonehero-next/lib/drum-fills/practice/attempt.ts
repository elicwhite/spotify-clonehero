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
