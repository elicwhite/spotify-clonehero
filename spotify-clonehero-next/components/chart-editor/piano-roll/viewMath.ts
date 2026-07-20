/**
 * Pure view-math for the piano-roll timeline (plan 0062 §2/§3).
 *
 * The x-axis is real time: `x = (ms - leftMs) * pxPerMs`. The waveform is the
 * fixed reference — a tempo edit moves the grid, never the waveform — so every
 * screen position is derived from a millisecond value, never a tick directly.
 *
 * No React, no canvas: these are the testable primitives behind the panel's
 * zoom (anchored at the cursor), pan, visible-range culling, catch-up
 * playhead follow, and zoom-adaptive glyph sizing.
 */

/** Horizontal view transform: what ms sits at the left edge and the scale. */
export interface PianoRollView {
  /** Millisecond value at the left edge (x = 0) of the viewport. */
  leftMs: number;
  /** Horizontal scale in pixels per millisecond. */
  pxPerMs: number;
}

/** Pixels per ms at "100%" zoom — the readout's reference scale. */
export const BASE_PX_PER_MS = 0.075;
/** Zoom-in multiple from base (roughly 15× in per §3). */
export const ZOOM_IN_FACTOR = 15;
/** Wheel-to-zoom exponential rate (matches the mockup's feel). */
export const ZOOM_WHEEL_RATE = 0.0022;

/** Zoom-out/zoom-in px-per-ms bounds for a given viewport + song length. */
export interface ZoomBounds {
  min: number;
  max: number;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Px-per-ms bounds. The minimum is exactly the fit-to-width scale, so the
 * user can never zoom out further than the whole song filling the viewport
 * width (§3's "the zoom range always permits full-song visibility" — and
 * never past it). `min` is also clamped to `max` for the degenerate case of
 * a very short song / narrow viewport where `fit` would otherwise exceed it.
 */
export function zoomBounds(viewportWidth: number, totalMs: number): ZoomBounds {
  const fit = totalMs > 0 ? viewportWidth / totalMs : BASE_PX_PER_MS;
  const max = BASE_PX_PER_MS * ZOOM_IN_FACTOR;
  return {
    min: Math.min(fit, max),
    max,
  };
}

/** Screen x for a millisecond value under a view. */
export function msToX(ms: number, view: PianoRollView): number {
  return (ms - view.leftMs) * view.pxPerMs;
}

/** Millisecond value at a screen x under a view. */
export function xToMs(x: number, view: PianoRollView): number {
  return view.leftMs + x / view.pxPerMs;
}

/** Visible `[startMs, endMs]` range for a viewport width. */
export function visibleMsRange(
  view: PianoRollView,
  viewportWidth: number,
): [number, number] {
  return [view.leftMs, view.leftMs + viewportWidth / view.pxPerMs];
}

/**
 * Clamp `leftMs` so the view can't scroll arbitrarily far past the song. A
 * little slack on the left (5% of a viewport) and the right (keeps at least
 * half a viewport of song visible) mirrors the mockup.
 */
export function clampLeftMs(
  leftMs: number,
  viewportWidth: number,
  totalMs: number,
  pxPerMs: number,
): number {
  const visible = viewportWidth / pxPerMs;
  const lo = -visible * 0.05;
  const hi = Math.max(lo, totalMs - visible * 0.5);
  return clamp(leftMs, lo, hi);
}

/**
 * Exponential zoom anchored at the pointer: the ms under `offsetX` stays fixed
 * as the scale changes (§3). `deltaY` is the wheel delta (negative = zoom in).
 * The result is clamped to `bounds` and its `leftMs` re-clamped to the song.
 */
export function zoomAt(
  view: PianoRollView,
  offsetX: number,
  deltaY: number,
  viewportWidth: number,
  totalMs: number,
  bounds: ZoomBounds,
): PianoRollView {
  const anchorMs = xToMs(offsetX, view);
  const pxPerMs = clamp(
    view.pxPerMs * Math.exp(-deltaY * ZOOM_WHEEL_RATE),
    bounds.min,
    bounds.max,
  );
  const leftMs = clampLeftMs(
    anchorMs - offsetX / pxPerMs,
    viewportWidth,
    totalMs,
    pxPerMs,
  );
  return {leftMs, pxPerMs};
}

/** Pan the view by a pixel delta (positive = content moves left / scroll right). */
export function panByPx(
  view: PianoRollView,
  deltaPx: number,
  viewportWidth: number,
  totalMs: number,
): PianoRollView {
  const leftMs = clampLeftMs(
    view.leftMs + deltaPx / view.pxPerMs,
    viewportWidth,
    totalMs,
    view.pxPerMs,
  );
  return {...view, leftMs};
}

/** A view that fits the whole song in the viewport (initial state). */
export function fitToWidth(
  viewportWidth: number,
  totalMs: number,
): PianoRollView {
  const bounds = zoomBounds(viewportWidth, totalMs);
  const pxPerMs = clamp(
    totalMs > 0 ? viewportWidth / totalMs : BASE_PX_PER_MS,
    bounds.min,
    bounds.max,
  );
  return {leftMs: 0, pxPerMs};
}

/** Zoom percentage for the readout (100% == {@link BASE_PX_PER_MS}). */
export function zoomPercent(pxPerMs: number): number {
  return Math.round((pxPerMs / BASE_PX_PER_MS) * 100);
}

export interface FollowInput {
  /** Current playhead position in ms. */
  playheadMs: number;
  /** Current left edge. */
  leftMs: number;
  pxPerMs: number;
  viewportWidth: number;
  /** Viewport fraction the playhead pins at while following (0..1). */
  anchorFraction: number;
  totalMs: number;
}

/**
 * Catch-up follow (§3). Returns the new `leftMs`:
 *
 * - The playhead travels freely from wherever it is; the view stays still
 *   until the playhead reaches the anchor x, then scrolls to pin it there.
 * - Hitting play never moves the view (the caller only calls this while
 *   following; the anchor is measured from the current `leftMs`).
 * - If the playhead is entirely off-screen, snap once to place it at the
 *   anchor.
 *
 * Returns `leftMs` unchanged when the view should stay put.
 */
export function followLeftMs(input: FollowInput): number {
  const {playheadMs, leftMs, pxPerMs, viewportWidth, anchorFraction, totalMs} =
    input;
  const visible = viewportWidth / pxPerMs;
  const anchorMs = leftMs + visible * anchorFraction;
  const offscreen = playheadMs < leftMs || playheadMs > leftMs + visible;
  if (playheadMs > anchorMs || offscreen) {
    return clampLeftMs(
      playheadMs - visible * anchorFraction,
      viewportWidth,
      totalMs,
      pxPerMs,
    );
  }
  return leftMs;
}

export interface GlyphWidthInput {
  /** Ticks in one grid step (e.g. `resolution / gridDivision`). */
  gridStepTicks: number;
  /** Local ms-per-tick at the note's position (from the tempo map). */
  msPerTick: number;
  pxPerMs: number;
  /** Full glyph height — the upper clamp so glyphs never exceed the lane. */
  glyphHeight: number;
}

/** Minimum on-screen glyph width when zoomed far out (density sliver). */
export const MIN_GLYPH_WIDTH = 1.5;

/**
 * Zoom-adaptive note width (§5): the glyph tracks the on-screen 1/grid
 * spacing, clamped to `[MIN_GLYPH_WIDTH, glyphHeight]`. Zoomed out it becomes
 * a thin sliver; zoomed in it fills to a full glyph.
 */
export function glyphWidth(input: GlyphWidthInput): number {
  const {gridStepTicks, msPerTick, pxPerMs, glyphHeight} = input;
  const raw = gridStepTicks * msPerTick * pxPerMs * 0.72;
  return clamp(raw, MIN_GLYPH_WIDTH, glyphHeight);
}
