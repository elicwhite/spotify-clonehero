/**
 * The app highway's floor, in its world units: X across the highway, Y along
 * it toward the future, the floor at z = 0. The app keeps these values inside
 * its renderer, so they are written down here once. This file has no
 * imports: Node scripts (the highway sync check in scripts/qa) read it too.
 * highwayGeometry.ts checks the ones the app exports against its own at load.
 */

export type HighwayInstrument = 'drums' | 'guitar';

/**
 * The floor a track is drawn on: drums on the four-lane drum highway, every
 * other instrument on the five-fret one.
 */
export const highwayInstrumentOf = (track: {
  instrument: string;
}): HighwayInstrument => (track.instrument === 'drums' ? 'drums' : 'guitar');

/** World units a note travels per song second (APP/lib/preview/highway/stage.ts `HIGHWAY_SPEED`). */
export const HIGHWAY_SPEED = 1.5;

/** World Y of the strikeline (APP/lib/preview/highway/cameraFit.ts `STRIKELINE_WORLD_Y`). */
export const STRIKELINE_Y = -1;

/**
 * World Y of the floor's near edge: the floor plane runs a tenth of a unit
 * past the strikeline toward the camera, under the fret buttons
 * (APP/lib/preview/highway/HighwayScene.ts `createHighway`).
 */
export const FLOOR_NEAR_Y = -1.1;

/** World Y of the far end of the drawn highway (APP/lib/preview/highway/cell.ts clipping planes). */
export const FLOOR_FAR_Y = 0.9;

/**
 * Half the floor's width (APP/lib/chart-edit/instruments: `highwayWidth / 2`
 * of the four-lane drum schema and the five-fret schema).
 */
export const FLOOR_HALF_WIDTH: Readonly<Record<HighwayInstrument, number>> = {
  drums: 0.45,
  guitar: 0.55,
};

/** A point on the floor, in world units. */
export interface FloorPoint {
  X: number;
  Y: number;
}

/** World Y of a note at `noteSec` while the strikeline shows `nowSec` (both song seconds). */
export const noteWorldY = (noteSec: number, nowSec: number): number =>
  (noteSec - nowSec) * HIGHWAY_SPEED + STRIKELINE_Y;

/**
 * The floor's corners between two world Ys (default: the whole floor), in
 * the order a `Quad` lists its screen images: far-left, far-right,
 * near-right, near-left.
 */
export const floorCorners = (
  instrument: HighwayInstrument,
  nearY: number = FLOOR_NEAR_Y,
  farY: number = FLOOR_FAR_Y,
): readonly [FloorPoint, FloorPoint, FloorPoint, FloorPoint] => {
  const half = FLOOR_HALF_WIDTH[instrument];
  return [
    {X: -half, Y: farY},
    {X: half, Y: farY},
    {X: half, Y: nearY},
    {X: -half, Y: nearY},
  ];
};
