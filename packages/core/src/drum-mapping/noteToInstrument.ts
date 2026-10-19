/**
 * Shared drum note mapping: scan-chart NoteEvent → interpreted drum note.
 *
 * This is the single source of truth for interpreting raw scan-chart drum note
 * data. All consumers should call `interpretDrumNote()` rather than manually
 * checking noteTypes/noteFlags.
 */

import {NoteType, noteTypes, noteFlags} from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The drum pad color after disco flip. */
export type DrumPad = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

export type DrumNoteInstrument =
  | 'kick'
  | 'snare'
  | 'high-tom'
  | 'mid-tom'
  | 'floor-tom'
  | 'hihat'
  | 'crash'
  | 'ride';

/** Full interpretation of a drum note's type and flags. */
export interface InterpretedDrumNote {
  /** Pad color (after disco flip). */
  pad: DrumPad;
  /** Specific instrument (snare, hihat, ride, crash, high-tom, mid-tom, floor-tom, kick). */
  instrument: DrumNoteInstrument;
  /** True if cymbal (hihat, ride, crash). False for toms/kick/snare. */
  isCymbal: boolean;
  /** True for kick notes. */
  isKick: boolean;
  /** True for double-kick (kick with doubleKick flag). */
  isDoubleKick: boolean;
  /** Dynamic modifier. */
  dynamic: 'ghost' | 'accent' | 'none';
  /** True if flam flag is set. */
  isFlam: boolean;
  /** The note type after disco flip. */
  noteType: NoteType;
  /** The flags after disco flip. */
  flags: number;
}

// ---------------------------------------------------------------------------
// Disco flip
// ---------------------------------------------------------------------------

/**
 * Applies the disco flip transformation to a drum note's type and flags.
 *
 * Notes with the `disco` flag have red and yellow swapped visually:
 * - Red tom becomes yellow cymbal (snare -> hihat)
 * - Yellow cymbal becomes red tom (hihat -> snare)
 *
 * Notes with the `discoNoflip` flag just have the flag stripped (no swap).
 *
 * Returns a new {type, flags} object — does NOT mutate the input note.
 */
export function applyDiscoFlip(note: {type: NoteType; flags: number}): {
  type: NoteType;
  flags: number;
} {
  let {type, flags} = note;

  if (flags & noteFlags.discoNoflip) {
    flags &= ~noteFlags.discoNoflip;
    return {type, flags};
  }

  if (flags & noteFlags.disco) {
    flags &= ~noteFlags.disco;
    switch (type) {
      case noteTypes.redDrum:
        type = noteTypes.yellowDrum;
        flags &= ~noteFlags.tom;
        flags |= noteFlags.cymbal;
        break;
      case noteTypes.yellowDrum:
        type = noteTypes.redDrum;
        flags &= ~noteFlags.cymbal;
        flags |= noteFlags.tom;
        break;
    }
    return {type, flags};
  }

  return {type, flags};
}

// ---------------------------------------------------------------------------
// Convenience predicates (work on raw noteType, no disco flip)
// ---------------------------------------------------------------------------

/** True if the noteType is a kick drum. */
export function isKickNote(noteType: NoteType): boolean {
  return noteType === noteTypes.kick;
}

/** True if the note renders as a cymbal (cymbal flag set, not red pad). */
export function isDrumCymbal(noteType: NoteType, flags: number): boolean {
  return (flags & noteFlags.cymbal) !== 0 && noteType !== noteTypes.redDrum;
}

/**
 * Map a raw scan-chart NoteType to a DrumPad color (no disco flip applied).
 * Handles 4-lane aliases (noteTypes.yellow, .blue, .green, .orange).
 * Returns null for non-drum note types.
 */
export function noteTypeToPad(noteType: NoteType): DrumPad | null {
  switch (noteType) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'red';
    case noteTypes.yellow:
    case noteTypes.yellowDrum:
      return 'yellow';
    case noteTypes.blue:
    case noteTypes.blueDrum:
      return 'blue';
    case noteTypes.green:
    case noteTypes.greenDrum:
    case noteTypes.orange:
      return 'green';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Primary interpretation function
// ---------------------------------------------------------------------------

/**
 * Interpret a raw scan-chart drum note into structured data.
 *
 * Applies disco flip, determines pad, instrument, cymbal/tom, dynamics.
 * This is the single source of truth — all consumers should call this
 * instead of manually checking noteTypes/noteFlags.
 */
export function interpretDrumNote(note: {
  type: NoteType;
  flags: number;
}): InterpretedDrumNote {
  const {type, flags} = applyDiscoFlip(note);

  const pad = noteTypeToPad(type);
  if (pad == null) {
    throw new Error(`Not a drum note type: ${note.type}`);
  }

  const isKick = pad === 'kick';
  const isCymbal = (flags & noteFlags.cymbal) !== 0 && pad !== 'red';

  const instrument = resolveInstrument(type, flags, pad, isCymbal);

  const dynamic: InterpretedDrumNote['dynamic'] =
    flags & noteFlags.ghost
      ? 'ghost'
      : flags & noteFlags.accent
        ? 'accent'
        : 'none';

  return {
    pad,
    instrument,
    isCymbal,
    isKick,
    isDoubleKick: isKick && (flags & noteFlags.doubleKick) !== 0,
    dynamic,
    isFlam: (flags & noteFlags.flam) !== 0,
    noteType: type,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Legacy API (kept for backward compat — delegates to interpretDrumNote)
// ---------------------------------------------------------------------------

/**
 * Maps a scan-chart note to a DrumNoteInstrument string.
 * Prefer `interpretDrumNote()` for new code.
 */
export function noteEventToInstrument(note: {
  type: NoteType;
  flags: number;
}): DrumNoteInstrument {
  return interpretDrumNote(note).instrument;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveInstrument(
  type: NoteType,
  flags: number,
  pad: DrumPad,
  isCymbal: boolean,
): DrumNoteInstrument {
  if (pad === 'kick') return 'kick';
  if (pad === 'red') return 'snare';

  if (isCymbal) {
    switch (pad) {
      case 'yellow':
        return 'hihat';
      case 'blue':
        return 'ride';
      case 'green':
        return 'crash';
    }
  }

  // Tom (explicit tom flag, or default when no cymbal flag)
  if (flags & noteFlags.tom || !(flags & noteFlags.cymbal)) {
    switch (pad) {
      case 'yellow':
        return 'high-tom';
      case 'blue':
        return 'mid-tom';
      case 'green':
        return 'floor-tom';
    }
  }

  throw new Error(`Cannot determine instrument for pad=${pad} flags=${flags}`);
}
