/**
 * Shared marquee (box-select) math for the chart editor's interaction layers
 * (plan 0062 "Two views, one store", invariant 3).
 *
 * Given a drag rectangle already converted to (ms × lane) bounds, decide
 * which note ids fall inside it. Pure function — no React, no DOM, no
 * renderer access. Both the highway box-select and the piano-roll marquee
 * call this one implementation, so a lasso on either surface selects the same
 * notes.
 *
 * The screen→world conversion (screenToMs / screenToLane) is the caller's job
 * — each view owns its own coordinate transform. This module takes the
 * already-converted bounds and a flat note list plus the chart's tempo map.
 */

import type {DrumNote, InstrumentSchema} from '@/lib/chart-edit';
import {typeToLane, drums4LaneSchema} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {noteId} from '../commands';

export interface BoxSelectBounds {
  msMin: number;
  msMax: number;
  laneMin: number;
  laneMax: number;
}

/**
 * Convert a tick to ms using the chart's tempo map. O(log n) is overkill
 * for the small tempo arrays we see in practice — linear walk is the same
 * algorithm scan-chart uses on its own getTimedTempos pipeline.
 */
function tickToMsLinear(
  tick: number,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  let idx = 0;
  for (let i = 1; i < timedTempos.length; i++) {
    if (timedTempos[i].tick <= tick) idx = i;
    else break;
  }
  const tempo = timedTempos[idx];
  return (
    tempo.msTime +
    ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * resolution)
  );
}

/**
 * Return the note ids whose (lane, msTime) fall inside the drag region.
 * Order is unspecified — caller should treat the result as a set.
 *
 * The lane comparison is inclusive on both ends, matching the mouse
 * lasso "if the box brushes the lane, the note is in" feel.
 */
export function selectNotesInRange(
  notes: readonly DrumNote[],
  bounds: BoxSelectBounds,
  timedTempos: TimedTempo[],
  resolution: number,
  schema: InstrumentSchema = drums4LaneSchema,
): Set<string> {
  const selected = new Set<string>();
  for (const note of notes) {
    const lane = typeToLane(schema, note.type);
    if (lane < bounds.laneMin || lane > bounds.laneMax) continue;

    const noteMs = tickToMsLinear(note.tick, timedTempos, resolution);
    if (noteMs >= bounds.msMin && noteMs <= bounds.msMax) {
      selected.add(noteId(note));
    }
  }
  return selected;
}

/**
 * Return the ids of lyric chips whose ms position falls inside
 * `[msMin, msMax]`. The lyrics row is a single row (no lane concept), so
 * membership is ms-only — the caller decides whether the marquee's vertical
 * span reaches the lyrics row at all before calling this.
 */
export function selectLyricsInRange(
  chips: readonly {id: string; ms: number}[],
  msMin: number,
  msMax: number,
): Set<string> {
  const selected = new Set<string>();
  for (const chip of chips) {
    if (chip.ms >= msMin && chip.ms <= msMax) selected.add(chip.id);
  }
  return selected;
}
