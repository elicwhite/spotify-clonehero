/**
 * Shared grid-snapping semantics for the chart editor's interaction layers
 * (plan 0062 "Two views, one store", invariant 3).
 *
 * The highway (`InteractionManager.screenToTick`) and the piano-roll timeline
 * both convert a pointer position to a snapped tick. That snap must be
 * *identical* in both views or a note dropped on the highway and the same
 * note dropped on the piano roll would land on different ticks. This is the
 * one canonical implementation both call — never a per-view copy.
 *
 * Pure: no React, no DOM, no renderer. The screen→raw-tick conversion is the
 * caller's job (each view owns its own coordinate transform); this module
 * only rounds a raw tick onto the grid lattice.
 */

/**
 * Snap a raw (unsnapped) tick to the current grid lattice.
 *
 * `gridDivision` is subdivisions per WHOLE note, which is what the snap
 * control's "1/4", "1/16" labels mean: 4 lands on quarter notes, 16 on
 * sixteenths, 12 on eighth-note triplets. `0` means free placement (no snap).
 *
 * `resolution` is ticks per QUARTER note, so a whole note spans
 * `resolution * 4` ticks and one grid step is that over `gridDivision`. The
 * step is rounded to an integer tick count so the lattice stays on whole
 * ticks; the result is clamped to `>= 0`, since ticks are never negative.
 */
export function snapTickToGrid(
  rawTick: number,
  resolution: number,
  gridDivision: number,
): number {
  if (gridDivision === 0) return Math.max(0, Math.round(rawTick));
  const gridSize = gridStepTicks(resolution, gridDivision);
  if (gridSize <= 0) return Math.max(0, Math.round(rawTick));
  return Math.max(0, Math.round(rawTick / gridSize) * gridSize);
}

/**
 * Ticks between two adjacent grid lines, under the same "subdivisions per
 * WHOLE note" reading of `gridDivision` that {@link snapTickToGrid} uses.
 * Returns 0 for free placement (`gridDivision` 0), which has no lattice.
 */
export function gridStepTicks(
  resolution: number,
  gridDivision: number,
): number {
  if (gridDivision <= 0) return 0;
  return Math.round((resolution * 4) / gridDivision);
}

/**
 * The next grid line strictly after (`direction` 1) or before (`direction`
 * -1) `currentTick`, for arrow-key cursor navigation. Free placement
 * (`gridDivision` 0) steps by a single tick. Clamped to `>= 0`.
 *
 * Shares {@link snapTickToGrid}'s lattice, so a cursor stepped here always
 * lands where a pointer dropped at the same spot would snap.
 */
export function nextGridTick(
  currentTick: number,
  direction: 1 | -1,
  resolution: number,
  gridDivision: number,
): number {
  const step = gridStepTicks(resolution, gridDivision);
  if (step <= 0) return Math.max(0, currentTick + direction);
  const snapped = snapTickToGrid(currentTick, resolution, gridDivision);
  if (direction > 0) {
    return snapped > currentTick ? snapped : snapped + step;
  }
  return Math.max(0, snapped < currentTick ? snapped : snapped - step);
}
