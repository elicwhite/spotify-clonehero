/**
 * Five-fret InstrumentSchema — guitar / bass / rhythm / keys.
 *
 * Open notes (lane 0) plus green/red/yellow/blue/orange (lanes 1-5).
 * Lane key bindings mirror common chart-editor conventions; nothing
 * consumes them yet (no five-fret editing in this phase) — they're the
 * defaults phase-9 will plug in when `/guitar-edit` ships.
 *
 * Flag bindings cover scan-chart's HOPO / tap / strum-flag set. Sustain
 * editing isn't a flag in scan-chart (it's `length` on the NoteEvent),
 * so it's absent here.
 */

import type {Instrument} from '@eliwhite/scan-chart';
import {noteTypes} from '@eliwhite/scan-chart';
import type {InstrumentSchema, LaneDefinition} from './types';

const OPEN: LaneDefinition = {
  index: 0,
  noteType: noteTypes.open,
  label: 'Open',
  color: '#a266ff',
};

const GREEN: LaneDefinition = {
  index: 1,
  noteType: noteTypes.green,
  label: 'Green',
  color: '#01b11a',
  defaultKey: '1',
};

const RED: LaneDefinition = {
  index: 2,
  noteType: noteTypes.red,
  label: 'Red',
  color: '#dd2214',
  defaultKey: '2',
};

const YELLOW: LaneDefinition = {
  index: 3,
  noteType: noteTypes.yellow,
  label: 'Yellow',
  color: '#deeb52',
  defaultKey: '3',
};

const BLUE: LaneDefinition = {
  index: 4,
  noteType: noteTypes.blue,
  label: 'Blue',
  color: '#006caf',
  defaultKey: '4',
};

const ORANGE: LaneDefinition = {
  index: 5,
  noteType: noteTypes.orange,
  label: 'Orange',
  color: '#f8b272',
  defaultKey: '5',
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
  };
}

export const guitarSchema = fiveFretSchema('guitar');
export const bassSchema = fiveFretSchema('bass');
export const rhythmSchema = fiveFretSchema('rhythm');
export const keysSchema = fiveFretSchema('keys');
