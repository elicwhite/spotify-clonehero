/**
 * The plane camera. A pose pins a point of a flat plane (an app screen, a
 * card, a window: anything laid out in its own px) to a point on screen, then
 * scales and turns the plane about it. Seen through a `Lens`, a pose is exactly
 * the CSS transform the browser draws, so `project` lands overlays on the
 * pixels of the plane.
 *
 * The same model places single elements that carry their own full transform
 * (`placeOnPlane`): each keeps its own blend mode, filter and opacity, and all
 * of them still project as one plane.
 *
 * Pure functions, no React.
 */
import type {CSSProperties} from 'react';
import type {Point, Rect} from '../motion';
import type {Lens} from './lens';
import {
  compose,
  perspective,
  projectPoint,
  rotateX,
  rotateY,
  rotateZ,
  scale3d,
  toMatrix3d,
  translate3d,
  type Mat4,
  type PlaneProjection,
} from './matrix';

export interface Pose {
  /** The plane point the camera pins, plane px. */
  fx: number;
  fy: number;
  /** Where the pinned point lands on screen, px. */
  sx: number;
  sy: number;
  /** Dolly toward the viewer, px along CSS z. At 0 the pin is exact. */
  z: number;
  /** Plane scale about the pinned point. */
  s: number;
  /** Rotations about the pinned point, degrees (CSS order: rotateX rotateY rotateZ). */
  rx: number;
  ry: number;
  rz: number;
  /** Blur outside the sharp ellipse around (sx, sy), px (depth of field). */
  dof: number;
  /** Vertical radius of the sharp ellipse, screen px. */
  focusR: number;
  /** Blur over the whole plane (rack focus), px. */
  blur: number;
  /** Plane brightness, 0..1. */
  light: number;
}

const POSE_KEYS = [
  'fx',
  'fy',
  'sx',
  'sy',
  'z',
  's',
  'rx',
  'ry',
  'rz',
  'dof',
  'focusR',
  'blur',
  'light',
] as const satisfies readonly (keyof Pose)[];

/** The fraction of the frame height the sharp ellipse covers by default. */
const FOCUS_RADIUS = 0.65;

/**
 * No move: plane point `at` (default the frame centre) stays at the same
 * screen point, sharp and fully lit. The base of most camera paths.
 */
export const restPose = (
  frame: {width: number; height: number},
  at: Point = {x: frame.width / 2, y: frame.height / 2},
): Pose => ({
  fx: at.x,
  fy: at.y,
  sx: at.x,
  sy: at.y,
  z: 0,
  s: 1,
  rx: 0,
  ry: 0,
  rz: 0,
  dof: 0,
  focusR: FOCUS_RADIUS * frame.height,
  blur: 0,
  light: 1,
});

/** Linear mix of every field: `a` at t = 0, `b` at t = 1. */
export const mixPose = (a: Pose, b: Pose, t: number): Pose => {
  const out = {...a};
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
};

/** The pose as a matrix over plane coordinates, before the lens. */
const poseMatrix = (p: Pose): Mat4 =>
  compose(
    translate3d(p.sx, p.sy, p.z),
    rotateX(p.rx),
    rotateY(p.ry),
    rotateZ(p.rz),
    scale3d(p.s, p.s, p.s),
    translate3d(-p.fx, -p.fy),
  );

// ---------------------------------------------------------------------------
// Pieces placed on the plane
// ---------------------------------------------------------------------------

/**
 * A piece's own move off its slot: an offset (plane px, `dz` toward the
 * viewer), rotations about the piece's centre (degrees) and a scale.
 */
export interface Local {
  dx: number;
  dy: number;
  dz: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
}

export const IDENTITY_LOCAL: Local = {
  dx: 0,
  dy: 0,
  dz: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  s: 1,
};

export const mixLocal = (a: Local, b: Local, t: number): Local => ({
  dx: a.dx + (b.dx - a.dx) * t,
  dy: a.dy + (b.dy - a.dy) * t,
  dz: a.dz + (b.dz - a.dz) * t,
  rx: a.rx + (b.rx - a.rx) * t,
  ry: a.ry + (b.ry - a.ry) * t,
  rz: a.rz + (b.rz - a.rz) * t,
  s: a.s + (b.s - a.s) * t,
});

/**
 * The whole plane folded rigidly about the horizontal line y = `axisY`
 * (plane px) by `rx` degrees: everything on it turns together, like a card
 * folding shut.
 */
export interface Fold {
  axisY: number;
  rx: number;
}

export interface Placement {
  /** The piece's slot on the plane, plane px. */
  box: Rect;
  local?: Local;
  fold?: Fold;
}

const localMatrix = (l: Local, box: Rect): Mat4 => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return compose(
    translate3d(l.dx + cx, l.dy + cy, l.dz),
    rotateX(l.rx),
    rotateY(l.ry),
    rotateZ(l.rz),
    scale3d(l.s, l.s, 1),
    translate3d(-cx, -cy),
  );
};

const foldMatrix = (f: Fold): Mat4 =>
  compose(translate3d(0, f.axisY), rotateX(f.rx), translate3d(0, -f.axisY));

/**
 * The one matrix of the plane camera: plane px (on a placed piece, when
 * `placement` is given) to screen px, perspective included (divide by w).
 * `placeOnPlane` draws with it and `project` measures with it, so what is
 * drawn and what is measured cannot drift apart.
 */
export const planeMatrix = (
  pose: Pose,
  lens: Lens,
  placement?: Placement,
): Mat4 => {
  const o = lens.origin;
  const chain: Mat4[] = [
    translate3d(o.x, o.y),
    perspective(lens.perspective),
    translate3d(-o.x, -o.y),
    poseMatrix(pose),
  ];
  if (placement?.fold) chain.push(foldMatrix(placement.fold));
  if (placement?.local) chain.push(localMatrix(placement.local, placement.box));
  return compose(...chain);
};

/**
 * Style for an element occupying `box` on the plane, seen through `pose` and
 * `lens`, folded with the plane by `fold` and moved off its slot by `local`:
 * `planeMatrix` as a CSS `matrix3d` from the element's top-left corner. The
 * element carries its own perspective, so it needs no 3D context above it:
 * place it in any full-frame layer and draw its content at (0, 0).
 */
export const placeOnPlane = (
  pose: Pose,
  lens: Lens,
  placement: Placement,
): CSSProperties => ({
  position: 'absolute',
  left: 0,
  top: 0,
  width: placement.box.width,
  height: placement.box.height,
  transformOrigin: '0 0',
  transform: toMatrix3d(
    compose(
      planeMatrix(pose, lens, placement),
      translate3d(placement.box.x, placement.box.y),
    ),
  ),
  backfaceVisibility: 'hidden',
});

/**
 * Screen position of plane point `p` under `pose` (and, for a placed piece,
 * its fold and local move), from `planeMatrix`. `k` is the perspective scale
 * there: multiply by `pose.s` for the on-screen size of a plane px.
 */
export const project = (
  pose: Pose,
  lens: Lens,
  p: Point,
  placement?: Placement,
): PlaneProjection => projectPoint(planeMatrix(pose, lens, placement), p);

/**
 * The fold angle that turns the plane edge-on to the eye about a horizontal
 * axis the camera puts on screen row `screenY`: past 90 degrees by the angle
 * the eye looks down (or up) at that row, so the plane reads as one line.
 */
export const edgeOnFold = (screenY: number, lens: Lens): number =>
  90 + (Math.atan2(screenY - lens.origin.y, lens.perspective) * 180) / Math.PI;
