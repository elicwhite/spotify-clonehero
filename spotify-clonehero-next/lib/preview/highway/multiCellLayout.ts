// Pure geometry + texture-sharing helpers for the multi-cell highway grid
// (multiCell.ts). Kept free of THREE / DOM so they are trivially unit-testable
// in Jest without a WebGL context.

/** The subset of a DOMRect the viewport math needs. */
export interface CellRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** A WebGL viewport rect (bottom-up origin), plus whether it's worth drawing. */
export interface CellViewport {
  x: number;
  y: number;
  w: number;
  h: number;
  /** False when the cell has no area or is fully scrolled/clipped off-canvas. */
  visible: boolean;
}

/**
 * Convert a cell's DOM rect (top-down, relative to the viewport) into a
 * WebGL viewport rect (bottom-up origin) against a canvas that fills the
 * viewport at `canvasWidth`×`canvasHeight` CSS pixels.
 *
 * three multiplies these by the renderer's pixelRatio internally, so all
 * values are CSS pixels. A cell is `visible: false` when it has zero area or
 * lies entirely outside the canvas — the caller skips rendering it rather than
 * drawing off-screen.
 */
export function computeCellViewport(
  rect: CellRect,
  canvasWidth: number,
  canvasHeight: number,
): CellViewport {
  const w = rect.width;
  const h = rect.height;
  const visible =
    w > 0 &&
    h > 0 &&
    rect.bottom > 0 &&
    rect.top < canvasHeight &&
    rect.right > 0 &&
    rect.left < canvasWidth;
  return {
    x: rect.left,
    // Flip the top-down CSS rect to GL's bottom-up origin.
    y: canvasHeight - rect.bottom,
    w,
    h,
    visible,
  };
}

/**
 * Sharing key for a cell's loaded texture set. Cells with the same key reuse
 * one `AnimatedTextureManager` + `getTextureForNote` + highway texture (see
 * multiCell.ts). `tomStyle` only distinguishes drum cells; it's irrelevant for
 * five-fret instruments, so those key on the instrument alone. A null
 * instrument (vocals/global scope, no notes) keys as `'none'`.
 */
export function cellTextureKey(
  instrument: string | null,
  tomStyle: 'square' | 'round',
): string {
  if (instrument == null) return 'none';
  if (instrument === 'drums') return `drums:${tomStyle}`;
  return instrument;
}
