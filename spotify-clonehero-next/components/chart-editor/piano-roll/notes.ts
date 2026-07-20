/**
 * Piano-roll note extraction (plan 0062 §5; scope-generalized in 0038).
 *
 * Lanes and note→lane mapping are derived from the active scope's
 * `InstrumentSchema` (`lib/chart-edit/instruments/`) — the same schema the
 * highway and the schema-driven note adapter (`typeToLane`/`listNotes` in
 * `lib/chart-edit/entities/notes.ts`) use, so the piano roll and the
 * highway never disagree about which lane a note is on, whether it's a
 * cymbal, or what an instrument's lanes look like. Pure: no React, no
 * canvas.
 */

import {
  listNotes,
  schemaNoteId,
  typeToLane,
  type InstrumentSchema,
  type ParsedTrackData,
} from '@/lib/chart-edit';
import {noteFlags} from '@eliwhite/scan-chart';

/** A note projected onto the piano roll's note lanes. */
export interface PianoRollNote {
  /** Tick position (for tempo-map → ms conversion at render time). */
  tick: number;
  /**
   * Display row (top→bottom) — index into the active schema's
   * `lanesForSchema(schema)` array. This data order *is* the display
   * order, so no separate row↔lane mapping exists.
   */
  lane: number;
  /** True when this hit is a cymbal (triangle glyph); false for tom/kick. */
  cymbal: boolean;
  /** Shared selection id (`tick:type`) — matches `state.selection`. */
  id: string;
}

/** A piano-roll lane's display data, derived from an `InstrumentSchema`. */
export interface PianoRollLane {
  /** Lane label, e.g. "Red", "Kick", "Open". */
  name: string;
  /** Fill color for this lane's note glyphs and header chip. */
  color: string;
  /** True when a note in this lane may legally carry the cymbal flag. */
  cymbalOk: boolean;
}

/**
 * Project `schema`'s lanes onto the piano roll, top→bottom in schema lane
 * order — the same order `typeToLane`/`extractPianoRollNotes` use, so
 * `PianoRollNote.lane` indexes directly into this array.
 */
export function lanesForSchema(schema: InstrumentSchema): PianoRollLane[] {
  const cymbalBinding = schema.flagBindings.find(b => b.flag === 'cymbal');
  return [...schema.lanes]
    .sort((a, b) => a.index - b.index)
    .map(lane => ({
      name: lane.label,
      color: lane.pianoRollColor ?? lane.color,
      cymbalOk:
        !!cymbalBinding &&
        (!cymbalBinding.appliesTo ||
          cymbalBinding.appliesTo.includes(lane.noteType)),
    }));
}

/**
 * Project a track's notes onto the piano-roll lanes for `schema`. Notes
 * whose type falls outside `schema`'s lanes are dropped (never a
 * negative/out-of-range lane). Sorted by tick.
 */
export function extractPianoRollNotes(
  track: ParsedTrackData | null,
  schema: InstrumentSchema | null,
): PianoRollNote[] {
  if (!track || !schema) return [];
  const laneCount = schema.lanes.length;
  const out: PianoRollNote[] = [];
  for (const note of listNotes(track, schema)) {
    const lane = typeToLane(schema, note.type);
    if (lane < 0 || lane >= laneCount) continue;
    const legalCymbal = schema.flagBindings.some(
      b =>
        b.flag === 'cymbal' &&
        (!b.appliesTo || b.appliesTo.includes(note.type)),
    );
    out.push({
      tick: note.tick,
      lane,
      cymbal: !!(note.flags & noteFlags.cymbal) && legalCymbal,
      id: schemaNoteId(note.tick, note.type),
    });
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
}
