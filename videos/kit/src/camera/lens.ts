/**
 * The lens every plane-camera view is seen through: where the eye looks (the
 * CSS perspective origin) and how far it sits from the screen (the CSS
 * perspective distance). Both default from the frame, so the same poses read
 * the same at any size.
 */
import {useFormat} from '../format';
import type {Point} from '../motion';

export interface Lens {
  /** Distance from the eye to the screen, px (CSS `perspective`). */
  perspective: number;
  /** The point the eye looks at, px (CSS `perspective-origin`). */
  origin: Point;
}

export interface LensOptions {
  /** Perspective distance in px. Wins over `fov`. */
  perspective?: number;
  /** Vertical field of view in degrees (the perspective is derived from the frame height). */
  fov?: number;
  /** Default: the frame centre. */
  origin?: Point;
}

/**
 * The default lens depth, in frame heights: a vertical field of view of about
 * 26 degrees, a moderate tele that reads as 3D without bending type on the
 * plane.
 */
export const LENS_DEPTH = 2.2;

/** The lens for a `width` x `height` frame. */
export const lensFor = (
  frame: {width: number; height: number},
  o: LensOptions = {},
): Lens => ({
  perspective:
    o.perspective ??
    (o.fov !== undefined
      ? frame.height / 2 / Math.tan((o.fov * Math.PI) / 360)
      : LENS_DEPTH * frame.height),
  origin: o.origin ?? {x: frame.width / 2, y: frame.height / 2},
});

/** The lens for the current composition. */
export const useLens = (o: LensOptions = {}): Lens => lensFor(useFormat(), o);
