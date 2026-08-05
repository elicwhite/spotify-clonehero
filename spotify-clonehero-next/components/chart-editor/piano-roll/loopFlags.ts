/**
 * Pure geometry + hit-testing for the A/B loop region's flags on the
 * piano-roll timeline.
 *
 * The loop lives in editor state as a `LoopRegion` (set by `LoopControls`'
 * A/B buttons and by dragging the flags this module hit-tests). It renders in
 * the section-marker strip: a translucent band between the two edges plus a
 * small flag at each edge. Everything here is millisecond-space, so — like
 * the rest of the panel — it stays put when a tempo edit moves the grid.
 *
 * No React, no canvas: the panel draws from `loopFlagXs` and routes pointers
 * through `pickLoopFlagAt` / `isInsideLoopShade`, and commits drags through
 * `moveLoopEdge`.
 */

import {MIN_LOOP_SPAN_MS, type LoopRegion} from '@/lib/preview/loopRegion';
import {msToX, type PianoRollView} from './viewMath';

/** Which edge of the loop a pointer grabbed. */
export type LoopFlagKind = 'loop-start' | 'loop-end';

/** Half-width (px) of a flag's grab target, matching the drawn pennant. */
export const LOOP_FLAG_HIT_RADIUS = 6;

/** Screen x of each loop edge under a view. */
export function loopFlagXs(
  region: LoopRegion,
  view: PianoRollView,
): {startX: number; endX: number} {
  return {
    startX: msToX(region.startMs, view),
    endX: msToX(region.endMs, view),
  };
}

/**
 * The loop flag under `x`, or null. Ties (both edges inside the radius, only
 * possible at extreme zoom-out) resolve to the start flag; `moveLoopEdge`'s
 * clamp guarantees the two are never at the same ms, so the other edge is
 * always reachable by zooming in.
 */
export function pickLoopFlagAt(
  region: LoopRegion | null,
  view: PianoRollView,
  x: number,
  hitRadius: number = LOOP_FLAG_HIT_RADIUS,
): LoopFlagKind | null {
  if (!region) return null;
  const {startX, endX} = loopFlagXs(region, view);
  const startDx = Math.abs(startX - x);
  const endDx = Math.abs(endX - x);
  if (startDx <= hitRadius && startDx <= endDx) return 'loop-start';
  if (endDx <= hitRadius) return 'loop-end';
  return null;
}

/**
 * True when `x` falls inside the shaded band between the two edges — the
 * region whose right-click offers "Clear loop".
 */
export function isInsideLoopShade(
  region: LoopRegion | null,
  view: PianoRollView,
  x: number,
): boolean {
  if (!region) return false;
  const {startX, endX} = loopFlagXs(region, view);
  return x >= Math.min(startX, endX) && x <= Math.max(startX, endX);
}

/**
 * Move one edge to `ms`, clamping (never swapping) so the loop keeps its
 * orientation and at least {@link MIN_LOOP_SPAN_MS}: dragging the start past
 * the end parks it `MIN_LOOP_SPAN_MS` before the end, and vice versa. The
 * start also never goes negative — the view can pan left of time zero.
 */
export function moveLoopEdge(
  region: LoopRegion,
  kind: LoopFlagKind,
  ms: number,
): LoopRegion {
  if (kind === 'loop-start') {
    const maxStart = Math.max(0, region.endMs - MIN_LOOP_SPAN_MS);
    return {...region, startMs: Math.min(maxStart, Math.max(0, ms))};
  }
  const minEnd = region.startMs + MIN_LOOP_SPAN_MS;
  return {...region, endMs: Math.max(minEnd, ms)};
}

/** Default span (ms) an auto-placed end/start marker gets when there's no
 *  existing region to anchor to — the sidebar A/B buttons' original rule. */
export const DEFAULT_LOOP_SPAN_MS = 4000;

/**
 * The "A" rule: set the loop start at `positionMs` (playhead for the
 * sidebar's A button, a right-clicked ruler tick for the section strip's
 * "Set repeat loop start" menu item) and, when there's no existing region,
 * place an end marker {@link DEFAULT_LOOP_SPAN_MS} after it. An existing
 * region keeps its end, clamped to stay at least {@link MIN_LOOP_SPAN_MS}
 * after the new start. The one place this rule lives — the sidebar button
 * and the context-menu item both call it, so they can't drift apart.
 */
export function loopStartRegionAt(
  positionMs: number,
  existing: LoopRegion | null,
): LoopRegion {
  const startMs = Math.max(0, positionMs);
  const endMs = existing?.endMs ?? startMs + DEFAULT_LOOP_SPAN_MS;
  return {startMs, endMs: Math.max(startMs + MIN_LOOP_SPAN_MS, endMs)};
}

/**
 * The "B" rule: set the loop end at `positionMs`, symmetric with
 * {@link loopStartRegionAt}. `positionMs` is floored at
 * {@link MIN_LOOP_SPAN_MS} so a start can always be placed before it; an
 * existing region keeps its start, clamped to stay at least
 * `MIN_LOOP_SPAN_MS` before the new end.
 */
export function loopEndRegionAt(
  positionMs: number,
  existing: LoopRegion | null,
): LoopRegion {
  const endMs = Math.max(MIN_LOOP_SPAN_MS, positionMs);
  const startMs =
    existing?.startMs ?? Math.max(0, endMs - DEFAULT_LOOP_SPAN_MS);
  return {
    startMs: Math.max(0, Math.min(startMs, endMs - MIN_LOOP_SPAN_MS)),
    endMs,
  };
}
