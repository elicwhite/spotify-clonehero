/**
 * Attempt scoring for drum-fill practice.
 *
 * Converts the per-note judgments produced by the MIDI hit matcher into a single
 * attempt score on a 0–100 scale. An attempt passes when its score is ≥ the pass
 * threshold (90 by default).
 *
 * The {@link AttemptJudgments} input type is defined here so this module can be
 * unit-tested in isolation. It is intentionally structurally compatible with the
 * output shape of `lib/drum-fills/midi/hitMatcher.ts` (per-expected-note judgments
 * plus a list of extra/unmatched hits), so the two integrate without adapters once
 * the matcher exists.
 */

/** Quality bucket assigned to a single expected note by the hit matcher. */
export type JudgmentQuality = 'perfect' | 'good' | 'miss';

/**
 * Judgment for a single expected note in the fill.
 * `timingErrorMs` is the signed offset of the matched hit from the expected time
 * (negative = early, positive = late); absent for misses.
 */
export type NoteJudgment = {
  quality: JudgmentQuality;
  /** Signed timing error in milliseconds, when the note was hit. */
  timingErrorMs?: number | undefined;
};

/**
 * A hit that did not match any expected note (e.g. wrong pad, or an entirely
 * extra strike). Each one applies an accuracy penalty.
 */
export type ExtraHit = {
  /** Lane/identity of the extra hit; not used for scoring, kept for feedback. */
  lane?: string;
  timeMs?: number;
};

/**
 * Full set of judgments for one attempt (one loop pass over the fill span).
 * Structurally compatible with the hit matcher's output.
 */
export type AttemptJudgments = {
  notes: NoteJudgment[];
  extraHits: ExtraHit[];
};

/** Tunable scoring weights/parameters. */
export type ScoringOptions = {
  /** Credit (0–1) for a "perfect" note. */
  perfectCredit: number;
  /** Credit (0–1) for a "good" note. */
  goodCredit: number;
  /** Accuracy penalty (0–1 of one note's worth) charged per extra hit. */
  extraHitPenalty: number;
  /** Pass threshold on the 0–100 scale. */
  passThreshold: number;
};

export const DEFAULT_SCORING_OPTIONS: ScoringOptions = {
  perfectCredit: 1,
  goodCredit: 0.7,
  extraHitPenalty: 0.5,
  passThreshold: 90,
};

export type AttemptScore = {
  /** Final attempt score, 0–100. */
  score: number;
  /** Whether the score met the pass threshold. */
  passed: boolean;
  perfect: number;
  good: number;
  miss: number;
  extraHits: number;
  /** Total expected notes in the fill. */
  totalNotes: number;
  /** Mean absolute timing error across hit (non-miss) notes, ms. */
  meanAbsTimingErrorMs: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Score one practice attempt.
 *
 * Score = (earned credit − extra-hit penalties) / total notes, scaled to 0–100
 * and clamped. An empty fill (no expected notes) scores 100 if there were no
 * extra hits, else 0.
 */
export function scoreAttempt(
  judgments: AttemptJudgments,
  options: Partial<ScoringOptions> = {},
): AttemptScore {
  const opts: ScoringOptions = {...DEFAULT_SCORING_OPTIONS, ...options};

  const totalNotes = judgments.notes.length;
  let perfect = 0;
  let good = 0;
  let miss = 0;
  let earned = 0;
  let timingErrorSum = 0;
  let timingErrorCount = 0;

  for (const note of judgments.notes) {
    switch (note.quality) {
      case 'perfect':
        perfect++;
        earned += opts.perfectCredit;
        break;
      case 'good':
        good++;
        earned += opts.goodCredit;
        break;
      case 'miss':
        miss++;
        break;
    }
    if (note.quality !== 'miss' && typeof note.timingErrorMs === 'number') {
      timingErrorSum += Math.abs(note.timingErrorMs);
      timingErrorCount++;
    }
  }

  const extraHits = judgments.extraHits.length;
  const penalty = extraHits * opts.extraHitPenalty;

  let scoreFraction: number;
  if (totalNotes === 0) {
    // Nothing to play: a clean (no extra hits) attempt is a perfect pass.
    scoreFraction = extraHits === 0 ? 1 : 0;
  } else {
    scoreFraction = (earned - penalty) / totalNotes;
  }

  const score = clamp(scoreFraction * 100, 0, 100);

  return {
    score,
    passed: score >= opts.passThreshold,
    perfect,
    good,
    miss,
    extraHits,
    totalNotes,
    meanAbsTimingErrorMs:
      timingErrorCount === 0 ? 0 : timingErrorSum / timingErrorCount,
  };
}
