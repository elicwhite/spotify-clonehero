/**
 * Drum note helper functions.
 *
 * Translates between friendly DrumNote types and NoteEvent groups
 * in a ParsedTrackData object. All mutations are in-place.
 */

import type {
  ParsedTrackData,
  DrumNoteType,
  DrumNoteFlags,
  DrumNote,
  NoteEvent,
} from '../types';
import {noteFlags, drumNoteTypeMap, noteTypeToDrumNote} from '../types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a drum note with optional flags to a track.
 *
 * Inserts a NoteEvent into the appropriate group at the given tick.
 */
export function addDrumNote(
  track: ParsedTrackData,
  note: {
    tick: number;
    type: DrumNoteType;
    length?: number;
    flags?: DrumNoteFlags;
  },
): void {
  const {tick, type, length = 0, flags: drumFlags = {}} = note;
  const noteType = drumNoteTypeMap[type];
  const flagBits = drumFlagsToNoteFlags(drumFlags, type);

  const newNote: NoteEvent = {
    tick,
    msTime: 0,
    length,
    msLength: 0,
    type: noteType,
    flags: flagBits,
  };

  // Find existing group at this tick
  const group = track.noteEventGroups.find(
    g => g.length > 0 && g[0].tick === tick,
  );
  if (group) {
    group.push(newNote);
    // If flam flag is set, apply it to all notes in group
    if (drumFlags.flam) {
      for (const n of group) {
        n.flags |= noteFlags.flam;
      }
    }
  } else {
    track.noteEventGroups.push([newNote]);
    // Keep groups sorted by tick
    track.noteEventGroups.sort((a, b) => {
      const tickA = a.length > 0 ? a[0].tick : 0;
      const tickB = b.length > 0 ? b[0].tick : 0;
      return tickA - tickB;
    });
  }
}

/**
 * Remove a drum note and all its modifier events at a given tick.
 */
export function removeDrumNote(
  track: ParsedTrackData,
  tick: number,
  type: DrumNoteType,
): void {
  const noteType = drumNoteTypeMap[type];

  for (let i = 0; i < track.noteEventGroups.length; i++) {
    const group = track.noteEventGroups[i];
    if (group.length === 0 || group[0].tick !== tick) continue;

    // Remove the matching note from the group
    const filtered = group.filter(n => n.type !== noteType);

    if (filtered.length === 0) {
      // Remove the entire group
      track.noteEventGroups.splice(i, 1);
    } else {
      // If no remaining notes have flam, clear flam from all
      if (!filtered.some(n => n.flags & noteFlags.flam)) {
        for (const n of filtered) {
          n.flags &= ~noteFlags.flam;
        }
      }
      track.noteEventGroups[i] = filtered;
    }
    return;
  }
}

/**
 * Read all drum notes from a track, resolving NoteEvent flags to DrumNoteFlags.
 *
 * Returns DrumNote[] sorted by tick.
 */
export function getDrumNotes(track: ParsedTrackData): DrumNote[] {
  const notes: DrumNote[] = [];

  for (const group of track.noteEventGroups) {
    for (const note of group) {
      const drumType = noteTypeToDrumNote[note.type];
      if (drumType === undefined) continue;

      const flags: DrumNoteFlags = {};

      if (note.flags & noteFlags.cymbal) flags.cymbal = true;
      else if (note.flags & noteFlags.tom) flags.cymbal = false;

      if (note.flags & noteFlags.doubleKick) flags.doubleKick = true;
      if (note.flags & noteFlags.accent) flags.accent = true;
      if (note.flags & noteFlags.ghost) flags.ghost = true;
      if (note.flags & noteFlags.flam) flags.flam = true;

      notes.push({
        tick: note.tick,
        length: note.length,
        type: drumType,
        flags,
      });
    }
  }

  notes.sort((a, b) => a.tick - b.tick);
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
  const noteType = drumNoteTypeMap[type];

  for (const group of track.noteEventGroups) {
    if (group.length === 0 || group[0].tick !== tick) continue;

    const note = group.find(n => n.type === noteType);
    if (!note) {
      throw new Error(`No ${type} note found at tick ${tick}`);
    }

    // Rebuild flags bitmask
    note.flags = drumFlagsToNoteFlags(flags, type);

    // Handle flam (shared across all notes at tick)
    if (flags.flam === true) {
      for (const n of group) {
        n.flags |= noteFlags.flam;
      }
    } else if (flags.flam === false) {
      // Only remove flam if this was the last note requesting it
      const othersHaveFlam = group.some(
        n => n !== note && n.flags & noteFlags.flam,
      );
      if (!othersHaveFlam) {
        for (const n of group) {
          n.flags &= ~noteFlags.flam;
        }
      }
    }
    return;
  }

  throw new Error(`No ${type} note found at tick ${tick}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function drumFlagsToNoteFlags(
  flags: DrumNoteFlags,
  type: DrumNoteType,
): number {
  let bits = 0;

  if (flags.cymbal) {
    bits |= noteFlags.cymbal;
  } else if (
    flags.cymbal === false &&
    (type === 'yellowDrum' || type === 'blueDrum' || type === 'greenDrum')
  ) {
    bits |= noteFlags.tom;
  }

  if (flags.doubleKick) bits |= noteFlags.doubleKick;
  if (flags.accent) bits |= noteFlags.accent;
  if (flags.ghost) bits |= noteFlags.ghost;
  if (flags.flam) bits |= noteFlags.flam;

  return bits;
}
