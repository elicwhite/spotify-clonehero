/**
 * Pixel checks on the product highway's canvas, for smoke tests that must
 * fail a render when the highway draws black or out of sync. Call them from
 * `ProductHighway`'s `onDraw`: the app does not preserve its drawing buffer,
 * so the canvas only holds the frame during that call.
 */
import type {Rect} from '../motion';

/**
 * A copy of a canvas's current picture: all of it, or one region (in the
 * canvas's device pixels), clamped to the canvas.
 */
export const readPixels = (
  canvas: HTMLCanvasElement,
  region?: Rect,
): ImageData => {
  const x = Math.max(0, Math.floor(region?.x ?? 0));
  const y = Math.max(0, Math.floor(region?.y ?? 0));
  const width = Math.max(
    1,
    Math.min(canvas.width - x, Math.round(region?.width ?? canvas.width)),
  );
  const height = Math.max(
    1,
    Math.min(canvas.height - y, Math.round(region?.height ?? canvas.height)),
  );
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const context = copy.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('[highway] no 2D context to read pixels with');
  context.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
};

/** Fraction of pixels whose brightest channel is above `threshold` (0-255). */
export const litFraction = (image: ImageData, threshold = 24): number => {
  const {data} = image;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (
      Math.max(
        data[i] as number,
        data[i + 1] as number,
        data[i + 2] as number,
      ) > threshold
    )
      lit++;
  }
  return lit / (data.length / 4);
};

/** Where two pictures of one region differ. */
export interface Difference {
  /** Centroid of the differing pixels, in the region's pixels. */
  x: number;
  y: number;
  /** How many pixels differ. */
  count: number;
}

/**
 * The pixels where two same-sized pictures differ by more than `threshold`
 * in some channel: their centroid and count, or null when none do. Two
 * renders of one frame, with and without one note, differ exactly where the
 * app drew that note.
 */
export const differenceOf = (
  a: ImageData,
  b: ImageData,
  threshold = 48,
): Difference | null => {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('[highway] compared pictures differ in size');
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (
        Math.abs((a.data[i] as number) - (b.data[i] as number)) > threshold ||
        Math.abs((a.data[i + 1] as number) - (b.data[i + 1] as number)) >
          threshold ||
        Math.abs((a.data[i + 2] as number) - (b.data[i + 2] as number)) >
          threshold
      ) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  return count === 0 ? null : {x: sx / count, y: sy / count, count};
};

/** Where two same-sized pictures differ at all: how many pixels, and the first one (row by row). */
export interface Mismatch {
  count: number;
  first: {x: number; y: number} | null;
}

/**
 * The pixels of two same-sized pictures that differ in any channel, with no
 * tolerance: two draws of one frame by the same renderer match exactly.
 */
export const mismatchOf = (a: ImageData, b: ImageData): Mismatch => {
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('[highway] compared pictures differ in size');
  const pa = new Uint32Array(
    a.data.buffer,
    a.data.byteOffset,
    a.width * a.height,
  );
  const pb = new Uint32Array(
    b.data.buffer,
    b.data.byteOffset,
    b.width * b.height,
  );
  let count = 0;
  let first: {x: number; y: number} | null = null;
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] === pb[i]) continue;
    count++;
    first ??= {x: i % a.width, y: Math.floor(i / a.width)};
  }
  return {count, first};
};
