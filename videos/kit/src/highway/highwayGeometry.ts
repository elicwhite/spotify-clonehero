import {Vector3} from 'three';
import type {NoteType} from '@eliwhite/scan-chart';
import {STRIKELINE_WORLD_Y} from '@product/lib/preview/highway/cameraFit';
import {
  createHighwayCamera,
  fitHighwayCamera,
} from '@product/lib/preview/highway/highwayCamera';
import {GEM_ANCHOR_Y} from '@product/lib/preview/highway/NoteRenderer';
import {SCALE} from '@product/lib/preview/highway/types';
import {
  computeStageLayout,
  type HighwayRect,
  type StageLayout,
} from '@product/lib/preview/highway/layout';
import {
  drums4LaneSchema,
  guitarSchema,
  type InstrumentSchema,
} from '@product/lib/chart-edit/instruments';
import {mapQuad, type Point, type Quad} from '../motion';
import {
  FLOOR_FAR_Y,
  FLOOR_HALF_WIDTH,
  FLOOR_NEAR_Y,
  floorCorners,
  noteWorldY,
  STRIKELINE_Y,
  type HighwayInstrument,
} from './floor';

/**
 * Where things on the app's highway land on screen, for overlays that must
 * sit on it (a flash on the strikeline, a ring around an edited gem) and for
 * framing the canvas from outside (crops, masks, warps). All positions are
 * CSS pixels inside a `ProductHighway` box.
 *
 * The math is the app's own: lane positions from its instrument schemas,
 * panes from `computeStageLayout`, and each pane's camera from
 * `createHighwayCamera` and `fitHighwayCamera`, the builder stage.ts gives
 * every highway.
 */

/** A drum pad lane, left to right. */
export type DrumPad = 'red' | 'yellow' | 'blue' | 'green';

/**
 * A lane on the highway: a drum pad or 'kick', or a five-fret lane (fret 0-4,
 * green..orange) or 'open'. Kick and open are full-width and centre on it.
 */
export type HighwayLane = 'kick' | DrumPad | number | 'open';

/** A box in CSS px: a `ProductHighway`'s size, or the frame a highway is drawn in. */
export interface HighwayBox {
  width: number;
  height: number;
}

const DRUM_PADS: readonly DrumPad[] = ['red', 'yellow', 'blue', 'green'];

const schemaOf = (instrument: HighwayInstrument): InstrumentSchema =>
  instrument === 'drums' ? drums4LaneSchema : guitarSchema;

// floor.ts writes these app values down for code that cannot import the app.
if (
  STRIKELINE_Y !== STRIKELINE_WORLD_Y ||
  (['drums', 'guitar'] as const).some(
    instrument =>
      FLOOR_HALF_WIDTH[instrument] !== schemaOf(instrument).highwayWidth / 2,
  )
) {
  throw new Error(
    '[highway] floor.ts does not match the app: update STRIKELINE_Y or FLOOR_HALF_WIDTH to its STRIKELINE_WORLD_Y and instrument highwayWidth.',
  );
}

const padLanes = (instrument: HighwayInstrument) =>
  schemaOf(instrument)
    .lanes.filter(definition => !definition.fullWidth)
    .sort((a, b) => a.index - b.index);

/** World X of a lane's centre; full-width lanes (kick, open) centre on the highway. */
const laneWorldX = (
  instrument: HighwayInstrument,
  lane: HighwayLane,
): number => {
  if (lane === 'kick' || lane === 'open') return 0;
  const padIndex = typeof lane === 'number' ? lane : DRUM_PADS.indexOf(lane);
  const pad = padLanes(instrument)[padIndex];
  if (!pad)
    throw new Error(
      `[highway] no ${String(lane)} lane on the ${instrument} highway`,
    );
  return pad.worldXOffset;
};

/** The lane a chart note type draws in (full-width types give 'kick' or 'open'). */
export const laneOfNoteType = (
  instrument: HighwayInstrument,
  type: NoteType,
): HighwayLane => {
  const lane = schemaOf(instrument).lanes.find(
    definition => definition.noteType === type,
  );
  if (!lane)
    throw new Error(
      `[highway] note type ${type} has no lane on the ${instrument} highway`,
    );
  if (lane.fullWidth) return instrument === 'drums' ? 'kick' : 'open';
  const padIndex = padLanes(instrument).indexOf(lane);
  if (instrument !== 'drums') return padIndex;
  const pad = DRUM_PADS[padIndex];
  if (!pad)
    throw new Error(
      `[highway] note type ${type} draws in pad lane ${padIndex}, which the four-pad drum highway lacks`,
    );
  return pad;
};

/**
 * Whether a note at `atSec` is on the drawn stretch of highway while the
 * strikeline shows `nowSec`: the app clips notes to world Y -1 (the
 * strikeline) through 0.9 (the far end, under the fog).
 */
export const isOnHighway = (atSec: number, nowSec: number): boolean => {
  const y = noteWorldY(atSec, nowSec);
  return y >= STRIKELINE_Y && y <= FLOOR_FAR_Y;
};

/** The stage layout of a `ProductHighway` box showing `paneCount` panes, as the editor lays out its strip. */
export const stageLayout = (box: HighwayBox, paneCount: number): StageLayout =>
  computeStageLayout({
    canvasWidth: box.width,
    canvasHeight: box.height,
    highwayCount: paneCount,
  });

/** The panes of a `ProductHighway` box, left to right, in the box's CSS pixels. */
export const paneRects = (box: HighwayBox, paneCount: number): HighwayRect[] =>
  stageLayout(box, paneCount).highways;

/**
 * Where points of a highway drawn in `rect` land on screen: through the
 * camera stage.ts gives that highway, built at the highway's own origin (the
 * stage puts each highway and its camera at the same world X, so
 * highway-local points project the same). Takes a floor point (world units,
 * highway-local), optionally moved `viewUp` world units up the camera's view
 * (where a camera-facing sprite puts its centre), and gives box px.
 */
const paneProjection = (
  rect: HighwayRect,
  instrument: HighwayInstrument,
): ((worldX: number, worldY: number, viewUp?: number) => Point) => {
  const camera = createHighwayCamera();
  fitHighwayCamera(camera, rect, schemaOf(instrument).highwayWidth / 2);
  camera.updateMatrixWorld();
  return (worldX, worldY, viewUp = 0) => {
    const view = new Vector3(worldX, worldY, 0).applyMatrix4(
      camera.matrixWorldInverse,
    );
    view.y += viewUp;
    const ndc = view.applyMatrix4(camera.projectionMatrix);
    return {
      x: rect.x + ((ndc.x + 1) / 2) * rect.width,
      y: rect.y + ((1 - ndc.y) / 2) * rect.height,
    };
  };
};

const paneRect = (
  box: HighwayBox,
  paneCount = 1,
  paneIndex = 0,
): HighwayRect => {
  const rect = paneRects(box, paneCount)[paneIndex];
  if (!rect) throw new Error(`[highway] no pane ${paneIndex} of ${paneCount}`);
  return rect;
};

export interface HighwayPointQuery {
  /** The `ProductHighway` box size in CSS pixels. */
  box: HighwayBox;
  /** How many panes the box shows, and which one. Default: one pane. */
  paneCount?: number;
  paneIndex?: number;
  instrument: HighwayInstrument;
  lane: HighwayLane;
  /** Song second of the point along the highway (a note's time). Default: `nowSec` (the strikeline). */
  atSec?: number;
  /** Song second at the strikeline in the frame. */
  nowSec: number;
}

/**
 * Screen position of a lane at a song time: where that note's anchor is drawn
 * in the frame (gems sit on it, kick and open bars centre on it).
 */
export const highwayPoint = (query: HighwayPointQuery): Point =>
  paneProjection(
    paneRect(query.box, query.paneCount, query.paneIndex),
    query.instrument,
  )(
    laneWorldX(query.instrument, query.lane),
    noteWorldY(query.atSec ?? query.nowSec, query.nowSec),
  );

/** A `HighwayPointQuery` for a gem: a note in a pad or fret lane. */
export interface GemQuery extends Omit<HighwayPointQuery, 'lane'> {
  lane: DrumPad | number;
}

/**
 * Screen position of the centre of the gem sprite the app draws for a note
 * in a pad or fret lane. The app draws a gem as a camera-facing sprite
 * anchored on the note's point `GEM_ANCHOR_Y` of the way up its height
 * (`SCALE` world units), so its centre sits `(0.5 - GEM_ANCHOR_Y) * SCALE`
 * above the point in the camera's view (NoteRenderer).
 */
export const gemCentre = (query: GemQuery): Point =>
  paneProjection(
    paneRect(query.box, query.paneCount, query.paneIndex),
    query.instrument,
  )(
    laneWorldX(query.instrument, query.lane),
    noteWorldY(query.atSec ?? query.nowSec, query.nowSec),
    (0.5 - GEM_ANCHOR_Y) * SCALE,
  );

/** A gem sprite's height, in world units (NoteRenderer's `SCALE`). */
export const GEM_HEIGHT: number = SCALE;

/**
 * Screen corners of the floor of the highway drawn in `rect` (a pane of a
 * box, from `paneRects`) between two world Ys, by default the whole floor
 * (its near edge, under the frets, to the far end), in the box's CSS px.
 * Fold a flat element onto it, or the canvas off it, with
 * `quadToQuadMatrix3d`.
 */
export const highwayQuad = (
  rect: HighwayRect,
  instrument: HighwayInstrument,
  nearY: number = FLOOR_NEAR_Y,
  farY: number = FLOOR_FAR_Y,
): Quad => {
  const project = paneProjection(rect, instrument);
  return mapQuad(floorCorners(instrument, nearY, farY), corner =>
    project(corner.X, corner.Y),
  );
};

/**
 * The whole floor of one pane of a box, in the box's CSS px: far-left,
 * far-right, near-right, near-left. For a single full-frame pane this is
 * where the lane sits in the canvas, e.g. the far edge (`[0].y`) is where the
 * highway fades into the fog.
 */
export const floorQuad = (
  box: HighwayBox,
  instrument: HighwayInstrument,
  pane: {count: number; index: number} = {count: 1, index: 0},
): Quad => highwayQuad(paneRect(box, pane.count, pane.index), instrument);
