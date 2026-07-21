/**
 * Five-fret InstrumentSchema — guitar / bass / rhythm / keys.
 *
 * Open notes (lane 0) plus green/red/yellow/blue/orange (lanes 1-5).
 * Lane key bindings mirror common chart-editor conventions; no
 * five-fret editor consumes them yet, but the defaults are kept here
 * so the schema stays the source of truth when one ships.
 *
 * Flag bindings cover scan-chart's HOPO / tap / strum-flag set. Sustain
 * editing isn't a flag in scan-chart (it's `length` on the NoteEvent),
 * so it's absent here.
 */

import type {Instrument} from '@eliwhite/scan-chart';
import {noteTypes} from '@eliwhite/scan-chart';
import type {InstrumentSchema, LaneDefinition} from './types';

// World-space X coordinates for the five-fret highway. Mirrors the formula
// in `lib/preview/highway/types.ts:calculateNoteXOffset('guitar', i)`,
// where `i` is the pad-lane index (open excluded, matching
// `notePlacement.ts`'s `padLanes(schema)` order). Kept as data on the
// schema so InteractionManager + place-mode logic can resolve "lane →
// world X" without recomputing geometry. Update both when the renderer's
// lane spacing changes.
//   leftOffset = 0.035, NOTE_SPAN_WIDTH = 0.95, SCALE = 0.105
//   fretX(i) = 0.035 + -(0.95 / 2) + 0.105 + ((0.95 - 0.105) / 5) * i
//            = -0.335 + 0.169 * i
const FRET_X = (i: number): number => -0.335 + 0.169 * i;
const OPEN_X = 0; // open centers on the highway, like kick

const OPEN: LaneDefinition = {
  index: 0,
  noteType: noteTypes.open,
  label: 'Open',
  color: '#a266ff',
  pianoRollColor: '#9b59b6',
  worldXOffset: OPEN_X,
  fullWidth: true,
};

const GREEN: LaneDefinition = {
  index: 1,
  noteType: noteTypes.green,
  label: 'Green',
  color: '#01b11a',
  pianoRollColor: '#5cc262',
  defaultKey: '1',
  worldXOffset: FRET_X(0),
};

const RED: LaneDefinition = {
  index: 2,
  noteType: noteTypes.red,
  label: 'Red',
  color: '#dd2214',
  pianoRollColor: '#e5484d',
  defaultKey: '2',
  worldXOffset: FRET_X(1),
};

const YELLOW: LaneDefinition = {
  index: 3,
  noteType: noteTypes.yellow,
  label: 'Yellow',
  color: '#deeb52',
  pianoRollColor: '#f5c742',
  defaultKey: '3',
  worldXOffset: FRET_X(2),
};

const BLUE: LaneDefinition = {
  index: 4,
  noteType: noteTypes.blue,
  label: 'Blue',
  color: '#006caf',
  pianoRollColor: '#4a9ef2',
  defaultKey: '4',
  worldXOffset: FRET_X(3),
};

const ORANGE: LaneDefinition = {
  index: 5,
  noteType: noteTypes.orange,
  label: 'Orange',
  color: '#f8b272',
  pianoRollColor: '#f2994a',
  defaultKey: '5',
  worldXOffset: FRET_X(4),
};

function fiveFretSchema(instrument: Instrument): InstrumentSchema {
  return {
    instrument,
    lanes: [OPEN, GREEN, RED, YELLOW, BLUE, ORANGE],
    flagBindings: [
      {flag: 'strum', label: 'Strum', defaultKey: 's'},
      {flag: 'hopo', label: 'HOPO', defaultKey: 'h'},
      {flag: 'tap', label: 'Tap', defaultKey: 't'},
    ],
    laneShiftExcludes: [noteTypes.open],
    supportsSustain: true,
    highwayWidth: 1,
    hitboxTexturePath: '/assets/preview/assets/isolated.png',
  };
}

export const guitarSchema = fiveFretSchema('guitar');
export const bassSchema = fiveFretSchema('bass');
export const rhythmSchema = fiveFretSchema('rhythm');
export const keysSchema = fiveFretSchema('keys');
