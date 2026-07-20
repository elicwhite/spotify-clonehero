/**
 * Drum note helper functions.
 *
 * Thin `drums4LaneSchema`-bound wrappers over the schema-driven engine in
 * `../entities/notes.ts` (plan 0037 Task 4). Notes are scan-chart
 * `NoteEvent`s directly: `type` is a raw `NoteType`, `flags` a raw bitmask.
 * There is no drum-only string-type/flags-object translation layer (plan
 * 0037 Task 5) — friendly labels come from `InstrumentSchema.lanes[].label`
 * (`../instruments/drums.ts`).
 */

import type {NoteType} from '@eliwhite/scan-chart';
import type {ParsedTrackData, DrumNote} from '../types';
import {noteFlags} from '../types';
import {type ChartTiming} from '../retime';
import {drums4LaneSchema, isCymbalLegalNoteType} from '../instruments/drums';
import {
  addNote,
  removeNote,
  listNotes,
  setNoteFlags,
  legalizeFlagBits,
} from '../entities/notes';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a drum note with optional flags to a track.
 *
 * Inserts a NoteEvent into the appropriate group at the given tick.
 *
 * When `timing` is supplied (build it once per mutation via
 * `makeChartTiming(doc.parsedChart)`), the note's `msTime`/`msLength` are
 * computed from the tempo table at insertion time so the chart's derived
 * timing is correct without a serialize→reparse round trip (plan 0061 §2's
 * push model). A track holds no tempos of its own, so callers that have the
 * whole chart must pass `timing`; callers still round-tripping the doc may
 * omit it (the values are recomputed on the next parse).
 */
export function addDrumNote(
  track: ParsedTrackData,
  note: {
    tick: number;
    type: NoteType;
    length?: number;
    flags?: number;
  },
  timing?: ChartTiming,
): void {
  const {tick, type, length = 0, flags = 0} = note;
  addNote(
    track,
    {
      tick,
      type,
      length,
      flags: legalizeDrumFlagBits(flags, type),
    },
    drums4LaneSchema,
    timing,
  );
}

/**
 * Remove a drum note and all its modifier events at a given tick.
 */
export function removeDrumNote(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
): void {
  removeNote(track, tick, type, drums4LaneSchema);
}

/**
 * Read all drum notes from a track.
 *
 * Returns DrumNote[] sorted by tick.
 */
export function getDrumNotes(track: ParsedTrackData): DrumNote[] {
  return listNotes(track, drums4LaneSchema).map(note => ({
    tick: note.tick,
    length: note.length,
    type: note.type,
    flags: note.flags,
  }));
}

/**
 * Set the modifier flags for an existing drum note at a given tick.
 *
 * Throws if no base note of the given type exists at the tick.
 */
export function setDrumNoteFlags(
  track: ParsedTrackData,
  tick: number,
  type: NoteType,
  flags: number,
): void {
  try {
    setNoteFlags(
      track,
      tick,
      type,
      legalizeDrumFlagBits(flags, type),
      drums4LaneSchema,
    );
  } catch {
    const label =
      drums4LaneSchema.lanes.find(l => l.noteType === type)?.label ?? type;
    throw new Error(`No ${label} note found at tick ${tick}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Legalize a flag bitmask for `type`: the schema's generic
 * `legalizeFlagBits`, plus drum lane legality (§6, invariant 4: kick/red
 * can never carry `cymbal`/`tom`) — the single choke point every view
 * funnels through so no gesture (highway drag, piano-roll drag, context
 * menu) can construct an illegal red/kick cymbal.
 */
function legalizeDrumFlagBits(bits: number, type: NoteType): number {
  let result = legalizeFlagBits(drums4LaneSchema, type, bits);
  if (!isCymbalLegalNoteType(type)) {
    result &= ~noteFlags.cymbal;
    result &= ~noteFlags.tom;
  }
  return result;
}
