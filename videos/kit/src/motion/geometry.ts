/**
 * 2D vectors in screen space (y down). Pure.
 */
import {mix} from './math';

export interface Vec2 {
  x: number;
  y: number;
}

/** A box: its top-left corner and size, in one coordinate space. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({x: a.x + b.x, y: a.y + b.y});
export const sub = (a: Vec2, b: Vec2): Vec2 => ({x: a.x - b.x, y: a.y - b.y});
export const scale = (a: Vec2, s: number): Vec2 => ({x: a.x * s, y: a.y * s});
export const dist = (a: Vec2, b: Vec2): number =>
  Math.hypot(a.x - b.x, a.y - b.y);
/** Unit vector along `a` (a zero vector stays zero). */
export const norm = (a: Vec2): Vec2 => {
  const l = Math.hypot(a.x, a.y) || 1;
  return {x: a.x / l, y: a.y / l};
};
/** Left-hand perpendicular (rotated -90 degrees on screen, y down). */
export const perp = (a: Vec2): Vec2 => ({x: a.y, y: -a.x});
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
});
