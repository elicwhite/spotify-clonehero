/**
 * Per-song note<->grid phase self-alignment (audio-flow only).
 *
 * Ported from analysis/probe_phase_self_alignment_v2.py in drum-to-chart
 * (see wiki/phase-align-v2-spec.md for the full derivation and the
 * validated gate). Given the decoded onset times and the generated tempo
 * map, sweeps a bounded global time shift and scores each candidate by
 * metrically-weighted on-grid onset mass; a strong-prior-for-zero-shift gate
 * (3 conditions, ALL required) decides whether the best shift is decisive
 * enough to apply.
 *
 * AUDIO-FLOW ONLY: this lever exists because a model-predicted tempo grid
 * can itself carry a global phase bias. An existing (charter-authored) grid
 * is trusted as-is, so this module is never invoked from the chart-flow
 * builder ({@link buildChartDocumentFromExistingChart}).
 */
import type {TimedTempo} from '../chart-types';
import {msToTick} from '../timing';
import type {PhaseAlignGateConfig} from '../ml/phase-align-config';

/**
 * Musically strong beat-phase positions and their weights, ported verbatim
 * from the probe's STRONG_POSITIONS (quarter > 8th > 16th).
 */
export const STRONG_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [0.0, 1.0],
  [0.5, 0.6],
  [0.25, 0.3],
  [0.75, 0.3],
  [0.125, 0.15],
  [0.375, 0.15],
  [0.625, 0.15],
  [0.875, 0.15],
];

/** Tolerance window (fraction of a beat) for "on" a strong position. */
export const TOL_BEAT = 1 / 24;

/** Shift search range/step (ms), ported verbatim from the probe. */
export const SHIFT_RANGE_MS = 80.0;
export const SHIFT_STEP_MS = 4.0;

/** Minimum onset count for a reliable shift-search read (ported verbatim:
 * the probe returns shift=0 unconditionally below this). */
export const MIN_ONSETS_FOR_SEARCH = 8;

/**
 * Convert an onset time (ms) to its beat-phase coordinate (tick / resolution,
 * mod 1 beat is NOT applied here — see {@link metricalMass} for the mod).
 *
 * This is the TS analogue of the probe's `time_to_beta` + `prepare.py`'s
 * tick-domain tempo map: {@link msToTick}'s 'round' rounding is NOT used
 * here (rounding to an integer tick before computing beat-phase would
 * quantize away the sub-tick precision the mass objective depends on), so
 * this file reimplements the raw (unrounded) tick formula directly rather
 * than calling the shared `msToTick` with a rounding mode.
 */
function msToBeatPhase(
  ms: number,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  let tempoIndex = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].msTime <= ms) {
      tempoIndex = i;
    } else {
      break;
    }
  }
  const tempo = timedTempos[tempoIndex];
  const elapsedMs = ms - tempo.msTime;
  const tickOffset = (elapsedMs * tempo.beatsPerMinute * resolution) / 60000;
  const rawTick = tempo.tick + tickOffset;
  return rawTick / resolution;
}

/**
 * Metrical mass: mean over onsets of weighted membership within tolerance
 * of a strong metrical position. Ported verbatim from the probe's
 * `metrical_mass`.
 */
export function metricalMass(betas: number[], tol: number = TOL_BEAT): number {
  if (betas.length === 0) return 0;
  let score = 0;
  for (const beta of betas) {
    let frac = beta % 1.0;
    if (frac < 0) frac += 1.0; // JS `%` can return negative; Python's mod doesn't.
    for (const [pos, w] of STRONG_POSITIONS) {
      const raw = Math.abs(frac - pos);
      const d = Math.min(raw, 1.0 - raw);
      if (d <= tol) score += w;
    }
  }
  return score / betas.length;
}

export interface PhaseAlignResult {
  /** The shift to apply, in ms. 0 if the gate did not fire (or too few
   * onsets for a reliable read). */
  shiftMs: number;
  /** Whether the 3-condition gate fired (shiftMs is non-zero iff applied,
   * except in the degenerate case where the best shift IS 0). */
  applied: boolean;
  /** Metrical mass at the best shift found by the sweep. */
  bestScore: number;
  /** Metrical mass at shift=0. */
  noshiftScore: number;
}

const NOT_APPLIED: PhaseAlignResult = {
  shiftMs: 0,
  applied: false,
  bestScore: 0,
  noshiftScore: 0,
};

/**
 * Unconditional shift search + gate decision.
 *
 * `onsetTimesMs` should already include any flow-specific systematic-onset
 * correction (e.g. SYSTEMATIC_ONSET_MS_AUDIO_FLOW) — this mirrors the
 * probe's `pt_for_search = pt_raw + SYSTEMATIC_ONSET_MS`, so the search
 * scores onsets at the same corrected positions chart placement uses.
 */
export function computePhaseAlignShiftMs(
  onsetTimesMs: number[],
  timedTempos: TimedTempo[],
  resolution: number,
  config: PhaseAlignGateConfig,
): PhaseAlignResult {
  if (!config.enabled) return NOT_APPLIED;
  if (onsetTimesMs.length < MIN_ONSETS_FOR_SEARCH) return NOT_APPLIED;
  if (timedTempos.length === 0) return NOT_APPLIED;

  const noshiftBetas = onsetTimesMs.map(ms =>
    msToBeatPhase(ms, timedTempos, resolution),
  );
  const noshiftScore = metricalMass(noshiftBetas);

  let bestShift = 0;
  let bestScore = noshiftScore;
  for (
    let s = -SHIFT_RANGE_MS;
    s <= SHIFT_RANGE_MS + 1e-6;
    s += SHIFT_STEP_MS
  ) {
    const betas = onsetTimesMs.map(ms =>
      msToBeatPhase(ms + s, timedTempos, resolution),
    );
    const score = metricalMass(betas);
    if (score > bestScore) {
      bestScore = score;
      bestShift = s;
    }
  }

  const ratio = bestScore / Math.max(noshiftScore, 1e-6);
  const gateFires =
    noshiftScore <= config.baselineMassMax &&
    ratio >= config.ratioMin &&
    bestScore >= config.postMassMin;

  return {
    shiftMs: gateFires ? bestShift : 0,
    applied: gateFires,
    bestScore,
    noshiftScore,
  };
}
