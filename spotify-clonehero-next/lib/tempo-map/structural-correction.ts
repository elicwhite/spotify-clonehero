/**
 * Structural tempo-map corrections — the "corrected incumbent grid" a class-(b)
 * RE-PREDICT is fed (plan 0061 §7).
 *
 * The half/double + tap-tempo control (phase 61-7) does NOT commit these grids
 * directly. Each is the *incumbent input* to the windowed KS-warp
 * (`repredictTempo`): the warp re-fits drift against the decoded onsets at the
 * corrected octave/phase, and the committed map is the warped output. These
 * helpers only build that incumbent `Synctrack` — pure, no chart mutation, no
 * onsets.
 *
 *  - **Octave rescale (×2 / ÷2):** scale every tempo segment's BPM by a power
 *    of two, keeping each segment's audio time and the time signatures. This is
 *    "the half/double bit alone" — one click, no new tempo values supplied.
 *  - **Tap-tempo fit:** fit a single constant BPM + phase from a handful of
 *    user taps (two suffice for period + phase; more refine it), covering the
 *    non-power-of-two ratio errors (1.2–1.4×) an octave bit can't reach.
 */

import type {Synctrack} from './types';

/** The only meter fields a tap fit reads — accepts both `Synctrack`'s
 * `TimeSignatureEvent` and a chart's `timeSignatures` entries. */
type MeterLike = {numerator: number; denominator: number};

/**
 * Scale every tempo segment's BPM by `factor`, preserving each segment's audio
 * time (`ms`), the `origin_ms`, and the time signatures. `factor` is a positive
 * multiplier — 2 for ×2 (double-time), 0.5 for ÷2 (half-time).
 *
 * Pure: returns a new `Synctrack`; the input is not mutated. Throws on a
 * non-positive factor (a BPM must stay positive).
 */
export function octaveRescaleSync(sync: Synctrack, factor: number): Synctrack {
  if (!(factor > 0)) {
    throw new Error(
      `octaveRescaleSync: factor must be positive, got ${factor}`,
    );
  }
  return {
    origin_ms: sync.origin_ms,
    tempos: sync.tempos.map(t => ({ms: t.ms, bpm: t.bpm * factor})),
    timeSignatures: sync.timeSignatures.map(ts => ({...ts})),
  };
}

/** Result of a tap-tempo fit: a single constant tempo and its phase (the ms of
 * the first flagged beat). */
export interface TapTempoFit {
  bpm: number;
  /** Audio time (ms) of the beat the fit is phased to (the first tap). */
  phaseMs: number;
}

/**
 * Fit a constant BPM + phase to a set of tap times (ms). Needs at least two
 * taps; the period is the mean inter-tap interval over the full span (robust to
 * a jittery middle tap), and the phase is the earliest tap.
 *
 * Throws when fewer than two taps are supplied or when the taps don't span a
 * positive interval (all identical) — either leaves the period undefined.
 */
export function fitTapTempo(tapMs: readonly number[]): TapTempoFit {
  if (tapMs.length < 2) {
    throw new Error('fitTapTempo: need at least two taps');
  }
  const sorted = [...tapMs].sort((a, b) => a - b);
  const span = sorted[sorted.length - 1] - sorted[0];
  if (!(span > 0)) {
    throw new Error('fitTapTempo: taps must span a positive interval');
  }
  const period = span / (sorted.length - 1);
  return {bpm: 60000 / period, phaseMs: sorted[0]};
}

/**
 * Build a constant-BPM + phase `Synctrack` from a set of tap times (ms) — the
 * general (non-octave) structural correction's incumbent grid (plan 0061 §7).
 *
 * A single tempo segment sits at the fitted phase, so beats fall on the tapped
 * positions. The meter is carried from `timeSignatures[0]` (numerator +
 * denominator preserved) so the tap fit never invents a new beat unit; absent
 * that, it defaults to 4/4.
 *
 * Pure. Throws via {@link fitTapTempo} on fewer than two taps.
 */
export function tapTempoSync(
  tapMs: readonly number[],
  timeSignatures?: readonly MeterLike[],
): Synctrack {
  const {bpm, phaseMs} = fitTapTempo(tapMs);
  const ts0 = timeSignatures?.[0];
  return {
    origin_ms: phaseMs,
    tempos: [{ms: phaseMs, bpm}],
    timeSignatures: [
      {
        ms: phaseMs,
        numerator: ts0?.numerator ?? 4,
        denominator: ts0?.denominator ?? 4,
      },
    ],
  };
}
