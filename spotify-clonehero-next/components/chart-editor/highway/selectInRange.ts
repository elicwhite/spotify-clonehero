/**
 * Box-select math for the highway editor.
 *
 * Given a screen-space drag rectangle, decide which note ids fall inside
 * it. Pure function — no React, no DOM, no renderer access. Lives outside
 * `HighwayEditor.tsx` so it can be unit-tested directly without a Three.js
 * scene.
 *
 * The screen-to-world conversion (screenToMs / screenToLane) is the
 * caller's job — they own the renderer. This module takes the already-
 * converted bounds (`msMin`, `msMax`, `laneMin`, `laneMax`) and a flat
 * list of notes plus the chart's tempo map.
 */

import type {DrumNote} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {noteId, typeToLane} from '../commands';

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
): Set<string> {
  const selected = new Set<string>();
  for (const note of notes) {
    const lane = typeToLane(note.type);
    if (lane < bounds.laneMin || lane > bounds.laneMax) continue;

    const noteMs = tickToMsLinear(note.tick, timedTempos, resolution);
    if (noteMs >= bounds.msMin && noteMs <= bounds.msMax) {
      selected.add(noteId(note));
    }
  }
  return selected;
}
