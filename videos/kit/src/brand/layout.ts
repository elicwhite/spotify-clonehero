/**
 * The space tokens in a composition's own px, with the horizontal ones kept
 * inside its title-safe box, so a slate laid out for a landscape frame still
 * fits a portrait one.
 */
import {useFormat, type Format} from '../format';
import {clamp} from '../motion/math';
import type {Rect} from '../motion/geometry';
import {space} from './tokens';

export interface Layout {
  /** The title-safe box, px. */
  safe: Rect;
  /** A chapter slate's top-left, px: the slate tokens (or the origin given), inside the safe box. */
  slateX: number;
  slateY: number;
  /** From `slateX` to the safe box's right edge, px: the widest anything placed there may be. */
  slateWidth: number;
  /** The widest headline, px: the token's measure, cut to `slateWidth`. */
  headlineMaxWidth: number;
  /** The widest caption, px, cut the same way. */
  captionMaxWidth: number;
}

/** A slate origin of your own, px; either coordinate left out is the token's. */
export interface LayoutOrigin {
  x?: number;
  y?: number;
}

export const layoutOf = (
  {safe, unit}: Format,
  at: LayoutOrigin = {},
): Layout => {
  const right = safe.x + safe.width;
  const slateX = clamp(at.x ?? space.slateX * unit, safe.x, right);
  const slateY = clamp(
    at.y ?? space.slateY * unit,
    safe.y,
    safe.y + safe.height,
  );
  const slateWidth = right - slateX;
  return {
    safe,
    slateX,
    slateY,
    slateWidth,
    headlineMaxWidth: Math.min(space.headlineMaxWidth * unit, slateWidth),
    captionMaxWidth: Math.min(space.captionMaxWidth * unit, slateWidth),
  };
};

/** The current composition's layout, from the slate tokens or an origin of your own. */
export const useLayout = (at?: LayoutOrigin): Layout =>
  layoutOf(useFormat(), at);
