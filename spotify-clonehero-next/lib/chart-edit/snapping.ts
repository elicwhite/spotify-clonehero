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
 * `gridDivision` is subdivisions per whole note (4 = quarter notes, 16 =
 * sixteenths); `0` means free placement (no snap). The grid step is rounded
 * to an integer tick count so the lattice stays on whole ticks. The result
 * is clamped to `>= 0` — ticks are never negative.
 */
export function snapTickToGrid(
  rawTick: number,
  resolution: number,
  gridDivision: number,
): number {
  if (gridDivision === 0) return Math.max(0, Math.round(rawTick));
  const gridSize = Math.round(resolution / gridDivision);
  if (gridSize <= 0) return Math.max(0, Math.round(rawTick));
  return Math.max(0, Math.round(rawTick / gridSize) * gridSize);
}
