/**
 * Structural tempo-map corrections — the "corrected incumbent grid" a class-(b)
 * RE-PREDICT is fed (plan 0061 §7).
 *
 * The half/double structural-correction control (phase 61-7; tap-tempo was
 * removed in plan 0063 Round 2 §6 — ×2/÷2 covers the correction need without
 * a manual tap gesture) does NOT commit this grid directly. It's the
 * *incumbent input* to the windowed KS-warp (`repredictTempo`): the warp
 * re-fits drift against the decoded onsets at the corrected octave, and the
 * committed map is the warped output. This helper only builds that incumbent
 * `Synctrack` — pure, no chart mutation, no onsets.
 *
 * **Octave rescale (×2 / ÷2):** scale every tempo segment's BPM by a power of
 * two, keeping each segment's audio time and the time signatures. This is
 * "the half/double bit alone" — one click, no new tempo values supplied.
 */

import type {Synctrack} from './types';

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
