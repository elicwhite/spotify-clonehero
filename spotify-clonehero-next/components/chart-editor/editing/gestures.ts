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

/** Pixel movement past which a press becomes a drag (not a click). */
export const DRAG_THRESHOLD_PX = 5;

/** True once a pointer has moved past the drag threshold from its start. */
export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
}

export interface NoteDragInput {
  /** Editor tick of the grabbed note when the drag began. */
  anchorTick: number;
  /** Editor lane (0=kick, 1..N pads) of the grabbed note. */
  anchorLane: number;
  /** Cursor tick, already snapped to the grid lattice. */
  snappedCursorTick: number;
  /**
   * Cursor's editor lane, or null when the view can't resolve one this frame
   * (e.g. the pointer is over the kick strip). Null / kick-lane leaves the
   * lane delta at its previous value so a brief excursion off the pad lanes
   * doesn't snap the preview back.
   */
  cursorLane: number | null;
  /** Number of notes in the current selection — lanes lock when > 1. */
  selectionSize: number;
  /** Lane delta from the previous frame (fallback while off the pad lanes). */
  prevLaneDelta: number;
  /** First pad lane index (kick is lane 0; pads start at 1). */
  minPadLane: number;
  /** Highest pad lane index. */
  maxPadLane: number;
}

export interface NoteDragDelta {
  /** Snapped tick offset applied to every selected note (delta-snap: the
   *  anchor lands on the grid, relative offsets are preserved). */
  tickDelta: number;
  /** Pad-lane offset. Always 0 for a kick anchor or a multi-note selection. */
  laneDelta: number;
}

/**
 * Compute the `{tickDelta, laneDelta}` for a note drag (§6):
 *
 * - **Delta-snap:** `tickDelta` is the snapped cursor tick minus the grabbed
 *   note's tick, so the grabbed note lands exactly on the grid while every
 *   other selected note keeps its relative (possibly off-grid) offset.
 * - **Lane change is single-note only:** a multi-note selection
 *   (`selectionSize > 1`) locks lanes — the drag moves in time only. A kick
 *   anchor never changes lane either (kick spans the full width).
 * - Pad lanes clamp to `[minPadLane, maxPadLane]`.
 */
export function computeNoteDragDelta(input: NoteDragInput): NoteDragDelta {
  const tickDelta = input.snappedCursorTick - input.anchorTick;
  const laneLocked = input.selectionSize > 1;
  let laneDelta = laneLocked ? 0 : input.prevLaneDelta;
  if (
    !laneLocked &&
    input.anchorLane > 0 &&
    input.cursorLane !== null &&
    input.cursorLane > 0
  ) {
    const clamped = Math.max(
      input.minPadLane,
      Math.min(input.maxPadLane, input.cursorLane),
    );
    laneDelta = clamped - input.anchorLane;
  }
  return {tickDelta, laneDelta};
}
