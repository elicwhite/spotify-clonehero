/**
 * The composition's format, pure: frame rate and size always come from the
 * composition (`useFormat` in ./useFormat.ts reads them), never from a
 * constant, so the same scene renders at any fps and size. Helpers take fps
 * as a parameter. No runtime imports, so Node code and the brand tokens
 * import this file directly.
 */
import type {Rect} from '../motion/geometry';

/** Sizes in the brand tokens are px on a frame whose short side is this long. */
export const REFERENCE_SHORT_SIDE = 1080;

/** The title-safe margin on every side, reference px: nothing important crosses it. */
export const SAFE_MARGIN = 96;

export interface Format {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  /** One reference px in this composition's px: min(width, height) / 1080. */
  unit: number;
  /** The frame's centre. */
  cx: number;
  cy: number;
  /** width / height */
  aspect: number;
  /** The title-safe box, px: the frame inset by `SAFE_MARGIN` reference px on every side. */
  safe: Rect;
  /** `safe.width`: the widest anything important may be, px. */
  safeWidth: number;
}

/** The format of a composition config. */
export const formatOf = ({
  fps,
  width,
  height,
  durationInFrames,
}: Pick<Format, 'fps' | 'width' | 'height' | 'durationInFrames'>): Format => {
  const unit = Math.min(width, height) / REFERENCE_SHORT_SIDE;
  const margin = SAFE_MARGIN * unit;
  const safe: Rect = {
    x: margin,
    y: margin,
    width: width - 2 * margin,
    height: height - 2 * margin,
  };
  return {
    fps,
    width,
    height,
    durationInFrames,
    unit,
    cx: width / 2,
    cy: height / 2,
    aspect: width / height,
    safe,
    safeWidth: safe.width,
  };
};

/** Frames to seconds. */
export const toSec = (frames: number, fps: number): number => frames / fps;

/** Seconds to frames, unrounded (fractional frames are valid everywhere in the kit). */
export const toFrames = (sec: number, fps: number): number => sec * fps;
