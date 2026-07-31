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

/** The guitar/bass-only articulation state shown by the piano roll. */
export type FretTechnique = 'natural' | 'strum' | 'hopo' | 'tap';

/** The sustain/articulation rendering branch is intentionally limited to
 * guitar and bass. Rhythm/keys may share the five-fret schema, but their
 * piano-roll behavior remains the existing generic path. */
export function isGuitarBassSchema(schema: InstrumentSchema | null): boolean {
  return schema?.instrument === 'guitar' || schema?.instrument === 'bass';
}

/** True while any visible part of a note span overlaps the piano-roll view.
 * Guitar/bass sustains use the note end, not just the head, so a long tail
 * remains paintable after its root has crossed the left edge. */
export function noteIntersectsPianoRollWindow(
  startMs: number,
  endMs: number,
  visibleStartMs: number,
  visibleEndMs: number,
  paddingMs = 50,
): boolean {
  return (
    endMs >= visibleStartMs - paddingMs && startMs <= visibleEndMs + paddingMs
  );
}

/** Resolve the persisted flag mask to one display state. Malformed charts
 * can contain multiple technique bits; the explicit tap > HOPO > strum
 * precedence matches the highway renderer and keeps the editor deterministic. */
export function techniqueForFlags(flags: number): FretTechnique {
  if (flags & noteFlags.tap) return 'tap';
  if (flags & noteFlags.hopo) return 'hopo';
  if (flags & noteFlags.strum) return 'strum';
  return 'natural';
}

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
  /** Guitar/bass flag mask. Omitted for drum notes to preserve the drum
   *  projection's existing shape and behavior. */
  flags?: number;
  /** Guitar/bass sustain length in ticks. Omitted for drum notes. */
  length?: number;
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
      ...(isGuitarBassSchema(schema)
        ? {flags: note.flags, length: note.length}
        : {}),
    });
  }
  out.sort((a, b) => a.tick - b.tick);
  return out;
}
