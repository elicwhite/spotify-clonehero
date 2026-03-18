/**
 * Shared drum note mapping: scan-chart NoteEvent -> instrument name.
 *
 * Used by both the SheetMusic VexFlow renderer and the drum transcription editor.
 */

import {NoteEvent, noteTypes, noteFlags} from '@eliwhite/scan-chart';

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
