// ---------------------------------------------------------------------------
// Stage layout
// ---------------------------------------------------------------------------
//
// Pure geometry for the side-by-side highway strip. No THREE, no DOM: given a
// canvas size and a highway count it returns one rect per highway, plus the
// number of highways that canvas width can legibly hold.
//
// One `StageLayout` object feeds both consumers -- the DOM interaction
// overlays and the GL viewport/scissor rects -- so the two can never disagree
// by a pixel.
//
// What camera renders a highway inside one of these rects is the other half of
// the same job, and lives next door in `cameraFit.ts`.

/** Narrowest highway that stays legible and clickable, in CSS pixels. */
export const MIN_HIGHWAY_PX = 200;

/** Hairline separating adjacent highways, in CSS pixels. */
export const HIGHWAY_GAP_PX = 1;

/**
 * Ceiling on simultaneous highways regardless of available width. Per-frame
 * CPU is linear in the highway count, and the Chart Matrix needs a bound to
 * render its "+N more" chip against.
 */
export const MAX_HIGHWAYS = 6;

/** A rect in DOM space: top-left origin, CSS pixels. */
export interface HighwayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StageLayout {
  canvas: {width: number; height: number};
  /** One rect per requested highway, left to right. */
  highways: HighwayRect[];
  /** How many highways this canvas width can hold, in `[1, MAX_HIGHWAYS]`. */
  maxHighways: number;
  /**
   * False when the canvas width is 0 or non-finite -- i.e. nothing has been
   * measured yet, or the environment has no layout at all (jsdom). In that
   * state the rects are degenerate and `maxHighways` falls back to
   * `MAX_HIGHWAYS` so highway routing behaves as it does at full width.
   */
  measured: boolean;
}

export interface StageLayoutInput {
  canvasWidth: number;
  canvasHeight: number;
  highwayCount: number;
}

function sanitizeSize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Largest `n` satisfying `n * MIN_HIGHWAY_PX + (n - 1) * HIGHWAY_GAP_PX <=
 * canvasWidth`. The denominator is gap-inclusive; adding one gap to the
 * numerator accounts for the strip having one fewer gap than highways.
 */
function fitsInWidth(canvasWidth: number): number {
  const fits = Math.floor(
    (canvasWidth + HIGHWAY_GAP_PX) / (MIN_HIGHWAY_PX + HIGHWAY_GAP_PX),
  );
  return Math.min(MAX_HIGHWAYS, Math.max(1, fits));
}

/**
 * Lay out `highwayCount` highways across the canvas.
 *
 * Highways split the width evenly after the gaps are subtracted, so the rects
 * tile the canvas exactly: widths plus gaps sum to the canvas width, and no
 * two rects overlap. Interior boundaries are rounded to whole pixels while the
 * final boundary is exact, so an integer canvas width yields integer widths.
 *
 * `highwayCount` is not clamped to `maxHighways` -- the caller slices its
 * highway list against `maxHighways` first, and a count above it simply
 * produces rects narrower than `MIN_HIGHWAY_PX`.
 */
export function computeStageLayout(input: StageLayoutInput): StageLayout {
  const canvasWidth = sanitizeSize(input.canvasWidth);
  const canvasHeight = sanitizeSize(input.canvasHeight);
  const count = Number.isFinite(input.highwayCount)
    ? Math.max(0, Math.floor(input.highwayCount))
    : 0;
  const canvas = {width: canvasWidth, height: canvasHeight};

  if (canvasWidth === 0) {
    return {
      canvas,
      highways: Array.from({length: count}, () => ({
        x: 0,
        y: 0,
        width: 0,
        height: canvasHeight,
      })),
      maxHighways: MAX_HIGHWAYS,
      measured: false,
    };
  }

  const maxHighways = fitsInWidth(canvasWidth);
  if (count === 0) {
    return {canvas, highways: [], maxHighways, measured: true};
  }

  const totalGap = (count - 1) * HIGHWAY_GAP_PX;
  const available = canvasWidth - totalGap;
  // A count past the cap can drive `available` negative; clamp so widths stay
  // non-negative and the rects stay ordered.
  const usable = Math.max(0, available);

  const boundary = (i: number): number =>
    i === count ? usable : Math.round((i * usable) / count);

  const highways: HighwayRect[] = [];
  for (let i = 0; i < count; i++) {
    const start = boundary(i);
    const end = boundary(i + 1);
    highways.push({
      x: start + i * HIGHWAY_GAP_PX,
      y: 0,
      width: end - start,
      height: canvasHeight,
    });
  }

  return {canvas, highways, maxHighways, measured: true};
}

/**
 * Convert a DOM rect (top-left origin) to a GL rect (bottom-left origin).
 * Self-inverse for a given canvas height, so it is also the GL-to-DOM
 * conversion.
 */
export function toGlRect(r: HighwayRect, canvasHeight: number): HighwayRect {
  return {
    x: r.x,
    y: canvasHeight - r.y - r.height,
    width: r.width,
    height: r.height,
  };
}
