/**
 * InstrumentSchema registry.
 *
 * Editor + renderer code reads `schemaForTrack(track)` to get the
 * presentation data for the active track's instrument. Schemas are
 * intentionally narrow — they describe lanes, flags, and default key
 * bindings, never canonical chart data (which lives in scan-chart).
 *
 * Adding a new instrument:
 *   1. Define a schema in a new file in this directory.
 *   2. Export it from this barrel.
 *   3. Add a case to `schemaForTrack` (and `schemaForInstrument`).
 *
 * Some instruments (vocals, dance) have no lane geometry. Schemas for
 * those return empty `lanes` arrays; the editor's `EditorScope` for
 * vocals (`{ kind: 'vocals', part: ... }`) bypasses the schema entirely.
 */

import type {DrumType, Instrument, ParsedTrackData} from '../types';
import type {InstrumentSchema} from './types';
import {drumSchemaFor, drums4LaneSchema, drums5LaneSchema} from './drums';
import {bassSchema, guitarSchema, keysSchema, rhythmSchema} from './guitar';

export type {
  InstrumentSchema,
  LaneDefinition,
  FlagBinding,
  NoteFlagName,
} from './types';
export {drumSchemaFor, drums4LaneSchema, drums5LaneSchema};
export {bassSchema, guitarSchema, keysSchema, rhythmSchema};

/**
 * Resolve a schema for an `Instrument` id alone — used when no
 * `ParsedTrackData` is in hand (e.g. a profile that pre-declares its
 * instrument). Drum tracks pick the 4-lane schema; use
 * `schemaForTrack(track)` if 5-lane needs to be honored.
 */
export function schemaForInstrument(
  instrument: Instrument,
): InstrumentSchema | null {
  switch (instrument) {
    case 'drums':
      return drums4LaneSchema;
    case 'guitar':
      return guitarSchema;
    case 'bass':
      return bassSchema;
    case 'rhythm':
      return rhythmSchema;
    case 'keys':
      return keysSchema;
    default:
      return null;
  }
}

/**
 * Resolve a schema for a `ParsedTrackData`. For drum tracks this honors
 * the chart-level `drumType` (4-lane vs 5-lane) — `drumType` lives on
 * `ParsedChart`, not on the track itself, so callers must pass it
 * explicitly when they want the right drum variant.
 */
export function schemaForTrack(
  track: ParsedTrackData,
  drumType?: DrumType | null,
): InstrumentSchema | null {
  if (track.instrument === 'drums') {
    return drumSchemaFor(drumType ?? null);
  }
  return schemaForInstrument(track.instrument);
}

/**
 * Look up a lane by display index for a given schema. Returns null if
 * the index is out of range.
 */
export function laneAt(
  schema: InstrumentSchema,
  index: number,
): InstrumentSchema['lanes'][number] | null {
  return schema.lanes[index] ?? null;
}

/**
 * Find the lane that represents a scan-chart `NoteType`. For schemas
 * with `variant`-disambiguated lanes, callers must pass the variant
 * they care about; without it, returns the first match.
 */
export function laneForNoteType(
  schema: InstrumentSchema,
  noteType: number,
  variant?: string,
): InstrumentSchema['lanes'][number] | null {
  for (const lane of schema.lanes) {
    if (lane.noteType !== noteType) continue;
    if (variant !== undefined && lane.variant !== variant) continue;
    return lane;
  }
  return null;
}
