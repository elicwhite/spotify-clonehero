/**
 * Ballistic flight with linear drag, in closed form.
 */

export interface BallisticState {
  /** Offset from the launch point, px. */
  x: number;
  y: number;
  /** Velocity, px per second. */
  vx: number;
  vy: number;
}

/**
 * Where a thrown or dropped thing is `tSec` after release, with linear drag
 * (1/s) and gravity (px/s^2, positive = down). Exact at any frame:
 * `ballistic((frame - dropAt) / fps, {vx: 80, vy: -240, gravity: 2200, drag: 1.2})`.
 */
export const ballistic = (
  tSec: number,
  o: {vx?: number; vy?: number; gravity?: number; drag?: number},
): BallisticState => {
  const vx0 = o.vx ?? 0;
  const vy0 = o.vy ?? 0;
  const g = o.gravity ?? 1400;
  const k = Math.max(1e-4, o.drag ?? 0);
  const t = Math.max(0, tSec);
  const ek = Math.exp(-k * t);
  return {
    x: (vx0 / k) * (1 - ek),
    y: (vy0 / k) * (1 - ek) + (g / k) * t - (g / (k * k)) * (1 - ek),
    vx: vx0 * ek,
    vy: vy0 * ek + (g / k) * (1 - ek),
  };
};
