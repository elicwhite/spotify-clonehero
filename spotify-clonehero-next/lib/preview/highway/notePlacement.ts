import {noteTypes, type Instrument, type NoteType} from '@eliwhite/scan-chart';
import {interpretDrumNote} from '../../drum-mapping/noteToInstrument';
import {
  schemaForInstrument,
  type InstrumentSchema,
  type LaneDefinition,
} from '../../chart-edit/instruments';
import {calculateNoteXOffset} from './types';

// ---------------------------------------------------------------------------
// notePlacement -- resolves a note's highway geometry from InstrumentSchema
// ---------------------------------------------------------------------------

/**
 * Highway placement for a single note, resolved from the track's
 * `InstrumentSchema` rather than a per-caller `instrument === 'drums'`
 * branch. `trackToElements.ts` and `NotesManager.ts` both call this so lane
 * count/order/full-width behavior stays schema-driven in one place.
 */
export interface NoteGeometry {
  /** Pad lane index (0-based, schema order minus full-width lanes). -1 for
   *  a full-width note (drums' kick, five-fret's open). */
  lane: number;
  /** True for a drum kick note. */
  isKick: boolean;
  /** True for a five-fret open note. */
  isOpen: boolean;
  /** Pre-computed X position in world space. */
  xPosition: number;
}

/** Raw scan-chart pad color -> the NoteType that represents it in the
 *  4-lane drum schema. Used to resolve disco-flipped notes back to a
 *  schema lane. */
const DRUM_PAD_NOTE_TYPE: Partial<Record<string, NoteType>> = {
  red: noteTypes.redDrum,
  yellow: noteTypes.yellowDrum,
  blue: noteTypes.blueDrum,
  green: noteTypes.greenDrum,
};

/** Schema lanes that occupy a pad slot (excludes full-width lanes), ordered
 *  by display index. This is the "0..4" numbering the renderer places notes
 *  at, independent of the full-width lane's position in `schema.lanes`. */
function padLanes(schema: InstrumentSchema): LaneDefinition[] {
  return schema.lanes
    .filter(lane => !lane.fullWidth)
    .sort((a, b) => a.index - b.index);
}

/**
 * Pad lane colors in display order, e.g. for `NoteRenderer`'s sustain-tail
 * color lookup (`data.lane` indexes into this array the same way it indexes
 * into `padLanes`). Sourced from `InstrumentSchema.lanes[].color` so five-fret
 * sustain colors aren't duplicated as a separate hardcoded constant.
 */
export function padLaneColors(schema: InstrumentSchema): string[] {
  return padLanes(schema).map(lane => lane.color);
}

/**
 * Resolves a note's highway geometry (lane index, full-width flag, X
 * position) from the `InstrumentSchema` for its track's instrument.
 *
 * Drums are the one instrument whose raw `note.type` doesn't map directly
 * to a display lane -- disco-flipped notes swap red/yellow -- so
 * `interpretDrumNote` (the single source of truth for that transform) is
 * consulted for drum tracks. Every other instrument maps `note.type`
 * straight to a schema lane.
 */
export function resolveNoteGeometry(
  instrument: Instrument,
  note: {type: NoteType; flags: number},
): NoteGeometry | null {
  const schema = schemaForInstrument(instrument);
  if (!schema) return null;

  const fullWidthLane = schema.lanes.find(lane => lane.fullWidth);
  const lanes = padLanes(schema);

  if (instrument === 'drums') {
    const interpreted = interpretDrumNote(note);
    if (interpreted.isKick) {
      return {lane: -1, isKick: true, isOpen: false, xPosition: 0};
    }
    const noteType = DRUM_PAD_NOTE_TYPE[interpreted.pad];
    const lane = lanes.findIndex(l => l.noteType === noteType);
    if (lane === -1) return null;
    return {
      lane,
      isKick: false,
      isOpen: false,
      xPosition: calculateNoteXOffset(instrument, lane),
    };
  }

  if (fullWidthLane && note.type === fullWidthLane.noteType) {
    return {lane: -1, isKick: false, isOpen: true, xPosition: 0};
  }
  const lane = lanes.findIndex(l => l.noteType === note.type);
  if (lane === -1) return null;
  return {
    lane,
    isKick: false,
    isOpen: false,
    xPosition: calculateNoteXOffset(instrument, lane),
  };
}
