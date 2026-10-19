/**
 * Pure fill-difficulty-ladder progression logic (plan 0045 §6).
 *
 * A groove cluster's unique fill patterns, ordered simple→complex by their
 * continuous difficulty score, form a ladder. The user climbs it: start at the
 * lowest unmastered rung, advance after enough passing attempts, step back
 * after repeated fails. This module owns only the rung-selection state machine
 * (which rung, when to move) so it is unit-testable without a database, the
 * highway, or MIDI. The React session layer feeds it attempt outcomes and the
 * DB layer persists the resulting position.
 */

/** Minimal per-rung shape the ladder logic needs. */
export interface LadderRungLike {
  /** Stable identity of the rung (the fill similarity key). */
  fillSimilarityKey: string;
  difficultyScore: number;
  /** Aggregated mastery of the rung's pattern. */
  state: 'new' | 'learning' | 'mastered';
}

export interface LadderOptions {
  /** Passing attempts at a rung required to advance to the next. */
  passesToAdvance: number;
  /** Consecutive failing attempts at a rung that drop the user one rung back. */
  failsToStepBack: number;
}

export const DEFAULT_LADDER_OPTIONS: LadderOptions = {
  passesToAdvance: 2,
  failsToStepBack: 3,
};

/**
 * The index of the rung a fresh climb should start on: the lowest rung that is
 * not yet mastered. If every rung is mastered, start at the top (the climb is
 * complete but the user can still drill the hardest). Empty ladder → 0.
 */
export function startingRungIndex(rungs: LadderRungLike[]): number {
  if (rungs.length === 0) return 0;
  const firstUnmastered = rungs.findIndex(r => r.state !== 'mastered');
  return firstUnmastered === -1 ? rungs.length - 1 : firstUnmastered;
}

/**
 * Resolve a persisted rung (by fill similarity key) to an index in the current
 * ladder. Falls back to {@link startingRungIndex} when the saved rung is gone
 * (e.g. a rescan dropped that pattern) or nothing was saved.
 */
export function resolveRungIndex(
  rungs: LadderRungLike[],
  savedKey: string | null,
): number {
  if (savedKey != null) {
    const idx = rungs.findIndex(r => r.fillSimilarityKey === savedKey);
    if (idx !== -1) return idx;
  }
  return startingRungIndex(rungs);
}

/** Running per-rung attempt tally, reset whenever the current rung changes. */
export interface RungProgress {
  index: number;
  passes: number;
  /** Consecutive fails (resets on any pass). */
  fails: number;
}

export function initRungProgress(index: number): RungProgress {
  return {index, passes: 0, fails: 0};
}

export interface LadderStepResult {
  progress: RungProgress;
  /** True when the index changed (advanced or stepped back) this attempt. */
  moved: boolean;
  /** Direction of any move, for UI feedback. */
  direction: 'advance' | 'back' | 'none';
}

/**
 * Advance the ladder state machine for one scored attempt at the current rung.
 *
 * - A pass accumulates toward {@link LadderOptions.passesToAdvance}; on reaching
 *   it the user moves to the next rung (clamped at the top) and the tally
 *   resets.
 * - A fail accumulates consecutive fails; on reaching
 *   {@link LadderOptions.failsToStepBack} the user drops one rung (clamped at
 *   the bottom) and the tally resets. A pass clears the fail streak.
 *
 * Pure: returns a fresh {@link RungProgress}; never mutates the input.
 */
export function advanceLadder(
  progress: RungProgress,
  rungCount: number,
  passed: boolean,
  options: Partial<LadderOptions> = {},
): LadderStepResult {
  const opts = {...DEFAULT_LADDER_OPTIONS, ...options};

  if (passed) {
    const passes = progress.passes + 1;
    if (passes >= opts.passesToAdvance && progress.index < rungCount - 1) {
      return {
        progress: initRungProgress(progress.index + 1),
        moved: true,
        direction: 'advance',
      };
    }
    return {
      progress: {index: progress.index, passes, fails: 0},
      moved: false,
      direction: 'none',
    };
  }

  const fails = progress.fails + 1;
  if (fails >= opts.failsToStepBack && progress.index > 0) {
    return {
      progress: initRungProgress(progress.index - 1),
      moved: true,
      direction: 'back',
    };
  }
  return {
    progress: {index: progress.index, passes: progress.passes, fails},
    moved: false,
    direction: 'none',
  };
}
