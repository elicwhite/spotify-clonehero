/**
 * Tempo-aware fill-ladder progression.
 *
 * The plain ladder ({@link ./fillLadder}) changes rungs straight off pass/fail
 * counts, ignoring tempo. This machine inserts a tempo buffer between rungs so
 * the player slows the *current* fill down before dropping to an easier one, and
 * speeds back up to full tempo before advancing to a harder one:
 *
 *   pass run  → at full tempo: ADVANCE a rung; otherwise SPEED UP
 *   fail run  → at/under the floor tempo: STEP BACK a rung; otherwise SLOW DOWN
 *
 * A rung change resets to that rung's entry tempo (supplied by the caller, which
 * can scale it by difficulty and remember a per-rung tempo across the session).
 * Stepping back is floor-gated rather than fired on the first fail run, which is
 * what makes "slow down, *then* step back" hold — a step-back takes roughly 4–6
 * failing runs depending on the rung's entry tempo, not a single run.
 *
 * Pure and unit-tested: no DB, highway, MIDI, or React.
 */

export interface LadderClimbOptions {
  /** Tempo (pct) the player must reach before a passing run advances a rung. */
  fullTempoPct: number;
  /** At/under this tempo, a failing run steps back instead of slowing further. */
  floorTempoPct: number;
  /** Hard lower bound; tempo never drops below this. */
  minTempoPct: number;
  /** Tempo gained per speed-up. Symmetric with stepDownPct so recovery from a
   * slow-down isn't punitive. */
  stepUpPct: number;
  /** Tempo shed per slow-down. */
  stepDownPct: number;
  /** Consecutive passes at the current tempo that trigger a speed-up / advance. */
  passesToStep: number;
  /** Consecutive fails at the current tempo that trigger a slow-down / step-back. */
  failsToStep: number;
  /** Entry tempo for a freshly entered rung (by index). Lets the caller scale by
   * difficulty and resume a remembered per-rung tempo. */
  rungEntryTempoPct: (index: number) => number;
}

export const DEFAULT_LADDER_CLIMB_OPTIONS: LadderClimbOptions = {
  fullTempoPct: 100,
  floorTempoPct: 70,
  minTempoPct: 60,
  stepUpPct: 10,
  stepDownPct: 10,
  passesToStep: 2,
  failsToStep: 2,
  rungEntryTempoPct: () => 85,
};

/** Per-rung climb state. Pass/fail tallies reset whenever the tempo changes. */
export interface RungClimb {
  index: number;
  tempoPct: number;
  /** Consecutive passes at the current tempo. */
  passesAtTempo: number;
  /** Consecutive fails at the current tempo. */
  failsAtTempo: number;
}

export type ClimbChange =
  | 'advance'
  | 'step-back'
  | 'speed-up'
  | 'slow-down'
  | 'none';

export interface ClimbResult {
  climb: RungClimb;
  change: ClimbChange;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveOptions(
  options: Partial<LadderClimbOptions>,
): LadderClimbOptions {
  return {...DEFAULT_LADDER_CLIMB_OPTIONS, ...options};
}

/** Fresh climb state on entering a rung, at that rung's entry tempo. */
export function initRungClimb(
  index: number,
  options: Partial<LadderClimbOptions> = {},
): RungClimb {
  const opts = resolveOptions(options);
  return {
    index,
    tempoPct: clamp(
      opts.rungEntryTempoPct(index),
      opts.minTempoPct,
      opts.fullTempoPct,
    ),
    passesAtTempo: 0,
    failsAtTempo: 0,
  };
}

/**
 * Advance the tempo-aware ladder for one scored attempt at the current rung.
 * Pure: returns a fresh {@link RungClimb}; never mutates the input.
 */
export function climbLadder(
  climb: RungClimb,
  rungCount: number,
  passed: boolean,
  options: Partial<LadderClimbOptions> = {},
): ClimbResult {
  const opts = resolveOptions(options);

  if (passed) {
    const passesAtTempo = climb.passesAtTempo + 1;
    if (passesAtTempo >= opts.passesToStep) {
      if (climb.tempoPct >= opts.fullTempoPct) {
        // At full speed and passing: climb to the next rung.
        if (climb.index < rungCount - 1) {
          return {climb: initRungClimb(climb.index + 1, opts), change: 'advance'};
        }
        // Already on the hardest rung at full speed: hold (mastered the top).
        return {
          climb: {...climb, passesAtTempo, failsAtTempo: 0},
          change: 'none',
        };
      }
      // Not yet at full speed: speed this rung up, fresh tally at the new tempo.
      const tempoPct = clamp(
        climb.tempoPct + opts.stepUpPct,
        opts.minTempoPct,
        opts.fullTempoPct,
      );
      return {
        climb: {index: climb.index, tempoPct, passesAtTempo: 0, failsAtTempo: 0},
        change: 'speed-up',
      };
    }
    return {
      climb: {...climb, passesAtTempo, failsAtTempo: 0},
      change: 'none',
    };
  }

  const failsAtTempo = climb.failsAtTempo + 1;
  if (failsAtTempo >= opts.failsToStep) {
    if (climb.tempoPct <= opts.floorTempoPct && climb.index > 0) {
      // Slow enough and still failing: drop to the easier rung.
      return {climb: initRungClimb(climb.index - 1, opts), change: 'step-back'};
    }
    // Above the floor (or already on the easiest rung): slow this rung down.
    const tempoPct = clamp(
      climb.tempoPct - opts.stepDownPct,
      opts.minTempoPct,
      opts.fullTempoPct,
    );
    if (tempoPct === climb.tempoPct) {
      // Pinned at the floor on the bottom rung: nowhere lower to go.
      return {
        climb: {...climb, passesAtTempo: 0, failsAtTempo},
        change: 'none',
      };
    }
    return {
      climb: {index: climb.index, tempoPct, passesAtTempo: 0, failsAtTempo: 0},
      change: 'slow-down',
    };
  }
  return {
    climb: {...climb, passesAtTempo: 0, failsAtTempo},
    change: 'none',
  };
}
