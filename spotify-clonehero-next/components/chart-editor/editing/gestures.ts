/**
 * Shared note-drag + threshold semantics (plan 0062 "Two views, one store",
 * invariant 3).
 *
 * Both the highway (`useHighwayMouseInteraction`) and the piano-roll timeline
 * turn a pointer drag into a `MoveEntitiesCommand`. The *deltas* that command
 * carries — how far in ticks and across how many lanes — must be computed the
 * same way in both views, or dragging a note on one surface and the same note
 * on the other would move it differently. This module is that one
 * computation; neither view carries a second copy.
 *
 * Pure: no React, no DOM. The screen→tick/lane conversion is each view's own
 * job (highway raycasts, piano roll uses its ms x-axis); this takes the
 * already-resolved anchor + snapped cursor.
 */

import {
  parseSchemaNoteId,
  typeToLane as schemaTypeToLane,
  type InstrumentSchema,
} from '@/lib/chart-edit';

/** Pixel movement past which a press becomes a drag (not a click). */
export const DRAG_THRESHOLD_PX = 5;

/** True once a pointer has moved past the drag threshold from its start. */
export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
}

export interface NoteDragInput {
  /** Editor tick of the grabbed note when the drag began. */
  anchorTick: number;
  /** Editor lane of the grabbed note. */
  anchorLane: number;
  /** Cursor tick, already snapped to the grid lattice. */
  snappedCursorTick: number;
  /**
   * Cursor's editor lane, or null when the view can't resolve one this frame.
   * Null leaves the lane delta at its previous value, so a brief excursion
   * outside the lanes doesn't snap the preview back.
   */
  cursorLane: number | null;
  /** Lane delta from the previous frame (fallback while off the lanes). */
  prevLaneDelta: number;
  /**
   * Lowest and highest lane index the drag may address. A pointer drag points
   * AT a lane, so this is the schema's full lane range — kick and open
   * included. (The arrow-key nudge is the gesture that excludes them; see
   * `LaneAxis` in lib/chart-edit.)
   */
  minLane: number;
  maxLane: number;
  /**
   * Lowest and highest lane occupied by the selection. The delta is clamped
   * so this whole span stays inside `[minLane, maxLane]`: clamping each note
   * independently instead would let a drag past the edge pile the selection
   * onto one lane, silently destroying the intervals between the notes.
   *
   * Equal to the anchor's lane for a single-note drag.
   */
  selectionMinLane: number;
  selectionMaxLane: number;
}

/**
 * Lowest and highest lane occupied by a set of selected note ids.
 *
 * Note ids carry their own type, so the span is read straight off the
 * selection without touching the document. `fallbackLane` (the drag anchor's)
 * covers a selection whose ids don't parse against this schema — a stale
 * selection from another track — so a drag still behaves like a single-note
 * one instead of clamping to nothing.
 */
export function selectionLaneSpan(
  noteIds: readonly string[],
  schema: InstrumentSchema,
  fallbackLane: number,
): {min: number; max: number} {
  const lanes: number[] = [];
  for (const id of noteIds) {
    const parsed = parseSchemaNoteId(id, schema);
    if (!parsed) continue;
    const lane = schemaTypeToLane(schema, parsed.type);
    if (lane >= 0) lanes.push(lane);
  }
  if (lanes.length === 0) return {min: fallbackLane, max: fallbackLane};
  return {min: Math.min(...lanes), max: Math.max(...lanes)};
}

export interface NoteDragDelta {
  /** Snapped tick offset applied to every selected note (delta-snap: the
   *  anchor lands on the grid, relative offsets are preserved). */
  tickDelta: number;
  /** Lane offset applied to every selected note. */
  laneDelta: number;
}

/**
 * Compute the `{tickDelta, laneDelta}` for a note drag (§6):
 *
 * - **Delta-snap:** `tickDelta` is the snapped cursor tick minus the grabbed
 *   note's tick, so the grabbed note lands exactly on the grid while every
 *   other selected note keeps its relative (possibly off-grid) offset.
 * - **Lane change applies to the whole selection**, by the same delta, so a
 *   run of notes moves to another lane keeping its shape. The delta is
 *   clamped by the selection's span rather than per note — see
 *   `selectionMinLane`.
 * - Every lane is a legal target, kick and open included: the drag names a
 *   lane by pointing at it.
 */
export function computeNoteDragDelta(input: NoteDragInput): NoteDragDelta {
  const tickDelta = input.snappedCursorTick - input.anchorTick;
  let laneDelta = input.prevLaneDelta;
  const cursorLane = input.cursorLane;
  if (cursorLane !== null) {
    const wanted =
      Math.max(input.minLane, Math.min(input.maxLane, cursorLane)) -
      input.anchorLane;
    // Hold the selection's shape: the delta may not push its lowest note
    // below `minLane` nor its highest above `maxLane`.
    laneDelta = Math.max(
      input.minLane - input.selectionMinLane,
      Math.min(input.maxLane - input.selectionMaxLane, wanted),
    );
  }
  return {tickDelta, laneDelta};
}
