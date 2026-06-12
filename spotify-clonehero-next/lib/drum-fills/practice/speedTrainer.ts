/**
 * Progressive speed-trainer tempo policy.
 *
 * Pure decision function: given the current tempo percentage and the recent
 * attempt history, decide the next tempo. The trainer starts slow (70%), steps
 * up after a run of consecutive passes, and steps down after a run of
 * consecutive fails, clamped to a configurable floor/ceiling.
 *
 * Only the trailing run of same-outcome attempts matters, so the policy reacts
 * to the player's current form rather than their whole session.
 */

export type SpeedTrainerOptions = {
  /** Starting tempo percentage. */
  startTempoPct: number;
  /** Lowest tempo the trainer will drop to. */
  minTempoPct: number;
  /** Highest tempo the trainer will climb to. */
  maxTempoPct: number;
  /** Tempo increment applied after a passing run. */
  stepUpPct: number;
  /** Tempo decrement applied after a failing run. */
  stepDownPct: number;
  /** Consecutive passes required to step up. */
  passesToStepUp: number;
  /** Consecutive fails required to step down. */
  failsToStepDown: number;
};

export const DEFAULT_SPEED_TRAINER_OPTIONS: SpeedTrainerOptions = {
  startTempoPct: 70,
  minTempoPct: 50,
  maxTempoPct: 110,
  stepUpPct: 5,
  stepDownPct: 3,
  passesToStepUp: 3,
  failsToStepDown: 3,
};

/** A single attempt outcome, oldest-to-newest within an array. */
export type SpeedAttempt = {passed: boolean};

/** The starting tempo for a new speed-trainer session. */
export function initialTempoPct(
  options: Partial<SpeedTrainerOptions> = {},
): number {
  const opts = {...DEFAULT_SPEED_TRAINER_OPTIONS, ...options};
  return opts.startTempoPct;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Length of the trailing run of attempts that all share `attempts[last]`'s
 * outcome. Returns 0 for an empty history.
 */
function trailingRun(attempts: SpeedAttempt[]): {
  passed: boolean;
  length: number;
} {
  if (attempts.length === 0) return {passed: false, length: 0};
  const last = attempts[attempts.length - 1].passed;
  let length = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].passed !== last) break;
    length++;
  }
  return {passed: last, length};
}

/**
 * Compute the next tempo percentage.
 *
 * - After `passesToStepUp` consecutive passes: tempo += stepUpPct (capped at
 *   maxTempoPct).
 * - After `failsToStepDown` consecutive fails: tempo -= stepDownPct (floored at
 *   minTempoPct).
 * - Otherwise: tempo unchanged.
 *
 * `recentAttempts` is ordered oldest→newest. Only the trailing same-outcome run
 * is considered, so once a step fires the player must build a fresh run to step
 * again.
 */
export function nextTempoPct(
  currentTempoPct: number,
  recentAttempts: SpeedAttempt[],
  options: Partial<SpeedTrainerOptions> = {},
): number {
  const opts: SpeedTrainerOptions = {
    ...DEFAULT_SPEED_TRAINER_OPTIONS,
    ...options,
  };

  const run = trailingRun(recentAttempts);

  let next = currentTempoPct;
  if (run.passed && run.length >= opts.passesToStepUp) {
    next = currentTempoPct + opts.stepUpPct;
  } else if (!run.passed && run.length >= opts.failsToStepDown) {
    next = currentTempoPct - opts.stepDownPct;
  }

  return clamp(next, opts.minTempoPct, opts.maxTempoPct);
}

/**
 * Whether the speed trainer has been "completed": the player is at (or above)
 * full speed and just logged a step-up-worthy passing run. Used to drive the
 * learning → mastered promotion alongside the SRS scheduler.
 */
export function isSpeedTrainerComplete(
  currentTempoPct: number,
  recentAttempts: SpeedAttempt[],
  options: Partial<SpeedTrainerOptions> = {},
): boolean {
  const opts: SpeedTrainerOptions = {
    ...DEFAULT_SPEED_TRAINER_OPTIONS,
    ...options,
  };
  if (currentTempoPct < 100) return false;
  const run = trailingRun(recentAttempts);
  return run.passed && run.length >= opts.passesToStepUp;
}
