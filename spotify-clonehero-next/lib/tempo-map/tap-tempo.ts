/**
 * Tap tempo: turn a series of key taps into a BPM.
 *
 * Pure — no React, no chart, no audio. The editor's tap popover owns the
 * session object this module produces and hands the fit a playback rate.
 *
 * The estimator models tap `i` as landing on beat index `k_i` at time
 * `t_i ≈ phase + period · k_i`, and fits `period` by least squares over every
 * recorded tap. Integer beat indices are what make a *missed* tap harmless: a
 * skipped beat gets `k = 2` instead of doubling the period. A mean of
 * consecutive intervals cannot do that, and the telescoping
 * `span / (n - 1)` form is worse still — it depends on only the first and last
 * tap.
 */

/** A tap closer than this fraction of the current period is a double strike. */
const DOUBLE_STRIKE_FRACTION = 0.5;

/** Gaps longer than `max(PAUSE_FLOOR_MS, PAUSE_PERIODS · period)` restart the
 *  session: a long pause almost always means "I lost it", and folding the
 *  pre-pause bar into the fit is the opposite of what the user intends. */
const PAUSE_FLOOR_MS = 2500;
const PAUSE_PERIODS = 4;

/** Below this many taps the single-outlier drop is off: with three or four
 *  taps the "outlier" is as likely to be the beat everyone else missed. */
const OUTLIER_MIN_TAPS = 5;

/** A residual past `max(OUTLIER_FRACTION · period, OUTLIER_FLOOR_MS)` is a
 *  slip rather than jitter. The floor keeps fast tempos from flagging normal
 *  human timing noise. */
const OUTLIER_FRACTION = 0.15;
const OUTLIER_FLOOR_MS = 40;

/** The first interval carries the tapper's whole reaction-time transient, so
 *  two intervals is the minimum that can disagree with itself. */
export const MIN_TAPS_FOR_FIT = 3;

/** Below this the BPM is shown but cannot be written to the chart. */
export const MIN_TAPS_FOR_ACCEPT = 4;

/** Memory guard only. 512 taps at 120 BPM is over four minutes of continuous
 *  tapping; there is no sliding window, every tap since the last reset or
 *  pause is in the fit. */
const MAX_TAPS = 512;

/** An in-progress tap session: the tempo-lane position being tapped for, plus
 *  every tap recorded since the last reset or pause, in wall-clock ms. */
export interface TapSession {
  readonly anchorTick: number;
  readonly anchorMs: number;
  readonly taps: readonly number[];
}

export type TapTempoFit =
  | {status: 'insufficient'; tapCount: number}
  | {
      status: 'ok';
      /** Song-time BPM: the wall-clock fit divided by the playback rate. */
      bpm: number;
      /** Song-time beat period in ms. */
      periodMs: number;
      /** Wall-clock time of beat index 0, from the regression intercept. */
      phaseMs: number;
      /** Taps that contributed to the fit (one may have been dropped). */
      tapCount: number;
      /** Standard error of the BPM, from the regression's slope error. */
      stdErrBpm: number;
    };

export function emptyTapSession(
  anchorTick: number,
  anchorMs: number,
): TapSession {
  return {anchorTick, anchorMs, taps: []};
}

/** Drop the taps, keep the anchor: "start tapping again". */
export function clearTaps(session: TapSession): TapSession {
  return session.taps.length === 0 ? session : {...session, taps: []};
}

/**
 * Record a tap, or reject it.
 *
 * Two guards run here rather than in the fit, so the recorded taps are always
 * strictly increasing and the fit's beat indices are strictly increasing by
 * construction:
 *
 * - a double strike (two fingers landing together, or an out-of-order
 *   timestamp) is discarded and never recorded;
 * - a long pause clears the earlier taps and restarts from this one.
 */
export function pushTap(session: TapSession, timeMs: number): TapSession {
  if (!Number.isFinite(timeMs)) return session;
  const taps = session.taps;
  if (taps.length === 0) return {...session, taps: [timeMs]};

  const gap = timeMs - taps[taps.length - 1];
  if (gap <= 0) return session;

  const period = seedPeriod(taps);
  if (period !== null && gap < DOUBLE_STRIKE_FRACTION * period) return session;

  const pauseLimit =
    period === null
      ? PAUSE_FLOOR_MS
      : Math.max(PAUSE_FLOOR_MS, PAUSE_PERIODS * period);
  if (gap > pauseLimit) return {...session, taps: [timeMs]};

  const next = [...taps, timeMs];
  return {
    ...session,
    taps: next.length > MAX_TAPS ? next.slice(next.length - MAX_TAPS) : next,
  };
}

/**
 * Fit a BPM to `taps` (wall-clock ms), reported in song time.
 *
 * `rate` is the playback speed multiplier (`AudioManager.getCurrentTempo()`).
 * Song time runs `rate` times faster than wall time, so a wall-clock BPM is
 * divided by it: at 0.75×, a 500 ms song beat takes 667 ms of wall time, which
 * fits to 90 wall BPM, and 90 / 0.75 is the 120 the song is actually at.
 */
export function fitTapTempo(
  taps: readonly number[],
  rate: number,
): TapTempoFit {
  if (taps.length < MIN_TAPS_FOR_FIT) {
    return {status: 'insufficient', tapCount: taps.length};
  }

  let fit = regress(taps);
  if (fit && taps.length >= OUTLIER_MIN_TAPS) {
    const limit = Math.max(OUTLIER_FRACTION * fit.periodMs, OUTLIER_FLOOR_MS);
    let worst = -1;
    let worstResidual = 0;
    for (let i = 0; i < taps.length; i++) {
      const residual = Math.abs(fit.residuals[i]);
      if (residual > worstResidual) {
        worstResidual = residual;
        worst = i;
      }
    }
    // Exactly one drop per fit. An iterative trimmer that can eat half the
    // taps is unpredictable to a user watching the number move.
    if (worst >= 0 && worstResidual > limit) {
      const trimmed = taps.filter((_, i) => i !== worst);
      fit = regress(trimmed) ?? fit;
    }
  }

  if (!fit || !(fit.periodMs > 0) || !Number.isFinite(fit.periodMs)) {
    return {status: 'insufficient', tapCount: taps.length};
  }

  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 1;
  // Song time runs `rate` times faster than wall time, so a wall-clock
  // interval covers `rate` times as much song time.
  const periodMs = fit.periodMs * safeRate;
  const bpm = 60000 / periodMs;
  // |d(bpm)/d(period)| = 60000 / period², in wall-clock terms, then scaled the
  // same way the BPM is.
  const stdErrBpm =
    (fit.stdErrPeriodMs * 60000) / (fit.periodMs * fit.periodMs) / safeRate;

  return {
    status: 'ok',
    bpm,
    periodMs,
    phaseMs: fit.phaseMs,
    tapCount: fit.tapCount,
    stdErrBpm,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Regression {
  periodMs: number;
  phaseMs: number;
  tapCount: number;
  stdErrPeriodMs: number;
  residuals: number[];
}

function intervals(taps: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < taps.length; i++) out.push(taps[i] - taps[i - 1]);
  return out;
}

/** Median of the consecutive intervals, or null with fewer than two taps. The
 *  median rather than the mean: one dropped or doubled tap cannot move it. */
function seedPeriod(taps: readonly number[]): number | null {
  const gaps = intervals(taps);
  if (gaps.length === 0) return null;
  const value = median(gaps);
  return value > 0 ? value : null;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function regress(taps: readonly number[]): Regression | null {
  const period = seedPeriod(taps);
  if (period === null) return null;

  const t0 = taps[0];
  const k = taps.map(t => Math.round((t - t0) / period));

  const n = taps.length;
  const kMean = k.reduce((a, b) => a + b, 0) / n;
  const tMean = taps.reduce((a, b) => a + b, 0) / n;
  let skk = 0;
  let skt = 0;
  for (let i = 0; i < n; i++) {
    skk += (k[i] - kMean) * (k[i] - kMean);
    skt += (k[i] - kMean) * (taps[i] - tMean);
  }
  if (skk === 0) return null;

  const periodMs = skt / skk;
  const phaseMs = tMean - periodMs * kMean;
  const residuals = taps.map((t, i) => t - (phaseMs + periodMs * k[i]));
  const ssr = residuals.reduce((a, r) => a + r * r, 0);
  const stdErrPeriodMs = n > 2 ? Math.sqrt(ssr / (n - 2) / skk) : 0;

  return {periodMs, phaseMs, tapCount: n, stdErrPeriodMs, residuals};
}
