/**
 * Scalar helpers for per-frame math. Pure; frames may be fractional.
 */

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear mix: a at t = 0, b at t = 1 (not clamped). */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Where v sits between a and b, as 0..1 (not clamped). 0 when a === b. */
const invMix = (a: number, b: number, v: number): number =>
  b === a ? 0 : (v - a) / (b - a);

/** 0 before `start`, 1 after `start + duration`, linear in between. */
export const progress = (
  frame: number,
  start: number,
  duration: number,
): number =>
  duration <= 0
    ? frame >= start
      ? 1
      : 0
    : clamp01((frame - start) / duration);

/** Hermite smoothstep of v between a and b, clamped to 0..1. */
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invMix(a, b, v));
  return t * t * (3 - 2 * t);
};

/** v wrapped into [0, m). */
export const mod = (v: number, m: number): number => ((v % m) + m) % m;

/** Central-difference derivative: units per frame of any pure function of the frame. */
export const velocity = (
  fn: (frame: number) => number,
  frame: number,
  h = 0.5,
): number => (fn(frame + h) - fn(frame - h)) / (2 * h);

/**
 * A slow sine wander, -1..1: `wave(t, 23)` drifts through one cycle every 23
 * seconds. `t` and `period` share a unit (seconds, usually); `phase` is in
 * radians, to keep several wanders out of step.
 */
export const wave = (t: number, period: number, phase = 0): number =>
  Math.sin((2 * Math.PI * t) / period + phase);
