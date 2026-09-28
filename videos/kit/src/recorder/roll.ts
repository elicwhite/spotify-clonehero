/**
 * Where the chart editor's piano roll draws a song time. The recorder's
 * scripts aim input with it and films place overlays with it, so both read
 * the roll the same way. No imports: Node scripts load it too.
 */

/** A piano-roll view: song ms `leftMs` is drawn at x `originX` (CSS px), `pxPerMs` wide per ms. */
export interface RollView {
  originX: number;
  leftMs: number;
  pxPerMs: number;
}

/** x (CSS px) of song time `songMs` in a roll view. */
export const rollX = (view: RollView, songMs: number): number =>
  view.originX + (songMs - view.leftMs) * view.pxPerMs;
