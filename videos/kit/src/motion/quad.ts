/**
 * Screen quads and the projective maps between them. A plane's image on
 * screen is exactly a quad under a projective map, so `quadToQuadMatrix3d`
 * can fold a flat element onto a plane seen in perspective (a grid lying on
 * the highway's floor) or move one quad onto another. Straight lines stay
 * straight, so the warp is exact.
 */
import type {Rect, Vec2} from './geometry';

export type Point = Vec2;

/** Four corners: top-left, top-right, bottom-right, bottom-left (clockwise on screen; far-left first for a floor). */
export type Quad = readonly [Point, Point, Point, Point];

type QuadIndex = 0 | 1 | 2 | 3;

/** A quad from four corners of anything, mapped corner by corner. */
export const mapQuad = <T>(
  corners: readonly [T, T, T, T],
  f: (corner: T, i: QuadIndex) => Point,
): Quad => [
  f(corners[0], 0),
  f(corners[1], 1),
  f(corners[2], 2),
  f(corners[3], 3),
];

/** A quad moved by (dx, dy). */
export const offsetQuad = (quad: Quad, dx: number, dy: number): Quad =>
  mapQuad(quad, p => ({x: p.x + dx, y: p.y + dy}));

/** The axis-aligned box around a quad. */
export const quadBounds = (quad: Quad): Rect => {
  const xs = quad.map(p => p.x);
  const ys = quad.map(p => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
};

/** A 3x3 projective map, row-major. */
type Mat3 = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The projective map taking the unit square's corners (0,0) (1,0) (1,1) (0,1) to `q` (Heckbert). */
const squareToQuad = (q: Quad): Mat3 => {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    // A parallelogram: the map is affine.
    return [
      p1.x - p0.x,
      p3.x - p0.x,
      p0.x,
      p1.y - p0.y,
      p3.y - p0.y,
      p0.y,
      0,
      0,
      1,
    ];
  }
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
};

const multiply = (a: Mat3, b: Mat3): Mat3 => {
  const out = new Array<number>(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[r * 3 + k]! * b[k * 3 + c]!;
      out[r * 3 + c] = sum;
    }
  }
  return out;
};

/** Inverse of a projective map up to scale (the adjugate; the scale does not matter). */
const adjugate = (m: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
};

/**
 * CSS `matrix3d(...)` that maps quad `from` onto quad `to`, for an element
 * with `transform-origin: 0 0` whose own CSS pixels are the quads'
 * coordinate space.
 */
export const quadToQuadMatrix3d = (from: Quad, to: Quad): string => {
  const [a, b, c, d, e, f, g, h, i] = multiply(
    squareToQuad(to),
    adjugate(squareToQuad(from)),
  );
  const s = 1 / i;
  const values = [a, d, 0, g, b, e, 0, h, 0, 0, 1, 0, c, f, 0, i].map(
    (v, index) => (index === 10 ? v : v * s),
  );
  return `matrix3d(${values.map(v => (Math.abs(v) < 1e-12 ? 0 : v)).join(',')})`;
};
