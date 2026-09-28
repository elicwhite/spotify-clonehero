/**
 * A seeded field of drifting particles that wraps around its area, so it
 * never drifts off screen however long it runs: the positions behind Bokeh
 * and the end card's dust. A pure function of the film frame.
 */
import {mix, mod, rand, wave} from '../motion';

export interface ParticleFieldOptions {
  seed: string;
  count: number;
  /**
   * `[left, top, right, bottom]`, px: particles start anywhere in it and wrap
   * around its edges (a particle, sway and all, leaves completely before it
   * re-enters).
   */
  area: readonly [number, number, number, number];
  /** Drift, px per second, at speed 1 and depth 1. */
  drift: readonly [number, number];
  /** Each particle's speed multiplier, picked in this range (default 1). */
  speed?: readonly [number, number];
  /** Depths particles pick from (default [1]): a depth scales drift and sway. */
  depths?: readonly number[];
  /** Diameter range, px. */
  size: readonly [number, number];
  /** A sideways sway: amplitude range (px) and period range (seconds). Default none. */
  sway?: {
    amplitude: readonly [number, number];
    periodSec: readonly [number, number];
  };
  /** Twinkle period range, seconds (default: no twinkle). */
  twinkleSec?: readonly [number, number];
  /** Colours particles pick from. */
  colors: readonly string[];
}

export interface Particle {
  x: number;
  y: number;
  /** Diameter, px. */
  size: number;
  color: string;
  depth: number;
  /** 0..1 brightness of the twinkle now (1 without one). */
  twinkle: number;
  /** A stable random 0..1 of this particle, for its look. */
  r: number;
}

/** Every particle of the field at film frame `frame`. */
export const particleField = (
  frame: number,
  fps: number,
  o: ParticleFieldOptions,
): Particle[] => {
  const t = frame / fps;
  const [x0, y0, x1, y1] = o.area;
  const depths = o.depths ?? [1];
  const [s0, s1] = o.speed ?? [1, 1];
  return Array.from({length: o.count}, (_, i) => {
    const r = (key: string) => rand(o.seed, key, i);
    const size = mix(o.size[0], o.size[1], r('size'));
    const depth = depths[Math.floor(r('depth') * depths.length)] ?? 1;
    const speed = mix(s0, s1, r('speed')) * depth;
    const swayAmp = o.sway
      ? mix(o.sway.amplitude[0], o.sway.amplitude[1], r('sway')) * depth
      : 0;
    const sway = o.sway
      ? swayAmp *
        wave(
          t,
          mix(o.sway.periodSec[0], o.sway.periodSec[1], r('swayPeriod')),
          r('swayPhase') * 2 * Math.PI,
        )
      : 0;
    const twinkle = o.twinkleSec
      ? 0.5 +
        0.5 *
          wave(
            t,
            mix(o.twinkleSec[0], o.twinkleSec[1], r('twinkle')),
            r('twinklePhase') * 2 * Math.PI,
          )
      : 1;
    // Wrap with a margin of the particle's size on every side, and its
    // widest sway across, so it is out of sight whenever it wraps.
    const marginX = size + swayAmp;
    const left = x0 - marginX;
    const top = y0 - size;
    const spanX = x1 - x0 + 2 * marginX;
    const spanY = y1 - y0 + 2 * size;
    const x =
      left + mod(mix(x0, x1, r('x')) + o.drift[0] * speed * t - left, spanX);
    const y =
      top + mod(mix(y0, y1, r('y')) + o.drift[1] * speed * t - top, spanY);
    return {
      x: x + sway,
      y,
      size,
      color: o.colors[Math.floor(r('color') * o.colors.length)] ?? '#ffffff',
      depth,
      twinkle,
      r: r('look'),
    };
  });
};
