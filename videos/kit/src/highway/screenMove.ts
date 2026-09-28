/**
 * A 2D move of the screen after the highway is drawn: scale and rotate
 * about a pivot, then translate. The highway is only ever moved this way,
 * so it stays in the player's perspective; `WarpedHighway` takes the moved
 * floor quad as its target. Pure.
 */
import {
  compose,
  rotateZ,
  scale3d,
  transformPoint,
  translate3d,
  type Mat4,
} from '../camera/matrix';
import {mapQuad, type Point, type Quad} from '../motion';

export interface ScreenMove {
  scale: number;
  /** Degrees, clockwise on screen. */
  rotate: number;
  /** Pivot of the scale and rotation, px. */
  origin: Point;
  /** Translation after the scale and rotation, px. */
  x: number;
  y: number;
}

const moveMatrix = (m: ScreenMove): Mat4 =>
  compose(
    translate3d(m.origin.x + m.x, m.origin.y + m.y),
    rotateZ(m.rotate),
    scale3d(m.scale, m.scale),
    translate3d(-m.origin.x, -m.origin.y),
  );

/** A quad moved by `m`. */
export const moveQuad = (m: ScreenMove, q: Quad): Quad => {
  const matrix = moveMatrix(m);
  return mapQuad(q, p => {
    const moved = transformPoint(matrix, p);
    return {x: moved.x, y: moved.y};
  });
};
