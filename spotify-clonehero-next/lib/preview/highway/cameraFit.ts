// ---------------------------------------------------------------------------
// cameraFit -- the camera that renders one highway inside one viewport rect
// ---------------------------------------------------------------------------
//
// `layout.ts` packs the canvas into rects. This module answers the question
// that follows: given a rect, what camera puts the whole highway inside it
// instead of spilling past its edges? Pure geometry -- `stage.ts` owns the
// THREE cameras and applies what this returns.

/**
 * The fixed geometry every highway camera is built from: a vertical field of
 * view, a position behind and below the strikeline, and a pitch that aims the
 * camera up the highway. `stage.ts` builds its cameras from these numbers and
 * the fit below solves against them, so the two cannot drift apart.
 */
export const HIGHWAY_CAMERA = {
  fovDeg: 90,
  y: -1.3,
  z: 0.8,
  pitchDeg: 60,
} as const;

/** World Y of the strikeline: where notes land and the frets are drawn. */
export const STRIKELINE_WORLD_Y = -1;

/**
 * Slack between the highway's outer edge and the viewport edge, as a fraction
 * of the highway's half-width, so a fitted highway does not sit flush against
 * its scissor boundary.
 */
const FIT_EDGE_MARGIN = 0.02;

/**
 * Ceiling on the widened field of view. Unreachable at any layout the stage
 * produces; it only keeps a degenerate aspect from asking for a 180-degree
 * frustum, which has no projection matrix.
 */
const MAX_FIT_FOV_DEG = 179;

const DEG = Math.PI / 180;

export interface HighwayCameraFitInput {
  /** Viewport aspect: rect width / rect height. */
  aspect: number;
  /** Half of `InstrumentSchema.highwayWidth` -- drums 0.45, five-fret 0.55. */
  halfWidth: number;
}

/** Exactly what `stage.ts` writes onto a camera, and nothing else. */
export interface HighwayCameraFit {
  /** Vertical field of view, in degrees, for `camera.fov`. */
  fovDeg: number;
  /**
   * Vertical shift in NDC to apply through the camera's off-axis view offset.
   * 0 whenever nothing had to shrink.
   */
  ndcShiftY: number;
}

/**
 * The strikeline's position in the camera's own frame: how far in front of the
 * camera it sits, and how far it sits off the view axis vertically. Both are
 * independent of X, because the camera only pitches around X -- which is why
 * one fit serves every highway on the strip.
 *
 * Exported so a caller that needs to reason about where the strikeline lands
 * (the fit tests) derives it from the same geometry rather than trusting a
 * second copy of these numbers.
 */
export function strikelineInCameraSpace(): {depth: number; viewY: number} {
  const pitch = HIGHWAY_CAMERA.pitchDeg * DEG;
  const sin = Math.sin(pitch);
  const cos = Math.cos(pitch);
  const dy = STRIKELINE_WORLD_Y - HIGHWAY_CAMERA.y;
  const dz = -HIGHWAY_CAMERA.z;
  // forward = (0, sin, -cos), up = (0, cos, sin).
  return {depth: dy * sin - dz * cos, viewY: dy * cos + dz * sin};
}

/**
 * Shrink a highway to fit the width of its own viewport.
 *
 * A perspective camera's horizontal reach is its vertical reach times the
 * viewport aspect, so a lane narrow enough to push the aspect below
 * `halfWidth / (depth * tan(fov / 2))` renders the highway wider than the
 * viewport and the outer lanes get sliced off at the scissor edge. Six
 * highways on a laptop is well inside that range.
 *
 * The fit widens the *vertical* field of view about a camera that does not
 * move. With the camera fixed, every world point keeps its projective
 * direction, so widening the frustum is an exact uniform scale-down of the
 * image: the trapezoid's shape, the note sizes relative to the highway, and
 * the fog fade all survive untouched. Pulling the camera back along its view
 * axis would fit the same width but flatten the perspective and pull the fog
 * band toward the strikeline; scaling the highway root would fit it too but
 * the clipping planes, the fog, and the grid are all world-space, so the
 * highway would clip and fade at the wrong places.
 *
 * Scaling about the frame center alone would let the strikeline drift up
 * toward the middle of the lane and leave dead space under it, so the fit also
 * reports the NDC shift that puts the strikeline back where a full-width
 * highway keeps it. `stage.ts` applies that shift as an off-axis view offset,
 * which is another image-space operation: still no camera movement, still no
 * change to perspective or fog.
 *
 * Never zooms in: an aspect wide enough to hold the highway already gets
 * exactly today's camera, so the one- and two-highway cases are untouched.
 *
 * The width is fitted at the strikeline, which is where the frets, the notes,
 * and everything else the player reads live. The floor plane keeps going a
 * tenth of a unit past it toward the camera, and that lip is nearer and so
 * projects wider: its bottom corners are the one part of a fitted highway that
 * still reaches the viewport edge. Fitting the lip instead would cost every
 * highway another 13% of its size to protect the strip of floor below the
 * strikeline.
 */
export function computeHighwayCameraFit(
  input: HighwayCameraFitInput,
): HighwayCameraFit {
  const aspect =
    Number.isFinite(input.aspect) && input.aspect > 0 ? input.aspect : 1;
  const halfWidth =
    Number.isFinite(input.halfWidth) && input.halfWidth > 0
      ? input.halfWidth
      : 0;

  const baseTan = Math.tan((HIGHWAY_CAMERA.fovDeg * DEG) / 2);
  const {depth, viewY} = strikelineInCameraSpace();
  const baseNdcY = viewY / (depth * baseTan);

  const required = halfWidth * (1 + FIT_EDGE_MARGIN);
  const baseHalfWidth = depth * baseTan * aspect;
  const zoomOut = Math.max(1, required / baseHalfWidth);
  const tan = Math.min(
    baseTan * zoomOut,
    Math.tan((MAX_FIT_FOV_DEG * DEG) / 2),
  );
  const scale = tan / baseTan;
  // The zoomed-out image puts the strikeline at `baseNdcY / scale`; shifting
  // by the difference restores it. An unfitted camera reports a plain 0 rather
  // than the -0 the expression yields, so callers can compare against 0.
  const shift = baseNdcY * (1 - 1 / scale);

  return {
    fovDeg: (2 * Math.atan(tan)) / DEG,
    ndcShiftY: shift === 0 ? 0 : shift,
  };
}
