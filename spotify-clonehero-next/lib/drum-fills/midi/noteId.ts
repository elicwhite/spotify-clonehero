/**
 * Stable note identity for fill scoring + feedback.
 *
 * A fill note's identity is `${tick}:${lane}:${'c'|'p'}` — its absolute tick,
 * its Clone Hero lane, and whether it is a cymbal voicing. This is the single
 * place that scheme is defined, so every path that produces or consumes a note
 * id agrees: the expected notes built from the real chart
 * (`practice/fillNotes.ts`), the synthetic practice chart
 * (`practice/practiceChart.ts`), the per-note judgments from the hit matcher,
 * and the sheet-music overlay that marks each rendered notehead.
 *
 * Lane + cymbal are read from the *raw* scan-chart note type/flags (no disco
 * flip) so the id matches the scoring path exactly. Pure: no DOM, no React.
 */

import {noteFlags, noteTypes} from '@/lib/chart-edit/types';
import type {DrumLane} from './padMapping';

/** scan-chart NoteType → Clone Hero drum lane (raw, no disco flip). */
export function noteTypeToLane(type: number): DrumLane | null {
  switch (type) {
    case noteTypes.kick:
      return 'kick';
    case noteTypes.redDrum:
      return 'red';
    case noteTypes.yellowDrum:
      return 'yellow';
    case noteTypes.blueDrum:
      return 'blue';
    case noteTypes.greenDrum:
      return 'green';
    default:
      return null;
  }
}

/**
 * Whether a raw drum note is a cymbal voicing. Kick and red are never cymbals;
 * yellow/blue/green are cymbals when the cymbal flag is set.
 */
export function noteIsCymbal(lane: DrumLane, flags: number): boolean {
  return lane !== 'kick' && lane !== 'red' && (flags & noteFlags.cymbal) !== 0;
}

/** Compose the stable fill-note id from its parts. */
export function fillNoteId(
  tick: number,
  lane: DrumLane,
  isCymbal: boolean,
): string {
  return `${tick}:${lane}:${isCymbal ? 'c' : 'p'}`;
}

/**
 * Derive the fill-note id of a raw scan-chart drum note at `tick`, or null when
 * the note is not a recognised drum lane.
 */
export function fillNoteIdFromRaw(
  tick: number,
  note: {type: number; flags: number},
): {id: string; lane: DrumLane; isCymbal: boolean} | null {
  const lane = noteTypeToLane(note.type);
  if (!lane) return null;
  const isCymbal = noteIsCymbal(lane, note.flags);
  return {id: fillNoteId(tick, lane, isCymbal), lane, isCymbal};
}
