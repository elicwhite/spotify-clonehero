/**
 * Drum note helper functions.
 *
 * Translates between friendly DrumNote types and NoteEvent groups in a
 * ParsedTrackData object. The lane/flag mutation itself is the
 * schema-driven engine in `../entities/notes.ts` (plan 0037 Task 4),
 * applied here with `drums4LaneSchema` and DrumNoteType↔NoteType
 * translation at the boundary — this file is the drum-only friendly facade
 * over that generic engine, not a second implementation of it.
 */

import type {ParsedTrackData, DrumNoteType, DrumNoteFlags, DrumNote} from '../types';
import {noteFlags, drumNoteTypeMap, noteTypeToDrumNote} from '../types';
import {type ChartTiming} from '../retime';
import {drums4LaneSchema, isCymbalLegalDrumType} from '../instruments/drums';
import {addNote, removeNote, listNotes, setNoteFlags} from '../entities/notes';

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
    type: DrumNoteType;
    length?: number;
    flags?: DrumNoteFlags;
  },
  timing?: ChartTiming,
): void {
  const {tick, type, length = 0, flags: drumFlags = {}} = note;
  addNote(
    track,
    {
      tick,
      type: drumNoteTypeMap[type],
      length,
      flags: drumFlagsToNoteFlags(drumFlags, type),
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
  type: DrumNoteType,
): void {
  removeNote(track, tick, drumNoteTypeMap[type], drums4LaneSchema);
}

/**
 * Read all drum notes from a track, resolving NoteEvent flags to DrumNoteFlags.
 *
 * Returns DrumNote[] sorted by tick.
 */
export function getDrumNotes(track: ParsedTrackData): DrumNote[] {
  const notes: DrumNote[] = [];

  for (const note of listNotes(track, drums4LaneSchema)) {
    const drumType = noteTypeToDrumNote[note.type];
    if (drumType === undefined) continue;

    const flags: DrumNoteFlags = {};
    if (note.flags & noteFlags.cymbal) flags.cymbal = true;
    else if (note.flags & noteFlags.tom) flags.cymbal = false;
    if (note.flags & noteFlags.doubleKick) flags.doubleKick = true;
    if (note.flags & noteFlags.accent) flags.accent = true;
    if (note.flags & noteFlags.ghost) flags.ghost = true;
    if (note.flags & noteFlags.flam) flags.flam = true;

    notes.push({tick: note.tick, length: note.length, type: drumType, flags});
  }

  return notes;
}

/**
 * Set the modifier flags for an existing drum note at a given tick.
 *
 * Throws if no base note of the given type exists at the tick.
 */
export function setDrumNoteFlags(
  track: ParsedTrackData,
  tick: number,
  type: DrumNoteType,
  flags: DrumNoteFlags,
): void {
  try {
    setNoteFlags(
      track,
      tick,
      drumNoteTypeMap[type],
      drumFlagsToNoteFlags(flags, type),
      drums4LaneSchema,
    );
  } catch {
    throw new Error(`No ${type} note found at tick ${tick}`);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert friendly `DrumNoteFlags` to a scan-chart flag bitmask for `type`,
 *  enforcing lane legality (kick/red can never carry `cymbal`). Exported for
 *  `components/chart-editor/commands.ts`'s `toSchemaNote` — the boundary
 *  where DrumNote-shaped callers (clipboard paste, MCP tools) construct the
 *  schema-generic `AddNoteCommand` input. */
export function drumFlagsToNoteFlags(
  flags: DrumNoteFlags,
  type: DrumNoteType,
): number {
  let bits = 0;

  // Lane legality (§6, invariant 4): kick and red can never hold a cymbal.
  // Enforced here in the mutator — the single choke point every view funnels
  // through — so no gesture (highway drag, piano-roll drag, context menu) can
  // construct an illegal red/kick cymbal. Dragging a cymbal onto an illegal
  // lane drops the flag entirely (the tom bit only applies to cymbal-legal
  // lanes too).
  const cymbalLegal = isCymbalLegalDrumType(type);
  if (flags.cymbal && cymbalLegal) {
    bits |= noteFlags.cymbal;
  } else if (flags.cymbal === false && cymbalLegal) {
    bits |= noteFlags.tom;
  }

  if (flags.doubleKick) bits |= noteFlags.doubleKick;
  if (flags.accent) bits |= noteFlags.accent;
  if (flags.ghost) bits |= noteFlags.ghost;
  if (flags.flam) bits |= noteFlags.flam;

  return bits;
}
