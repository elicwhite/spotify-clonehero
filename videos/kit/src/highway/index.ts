/// <reference path="./product-modules.d.ts" />
/**
 * The product highway: the app's own three.js renderer driven by the film
 * clock, the geometry to frame it from outside, and ways to set it into a
 * shot. See README.md in this folder.
 */
export {PRODUCT_ASSETS_PATH} from './assetsPath';
export {loadChartFolder, useChartFolder} from './chartFolder';
export type {ChartFolder} from './chartFolder';
export {
  GlassRim,
  HighwayCrop,
  HighwayPlate,
  Iris,
  LaneBleed,
  laneMask,
} from './compositing';
export type {
  CroppedHighwayProps,
  GlassRimProps,
  HighwayCropProps,
  HighwayPlateProps,
  IrisProps,
  LaneBleedProps,
} from './compositing';
export {
  addNote,
  deleteNotes,
  editHistory,
  EXPERT_DRUMS,
  EXPERT_GUITAR,
  moveNotes,
  noteIdOf,
  notesBetween,
  setNoteLength,
  trackNotes,
} from './editing';
export type {TimedEdit, TrackRef} from './editing';
export {
  FLOOR_FAR_Y,
  FLOOR_HALF_WIDTH,
  FLOOR_NEAR_Y,
  floorCorners,
  HIGHWAY_SPEED,
  highwayInstrumentOf,
  noteWorldY,
  STRIKELINE_Y,
} from './floor';
export type {FloorPoint, HighwayInstrument} from './floor';
export {
  floorQuad,
  GEM_HEIGHT,
  gemCentre,
  highwayPoint,
  highwayQuad,
  isOnHighway,
  laneOfNoteType,
  paneRects,
  stageLayout,
} from './highwayGeometry';
export type {
  DrumPad,
  GemQuery,
  HighwayBox,
  HighwayLane,
  HighwayPointQuery,
} from './highwayGeometry';
export {HighwaySmoke} from './HighwaySmoke';
export type {HighwaySmokeProps, SmokeProbe} from './HighwaySmoke';
export {ProductHighway} from './ProductHighway';
export type {ProductHighwayProps} from './ProductHighway';
export {moveQuad} from './screenMove';
export type {ScreenMove} from './screenMove';
export {differenceOf, litFraction, mismatchOf, readPixels} from './smokeCheck';
export type {Difference, Mismatch} from './smokeCheck';
export {songPositionAt} from './songPosition';
export type {Playback, SongPosition, SongPositionInput} from './songPosition';
export {useSplitHighway} from './splitHighway';
export type {SplitHighway} from './splitHighway';
export type {HighwayPane} from './stageSync';
export {
  TEST_CHART_RESOLUTION,
  TEST_PROBE_NOTE,
  testChartFiles,
  testChartSeconds,
  testChartText,
  testSongIni,
} from './testChart';
export type {TestChartOptions} from './testChart';
export {floorWarp, WarpedHighway} from './WarpedHighway';
export type {WarpedHighwayProps} from './WarpedHighway';
