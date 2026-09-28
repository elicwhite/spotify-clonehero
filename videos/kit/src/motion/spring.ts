/**
 * Springs: the closed-form damped oscillator (the same model as Remotion's
 * `spring()`), exact at any fractional time. Time is in seconds; the helpers
 * that count frames take the frame rate as a parameter. The brand's presets
 * are configs (`springs.pop` in brand/tokens).
 */

/** A damped spring: the physical constants of Remotion's `spring()`. */
export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass: number;
}

/**
 * Position of a damped spring `tSec` seconds after release, moving from
 * `from` (default 0) to `to` (default 1) with initial velocity `v0` (units
 * per second).
 */
export const springAt = (
  tSec: number,
  config: SpringConfig,
  opts: {from?: number; to?: number; v0?: number} = {},
): number => {
  const {damping: c, stiffness: k, mass: m} = config;
  const from = opts.from ?? 0;
  const to = opts.to ?? 1;
  if (tSec <= 0) return from;
  const v0 = opts.v0 ?? 0;
  const d = from - to;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const env = Math.exp(-zeta * w0 * tSec);
    return (
      to +
      env *
        (d * Math.cos(wd * tSec) +
          ((v0 + zeta * w0 * d) / wd) * Math.sin(wd * tSec))
    );
  }
  if (zeta === 1) {
    return to + Math.exp(-w0 * tSec) * (d + (v0 + w0 * d) * tSec);
  }
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const c2 = (v0 - r1 * d) / (r2 - r1);
  const c1 = d - c2;
  return to + c1 * Math.exp(r1 * tSec) + c2 * Math.exp(r2 * tSec);
};

/**
 * 0 until frame `start`, then a spring toward 1 (with the config's
 * overshoot): `spring01(frame, cueFrame, springs.pop, fps)`.
 */
export const spring01 = (
  frame: number,
  start: number,
  config: SpringConfig,
  fps: number,
): number => (frame <= start ? 0 : springAt((frame - start) / fps, config));

/**
 * Seconds after which a 0 -> 1 spring released from rest is guaranteed to
 * stay within `tolerance` of 1: where an upper bound of its distance from
 * rest, decaying monotonically, falls below the tolerance.
 */
const quietAfterSec = (config: SpringConfig, tolerance: number): number => {
  const {damping: c, stiffness: k, mass: m} = config;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (!(zeta > 0) || !(w0 > 0)) {
    throw new Error('[motion] a spring without damping never settles');
  }
  if (zeta < 1) {
    // |x - 1| <= e^(-zeta w0 t) / sqrt(1 - zeta^2)
    const amplitude = 1 / Math.sqrt(1 - zeta * zeta);
    return Math.log(amplitude / tolerance) / (zeta * w0);
  }
  if (zeta === 1) {
    // |x - 1| = (1 + w0 t) e^(-w0 t) <= 2 e^(-w0 t / 2)
    return (2 * Math.log(2 / tolerance)) / w0;
  }
  // |x - 1| <= (|c1| + |c2|) e^(r1 t), r1 the slower root
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -w0 * (zeta - s);
  const r2 = -w0 * (zeta + s);
  const c2 = r1 / (r2 - r1);
  const c1 = -1 - c2;
  return Math.log((Math.abs(c1) + Math.abs(c2)) / tolerance) / -r1;
};

/** Settling longer than this is a mistake in the config, not a motion. */
const MAX_SETTLE_SEC = 600;

/**
 * Frames until a 0 -> 1 spring released on frame 0 stays within `tolerance`
 * of its target on every later frame: when its overshoot, blur or rise is
 * gone. Default tolerance 0.5%.
 */
export const settle = (
  config: SpringConfig,
  fps: number,
  tolerance = 0.005,
): number => {
  if (!(tolerance > 0)) throw new Error('[motion] settle needs tolerance > 0');
  const quiet = quietAfterSec(config, tolerance);
  if (quiet > MAX_SETTLE_SEC) {
    throw new Error(
      `[motion] the spring takes over ${MAX_SETTLE_SEC} s to settle`,
    );
  }
  const lastFrame = Math.ceil(Math.max(0, quiet) * fps);
  let lastOutside = -1;
  for (let f = 0; f <= lastFrame; f++) {
    if (Math.abs(springAt(f / fps, config) - 1) > tolerance) lastOutside = f;
  }
  return lastOutside + 1;
};
