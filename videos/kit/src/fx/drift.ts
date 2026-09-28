/**
 * Slow motion that keeps a hold alive: a parallax float for a layer and beat
 * punch-ins for a camera. Pure functions of the film frame.
 */
import {ease} from '../brand/ease';
import type {Format} from '../format';
import {progress, rand, wave, type Vec2} from '../motion';

export interface FloatOptions {
  /** Multiplier on the drift (default 1: 8 x 5 reference px). */
  amount?: number;
  /** Any seed; layers with different seeds drift out of step. */
  seed?: string | number;
}

/**
 * A slow parallax float, so nothing on screen ever sits dead still: an
 * ellipse of 8 x 5 reference px traced over about 8 and 11 seconds.
 */
export const floatXY = (
  frame: number,
  {fps, unit}: Pick<Format, 'fps' | 'unit'>,
  {amount = 1, seed = 0}: FloatOptions = {},
): Vec2 => {
  const t = frame / fps;
  const px = rand(seed, 'float-x') * Math.PI * 2;
  const py = rand(seed, 'float-y') * Math.PI * 2;
  return {
    x: 8 * unit * amount * wave(t, 7.96, px),
    y: 5 * unit * amount * wave(t, 11.1, py),
  };
};

/** `floatXY` as a CSS translate. */
export const floatTransform = (
  frame: number,
  format: Pick<Format, 'fps' | 'unit'>,
  o?: FloatOptions,
): string => {
  const {x, y} = floatXY(frame, format, o);
  return `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px)`;
};

/**
 * Beat punch-ins: a scale that steps in by `amount` on each listed film frame
 * with a quick ease (`riseSec`), so a two-bar hold still cuts on every beat.
 * Multiply it into a layer's scale.
 */
export const punch = (
  frame: number,
  at: readonly number[],
  fps: number,
  amount = 0.018,
  riseSec = 0.1,
): number =>
  1 +
  at.reduce(
    (sum, f) => sum + amount * ease.enter(progress(frame, f, riseSec * fps)),
    0,
  );
