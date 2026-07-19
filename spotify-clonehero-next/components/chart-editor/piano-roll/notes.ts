/**
 * Piano-roll note extraction (plan 0062 §5).
 *
 * Reuses the shared chart-edit note reader (`getDrumNotes`) and lane mapping
 * (`typeToLane`) — the same decode the highway path uses — so the two views
 * never disagree about which lane a note is on or whether it's a cymbal.
 * Pure: no React, no canvas.
 */

import {getDrumNotes, noteId, type ParsedTrackData} from '@/lib/chart-edit';
import {typeToLane} from '../commands';

/** A note projected onto the 5-lane piano roll. */
export interface PianoRollNote {
  /** Tick position (for tempo-map → ms conversion at render time). */
  tick: number;
  /** Lane index: 0 kick, 1 red, 2 yellow, 3 blue, 4 green. */
  lane: number;
  /** True when this hit is a cymbal (triangle glyph); false for tom/kick. */
  cymbal: boolean;
  /** Shared selection id (`tick:type`) — matches `state.selection`. */
  id: string;
}

/** Lane definitions, top→bottom, matching the highway colors. */
export const PIANO_ROLL_LANES: ReadonlyArray<{name: string; color: string}> = [
  {name: 'Kick', color: '#f2994a'},
  {name: 'Red', color: '#e5484d'},
  {name: 'Yellow', color: '#f5c742'},
  {name: 'Blue', color: '#4a9ef2'},
  {name: 'Green', color: '#5cc262'},
];

/** Which lanes may hold a cymbal (kick and red never can — §6 legality). */
export const LANE_CYMBAL_OK: readonly boolean[] = [
  false,
  false,
  true,
  true,
  true,
];

export const LANE_COUNT = PIANO_ROLL_LANES.length;

/**
 * Project a track's drum notes onto the 5-lane piano roll. Notes whose type
 * falls outside the 5 lanes are dropped (never negative-lane). Sorted by tick.
 */
export function extractPianoRollNotes(
  track: ParsedTrackData | null,
): PianoRollNote[] {
  if (!track) return [];
  const out: PianoRollNote[] = [];
  for (const note of getDrumNotes(track)) {
    const lane = typeToLane(note.type);
    if (lane < 0 || lane >= LANE_COUNT) continue;
    out.push({
      tick: note.tick,
      lane,
      cymbal: note.flags.cymbal === true && LANE_CYMBAL_OK[lane],
      id: noteId(note),
    });
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
}
