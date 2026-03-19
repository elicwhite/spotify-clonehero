/**
 * Shared drum note mapping: scan-chart NoteEvent -> instrument name.
 *
 * Used by both the SheetMusic VexFlow renderer and the drum transcription editor.
 */

import {NoteEvent, NoteType, noteTypes, noteFlags} from '@eliwhite/scan-chart';

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
export function applyDiscoFlip(note: {
  type: NoteType;
  flags: number;
}): {type: NoteType; flags: number} {
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

export type DrumNoteInstrument =
  | 'kick'
  | 'snare'
  | 'high-tom'
  | 'mid-tom'
  | 'floor-tom'
  | 'hihat'
  | 'crash'
  | 'ride';

/**
 * Maps a scan-chart NoteEvent to a DrumNoteInstrument string.
 *
 * Uses the note's `type` and `flags` fields to determine the instrument:
 * - kick (noteTypes.kick)
 * - snare (noteTypes.redDrum)
 * - yellow: hihat (cymbal flag) or high-tom (tom flag)
 * - blue: ride (cymbal flag) or mid-tom (tom flag)
 * - green: crash (cymbal flag) or floor-tom (tom flag)
 */
export function noteEventToInstrument(note: NoteEvent): DrumNoteInstrument {
  switch (note.type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'snare';
    case noteTypes.yellowDrum:
      if (note.flags & noteFlags.cymbal && note.flags & noteFlags.accent) {
        // Could be open-hat or a harder hit
        return 'hihat';
      } else if (note.flags & noteFlags.cymbal) {
        return 'hihat';
      } else if (note.flags & noteFlags.tom) {
        return 'high-tom';
      } else {
        throw new Error(`Unexpected Yellow note flags ${note.flags}`);
      }
    case noteTypes.blueDrum:
      if (note.flags & noteFlags.cymbal) {
        return 'ride';
      } else if (note.flags & noteFlags.tom) {
        return 'mid-tom';
      } else {
        throw new Error(`Unexpected Blue note flags ${note.flags}`);
      }
    case noteTypes.greenDrum:
      if (note.flags & noteFlags.cymbal) {
        return 'crash';
      } else if (note.flags & noteFlags.tom) {
        return 'floor-tom';
      } else {
        throw new Error(`Unexpected Green note flags ${note.flags}`);
      }
    default:
      throw new Error(`Unexpected note type ${note.type}`);
  }
}
