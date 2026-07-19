/**
 * Pure hit-testing + drag math for the piano-roll tempo lane (plan 0062 §7/§8).
 *
 * The canvas hit-tests, React decides, commands mutate — same
 * hybrid-interaction philosophy as the note lanes. These helpers turn a
 * pointer pixel into a tempo marker (generous ~10px radius, §7), clamp a
 * marker drag to the min-segment rule, and resolve the nearest beat for the
 * "add marker" / "mark downbeat" context-menu items. No React, no canvas, no
 * store access. Tick↔ms conversion is never forked here — screen positions
 * come from `viewMath`, and beat ticks come from the caller's already-derived
 * beat grid so the tempo lane can never disagree with the ruler.
 */

import {MIN_SEGMENT_MS} from '@/lib/chart-edit';
import {msToX, xToMs, type PianoRollView} from './viewMath';

/** Generous marker hit radius in px (§7 — ReaBeat-style widened targets). */
export const TEMPO_MARKER_HIT_RADIUS = 10;

/**
 * Minimum segment length in ms enforced while dragging a marker (§7).
 * Re-exported from the lib-side clamp (`lib/chart-edit/tempo-remap`) so the
 * view affordance and the engine share one value — a programmatic
 * `MoveTempoMarkerCommand` can never create a segment the UI forbids, and the
 * drag can never approach a neighbour closer than the engine would allow.
 */
export {MIN_SEGMENT_MS};

/** A tempo marker as far as hit-testing/drag math cares: only its ms matters. */
export interface TempoMarkerPos {
  ms: number;
}

/**
 * Index of the tempo marker within `hitRadius` px of screen `x` (nearest
 * wins), or -1 when none is close enough. Markers are assumed sorted by ms.
 */
export function hitTempoMarker(
  markers: readonly TempoMarkerPos[],
  view: PianoRollView,
  x: number,
  hitRadius: number = TEMPO_MARKER_HIT_RADIUS,
): number {
  let best = -1;
  let bestDist = hitRadius;
  for (let k = 0; k < markers.length; k++) {
    const d = Math.abs(msToX(markers[k].ms, view) - x);
    if (d < bestDist) {
      best = k;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Clamp a marker's desired ms to the min-segment rule: it can approach neither
 * neighbour closer than `minSegMs`, and (as the last marker) is free to slide
 * out to `totalMs` + a beyond-the-song margin. Marker 0 is immovable and must
 * never be passed here (`index >= 1`). Mirrors the lib-side clamp in
 * `applyMarkerMoveBpms`; this is the view-side affordance so the ghost/marker
 * track the pointer without ever crossing a neighbour.
 */
export function clampMarkerMs(
  markers: readonly TempoMarkerPos[],
  index: number,
  desiredMs: number,
  totalMs: number,
  minSegMs: number = MIN_SEGMENT_MS,
): number {
  const lo = markers[index - 1].ms + minSegMs;
  const hi =
    index + 1 < markers.length
      ? markers[index + 1].ms - minSegMs
      : totalMs + 60000;
  return Math.max(lo, Math.min(hi, desiredMs));
}

/** A beat as far as nearest-beat resolution cares: its tick and real-time ms. */
export interface BeatPos {
  tick: number;
  ms: number;
}

/**
 * Tick of the beat whose real-time position is nearest screen `x`, or null
 * when there are no beats. Uses the beats' ms (from the tempo map) rather than
 * a `tick % RES` assumption, so it honours denominator-scaled beats and tempo
 * changes — the same grid the ruler draws.
 */
export function nearestBeatTick(
  beats: readonly BeatPos[],
  view: PianoRollView,
  x: number,
): number | null {
  if (beats.length === 0) return null;
  const ms = xToMs(x, view);
  let bestTick = beats[0].tick;
  let bestDist = Math.abs(beats[0].ms - ms);
  for (let i = 1; i < beats.length; i++) {
    const d = Math.abs(beats[i].ms - ms);
    if (d < bestDist) {
      bestTick = beats[i].tick;
      bestDist = d;
    }
  }
  return bestTick;
}
