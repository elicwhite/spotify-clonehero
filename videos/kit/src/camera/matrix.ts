/**
 * 4x4 matrices with the same conventions as CSS transforms, so a point run
 * through them lands where the browser draws it.
 *
 * - Row-major storage: `m[row * 4 + col]`.
 * - Points are column vectors: `p' = M p`.
 * - `compose(A, B, C)` is `A * B * C`, the matrix of the CSS list
 *   `transform: A B C` (C applies to the point first).
 * - Angles are degrees, with CSS's signs: `rotateX(a)` tips +y toward +z,
 *   +z points at the viewer, and `perspective(d)` divides by `1 - z / d`.
 *
 * Pure functions, no React.
 */

/** A 4x4 matrix, row-major. */
export type Mat4 = readonly number[];

export interface Point3 {
  x: number;
  y: number;
  z?: number;
}

const DEG = Math.PI / 180;

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const at = (m: Mat4, i: number): number => m[i] as number;

/** `a * b`. */
export const multiply = (a: Mat4, b: Mat4): Mat4 => {
  const o = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        at(a, r * 4) * at(b, c) +
        at(a, r * 4 + 1) * at(b, 4 + c) +
        at(a, r * 4 + 2) * at(b, 8 + c) +
        at(a, r * 4 + 3) * at(b, 12 + c);
    }
  }
  return o;
};

/** The product of a CSS transform list, read left to right. */
export const compose = (...ms: readonly Mat4[]): Mat4 =>
  ms.reduce<Mat4>((acc, m) => multiply(acc, m), IDENTITY);

export const translate3d = (x: number, y: number, z = 0): Mat4 => [
  1,
  0,
  0,
  x,
  0,
  1,
  0,
  y,
  0,
  0,
  1,
  z,
  0,
  0,
  0,
  1,
];

export const scale3d = (x: number, y = x, z = 1): Mat4 => [
  x,
  0,
  0,
  0,
  0,
  y,
  0,
  0,
  0,
  0,
  z,
  0,
  0,
  0,
  0,
  1,
];

export const rotateX = (deg: number): Mat4 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
};

export const rotateY = (deg: number): Mat4 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
};

export const rotateZ = (deg: number): Mat4 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

/** CSS `perspective(d)`: the eye `d` px in front of the z = 0 plane. */
export const perspective = (d: number): Mat4 => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  -1 / d,
  1,
];

export interface Transformed {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** `m * (x, y, z, 1)`, before the perspective divide. */
export const transformPoint = (m: Mat4, p: Point3): Transformed => {
  const z = p.z ?? 0;
  return {
    x: at(m, 0) * p.x + at(m, 1) * p.y + at(m, 2) * z + at(m, 3),
    y: at(m, 4) * p.x + at(m, 5) * p.y + at(m, 6) * z + at(m, 7),
    z: at(m, 8) * p.x + at(m, 9) * p.y + at(m, 10) * z + at(m, 11),
    w: at(m, 12) * p.x + at(m, 13) * p.y + at(m, 14) * z + at(m, 15),
  };
};

export interface PlaneProjection {
  x: number;
  y: number;
  /** Depth before the divide (CSS z: positive toward the viewer). */
  z: number;
  /** The perspective scale at this point (1 on the z = 0 plane). */
  k: number;
}

/** `m * p` with the perspective divide. */
export const projectPoint = (m: Mat4, p: Point3): PlaneProjection => {
  const t = transformPoint(m, p);
  const k = 1 / t.w;
  return {x: t.x * k, y: t.y * k, z: t.z, k};
};

/** The matrix as CSS `matrix3d(...)` (CSS lists it column by column). */
export const toMatrix3d = (m: Mat4): string => {
  const cols: number[] = [];
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) cols.push(at(m, r * 4 + c));
  }
  return `matrix3d(${cols.map(v => (Math.abs(v) < 1e-12 ? 0 : v)).join(', ')})`;
};
