/**
 * Audio-anchored tempo remap — plan 0061 §3, class (a).
 *
 * When the user hand-edits the tempo grid (drags a marker, retypes a BPM,
 * adds/deletes a marker), two note-handling ops are possible, selected by the
 * editor's glue mode (0062 §9):
 *
 *  - **KEEP-MS** (glue = audio, the default): notes keep their wall-clock
 *    (audio) position and are re-ticked under the new tempo map via
 *    `swapSynctrack` — the same quantizer + abstain band the /tempo
 *    prediction path uses. This module owns the class-(a) composition around
 *    it: section whole-note snap (a `swapSynctrack` option), the collision
 *    post-pass, and the final `retimeChart`. The re-tick math itself is NOT
 *    duplicated here — it is adapted at the `lib/tempo-map` boundary.
 *
 *  - **KEEP-TICKS** (glue = grid): notes keep their ticks and ride the moving
 *    grid. That is a plain `retimeChart` (a strict subset of this module's
 *    job) and lives in the tempo helpers / commands, not here.
 *
 * The commands in `components/chart-editor/commands.ts` read the glue mode at
 * dispatch and pick the op; this module provides the KEEP-MS primitive and the
 * pure helpers (`synctrackFromChart`, `nudgeNoteCollisions`) both ops build on.
 */

import type {ChartDocument, ParsedChart, NoteEvent} from './types';
import {quantizeBpm, retimeChart} from './retime';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import type {
  Synctrack,
  TempoEvent,
  TimeSignatureEvent,
} from '@/lib/tempo-map/types';

// ---------------------------------------------------------------------------
// Chart tempo grid → Synctrack (the boundary adapter)
// ---------------------------------------------------------------------------

/**
 * Build a `Synctrack` (the ms-anchored tempo-map shape `swapSynctrack`
 * consumes) from a chart's own tick-domain `tempos`/`timeSignatures`.
 *
 * The tempo msTimes are integrated fresh from the chart's `(tick, bpm)` pairs
 * (via `buildTimedTempos`), so the returned synctrack is internally
 * consistent — `bpm` and `ms` agree — regardless of whether the caller's
 * `tempos[i].msTime` was up to date. That consistency is what lets
 * `buildSyncLayout` reconstruct the marker ticks exactly. The first tempo is
 * assumed to sit at tick 0 (every parsed chart / `createEmptyChart` guarantees
 * this).
 */
export function synctrackFromChart(chart: ParsedChart): Synctrack {
  const res = chart.resolution;
  const tempos = [...chart.tempos].sort((a, b) => a.tick - b.tick);
  const timed = buildTimedTempos(tempos, res);
  const tempoEvents: TempoEvent[] = timed.map(t => ({
    ms: t.msTime,
    bpm: t.beatsPerMinute,
  }));
  const tsEvents: TimeSignatureEvent[] = [...chart.timeSignatures]
    .sort((a, b) => a.tick - b.tick)
    .map(ts => ({
      ms: tickToMs(ts.tick, timed, res),
      numerator: ts.numerator,
      denominator: ts.denominator,
    }));
  return {
    origin_ms: tempoEvents[0]?.ms ?? 0,
    tempos: tempoEvents,
    timeSignatures: tsEvents,
  };
}

// ---------------------------------------------------------------------------
// Marker-move BPM derivation (0062 §7 — the sparse-marker model)
// ---------------------------------------------------------------------------

/**
 * Minimum wall-clock length (ms) either segment adjacent to a dragged marker
 * is allowed to shrink to, so a marker can never cross or touch a neighbour
 * (which would make the derived BPM infinite / negative). Mirrors 0062 §7's
 * "minimum segment length enforced."
 *
 * This is the ONE definition of the clamp for both the lib-side
 * `applyMarkerMoveBpms` (programmatic `MoveTempoMarkerCommand`) and the
 * view-side drag affordance (`clampMarkerMs` in the piano-roll tempo lane), so
 * the UI can never produce a segment the engine forbids and vice versa.
 */
export const MIN_SEGMENT_MS = 40;

/**
 * Apply a sparse-marker horizontal drag (0062 §7) to a chart's tempos, in
 * place: move the tempo marker at `markerTick` to audio time `newMs` and
 * recompute the BPM of the two adjacent segments from the new ms gap
 * (`Δbeats / Δms`), format-quantized (plan 0061 §2). Neighbouring markers'
 * ticks and BPMs are untouched.
 *
 * The chart's tempos must carry correct current `msTime` values (a freshly
 * parsed / retimed chart does). `newMs` is clamped into the open interval
 * `(prev.msTime + MIN_SEGMENT_MS, next.msTime - MIN_SEGMENT_MS)`. Marker 0
 * (the song-start anchor, tick 0) cannot be moved — throws.
 *
 * **Neighbour-ms residue is minimized, not merely bounded (0062 §7).** Because
 * the source of truth is a format-quantized BPM (not an exact ms), the marker's
 * true landed ms is whatever `prev`'s *quantized* BPM re-integrates to — not the
 * raw `newMs`. Computing `cur`'s BPM from that re-integrated landing (rather than
 * from the pre-quantization `newMs`) lands the NEXT marker's recomputed ms as
 * close to its original as the format allows — the prev-segment quantization
 * residue no longer leaks downstream. The only deviation left is a one-time
 * sub-ms snap of the dragged marker itself; neighbours' ms stay within one
 * BPM-quantization step and, critically, do not accumulate across repeated drags
 * of the same marker (each drag re-derives from the current ms).
 *
 * Returns the marker's recomputed landed ms (what `prev`'s quantized BPM
 * re-integrates to). This mutates only BPM values (and leaves the tempos' own
 * `msTime` stale for the caller to recompute, either via `synctrackFromChart`
 * for KEEP-MS or `retimeChart` for KEEP-TICKS).
 */
export function applyMarkerMoveBpms(
  chart: ParsedChart,
  markerTick: number,
  newMs: number,
  format: 'chart' | 'mid',
): number {
  const res = chart.resolution;
  const tempos = chart.tempos;
  const m = tempos.findIndex(t => t.tick === markerTick);
  if (m < 0) throw new Error(`No tempo marker at tick ${markerTick}`);
  if (m === 0) throw new Error('Cannot move the song-start tempo marker');

  const prev = tempos[m - 1];
  const cur = tempos[m];
  const next = tempos[m + 1] as (typeof tempos)[number] | undefined;

  const lowerMs = prev.msTime + MIN_SEGMENT_MS;
  const upperMs = next ? next.msTime - MIN_SEGMENT_MS : Infinity;
  const clampedMs = Math.min(Math.max(newMs, lowerMs), upperMs);

  // Segment before the marker: prev governs [prev.tick, cur.tick].
  const beatsBefore = (cur.tick - prev.tick) / res;
  const minutesBefore = (clampedMs - prev.msTime) / 60000;
  prev.beatsPerMinute = quantizeBpm(beatsBefore / minutesBefore, format);

  // The marker's ACTUAL landed ms once prev's quantized BPM is re-integrated —
  // not `clampedMs`, which was derived from an unrepresentable BPM. Deriving
  // cur's BPM from this landing (below) is what keeps the next marker put.
  const landedMs =
    prev.msTime + (beatsBefore / prev.beatsPerMinute) * 60000;

  // Segment after the marker: cur governs [cur.tick, next.tick]. Choose the
  // quantized BPM that re-integrates the next marker's ms as close to its
  // original as the format allows. The last marker's BPM governs an open-ended
  // tail with nothing to constrain it, so it is left unchanged.
  if (next) {
    const beatsAfter = (next.tick - cur.tick) / res;
    const minutesAfter = (next.msTime - landedMs) / 60000;
    cur.beatsPerMinute = quantizeBpm(beatsAfter / minutesAfter, format);
  }

  return landedMs;
}

// ---------------------------------------------------------------------------
// Collision post-pass (plan 0061 §3 class (a) step 5, Decision 5)
// ---------------------------------------------------------------------------

/**
 * Nudge same-pad note collisions apart after a re-tick.
 *
 * When two notes of the **same type** re-tick onto one tick, the later one
 * (by audio time) is bumped `+1` tick, repeatedly, until its `(tick, type)`
 * slot is free — never merged, and the note count is always preserved
 * (Decision 5). Different-type notes on the same tick are left as a chord.
 *
 * Ordering is by `msTime` (the preserved audio time, still present after
 * `swapSynctrack` and before the final `retimeChart`), so the earlier hit
 * keeps its tick and the later hit yields — matching "nudge the later one."
 *
 * Mutates the note objects' `tick` in place and returns a fresh
 * tick-grouped `noteEventGroups` (notes sharing a tick become one group, as
 * the parser would produce them). `msTime`/`msLength` are left stale for the
 * caller's subsequent `retimeChart`.
 */
export function nudgeNoteCollisions(groups: NoteEvent[][]): NoteEvent[][] {
  const notes = groups.flat();
  if (notes.length === 0) return groups;

  const ordered = [...notes].sort(
    (a, b) => a.msTime - b.msTime || a.tick - b.tick || a.type - b.type,
  );
  const occupied = new Set<string>();
  for (const note of ordered) {
    let tick = note.tick;
    while (occupied.has(`${tick}:${note.type}`)) tick++;
    note.tick = tick;
    occupied.add(`${tick}:${note.type}`);
  }

  const byTick = new Map<number, NoteEvent[]>();
  for (const note of notes) {
    const existing = byTick.get(note.tick);
    if (existing) existing.push(note);
    else byTick.set(note.tick, [note]);
  }
  return [...byTick.keys()]
    .sort((a, b) => a - b)
    .map(tick => byTick.get(tick)!);
}

// ---------------------------------------------------------------------------
// Class (a) KEEP-MS remap
// ---------------------------------------------------------------------------

export interface RemapKeepMsOptions {
  /** Abstain band forwarded to `swapSynctrack` (see its docs). */
  snapToleranceMs?: number;
}

/**
 * Class (a) KEEP-MS remap (plan 0061 §3): install `newSync` while every note
 * keeps its wall-clock time, then run the class-(a) post-passes.
 *
 * `doc`'s notes must still carry their pre-edit `msTime` (the audio anchor) —
 * i.e. do NOT `retimeChart` before calling this, or the anchor is lost. The
 * sequence is exactly the plan's:
 *  1-2. `swapSynctrack(..., {quantizeNotes})` — notes keep `msTime`, re-tick
 *       via the shared quantizer + abstain band; chords re-tick as one group.
 *  3.   sections snap to the nearest whole-note gridline (`sectionPolicy`).
 *  4.   lyrics/phrases exact re-tick (swapSynctrack already does this).
 *  5.   collision post-pass (`nudgeNoteCollisions`) per track.
 *  6.   `retimeChart` so every event's `msTime` matches its final tick.
 */
export function remapKeepMs(
  doc: ChartDocument,
  newSync: Synctrack,
  options: RemapKeepMsOptions = {},
): ChartDocument {
  const swapped = swapSynctrack(doc.parsedChart, newSync, {
    quantizeNotes: true,
    sectionPolicy: 'snap-whole-note',
    ...(options.snapToleranceMs !== undefined
      ? {snapToleranceMs: options.snapToleranceMs}
      : {}),
  });

  for (const track of swapped.trackData) {
    track.noteEventGroups = nudgeNoteCollisions(track.noteEventGroups);
  }

  retimeChart(swapped);
  return {...doc, parsedChart: swapped};
}
