/**
 * Type definitions for the chart-edit library.
 *
 * The core data model — `ChartDocument`, `ParsedChart`, `File` — lives in
 * `@eliwhite/scan-chart`. This file re-exports the scan-chart surface and
 * adds the drum-helper types specific to this project.
 */

import type {
  ChartDocument,
  File,
  ParsedChart,
  RawChartData,
  EventType,
  Instrument,
  Difficulty,
  IniChartModifiers,
  NoteEvent,
  NoteType,
  NormalizedVocalTrack,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
  NormalizedLyricEvent,
  NormalizedVocalNote,
  DrumType,
  VocalTrackData,
} from '@eliwhite/scan-chart';
import {
  eventTypes,
  instruments,
  difficulties,
  noteTypes,
  noteFlags,
  lyricFlags,
  drumTypes,
} from '@eliwhite/scan-chart';

// Re-export scan-chart types for consumers
export type {
  ChartDocument,
  File,
  ParsedChart,
  RawChartData,
  EventType,
  Instrument,
  Difficulty,
  IniChartModifiers,
  NoteEvent,
  NoteType,
  NormalizedVocalTrack,
  NormalizedVocalPart,
  NormalizedVocalPhrase,
  NormalizedLyricEvent,
  NormalizedVocalNote,
  DrumType,
  VocalTrackData,
};
export {
  eventTypes,
  instruments,
  difficulties,
  noteTypes,
  noteFlags,
  lyricFlags,
  drumTypes,
};

/** A single track in a ParsedChart (one instrument + difficulty combo). */
export type ParsedTrackData = ParsedChart['trackData'][number];

// ---------------------------------------------------------------------------
// Drum Helper Types
// ---------------------------------------------------------------------------

/**
 * Friendly view of a drum note, returned by getDrumNotes(). `type` is the
 * scan-chart `NoteType` directly (no drum-only string-alias layer); `flags`
 * is the scan-chart flag bitmask. Friendly labels/legality come from
 * `InstrumentSchema.lanes[].label` / `flagBindings` (`lib/chart-edit/instruments/drums.ts`),
 * not from a parallel type.
 */
export interface DrumNote {
  tick: number;
  length: number;
  type: NoteType;
  flags: number;
}
