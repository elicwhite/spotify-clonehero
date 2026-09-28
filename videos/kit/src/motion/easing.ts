/**
 * Easings: functions from progress 0..1 to eased 0..1 (back and spring
 * shapes may overshoot). The brand's named presets (`ease.enter` ...) are
 * built on these in brand/ease.ts.
 */

export type EasingFn = (t: number) => number;

export const linear: EasingFn = t => t;

// A cubic bezier from (0,0) to (1,1) through (x1,y1) and (x2,y2), as a
// polynomial in its parameter: ((a t + b) t + c) t for each axis.
const coefficients = (p1: number, p2: number) => {
  const c = 3 * p1;
  const b = 3 * (p2 - p1) - c;
  return {a: 1 - c - b, b, c};
};

const SAMPLES = 11;
const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 1e-7;
const SUBDIVISION_MAX_ITERATIONS = 10;

/**
 * A CSS-style `cubic-bezier(x1, y1, x2, y2)` easing: for progress x, the
 * curve's y where its x equals it (found by Newton's method from a sampled
 * guess, falling back to bisection where the curve is flat).
 */
export const bezier = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): EasingFn => {
  if (!(x1 >= 0 && x1 <= 1 && x2 >= 0 && x2 <= 1)) {
    throw new Error('[motion] bezier x values must be in [0, 1]');
  }
  if (x1 === y1 && x2 === y2) return linear;
  const x = coefficients(x1, x2);
  const y = coefficients(y1, y2);
  const xAt = (t: number) => ((x.a * t + x.b) * t + x.c) * t;
  const yAt = (t: number) => ((y.a * t + y.b) * t + y.c) * t;
  const slopeAt = (t: number) => (3 * x.a * t + 2 * x.b) * t + x.c;
  const step = 1 / (SAMPLES - 1);
  const samples = Array.from({length: SAMPLES}, (_, i) => xAt(i * step));

  const tForX = (target: number): number => {
    let i = 1;
    while (i < SAMPLES - 1 && (samples[i] as number) <= target) i++;
    const lo = samples[i - 1] as number;
    const span = (samples[i] as number) - lo;
    let t = (i - 1 + (span > 0 ? (target - lo) / span : 0)) * step;
    if (slopeAt(t) >= NEWTON_MIN_SLOPE) {
      for (let k = 0; k < NEWTON_ITERATIONS; k++) {
        const slope = slopeAt(t);
        if (slope === 0) break;
        t -= (xAt(t) - target) / slope;
      }
      return t;
    }
    let a = (i - 1) * step;
    let b = i * step;
    for (let k = 0; k < SUBDIVISION_MAX_ITERATIONS; k++) {
      t = (a + b) / 2;
      const error = xAt(t) - target;
      if (Math.abs(error) <= SUBDIVISION_PRECISION) break;
      if (error > 0) b = t;
      else a = t;
    }
    return t;
  };

  return p => (p <= 0 ? 0 : p >= 1 ? 1 : yAt(tForX(p)));
};

export const inOutCubic: EasingFn = t =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const quintOut: EasingFn = t => 1 - Math.pow(1 - t, 5);
export const expoOut: EasingFn = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const sineInOut: EasingFn = t => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * An in-out cubic with a linear floor: `floor` of the move is linear, the
 * rest cubic, so the speed at either end is `floor` of the average speed
 * instead of zero. A camera that glides from key to key never fully stops.
 */
export const glide = (t: number, floor = 0.12): number =>
  floor * t + (1 - floor) * inOutCubic(t);
