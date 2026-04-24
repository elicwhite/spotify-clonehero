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

export type DrumNoteType =
  | 'kick'
  | 'redDrum'
  | 'yellowDrum'
  | 'blueDrum'
  | 'greenDrum'
  | 'fiveGreenDrum';

export interface DrumNoteFlags {
  cymbal?: boolean;
  doubleKick?: boolean;
  accent?: boolean;
  ghost?: boolean;
  flam?: boolean;
}

/** Friendly view of a drum note, returned by getDrumNotes(). */
export interface DrumNote {
  tick: number;
  length: number;
  type: DrumNoteType;
  flags: DrumNoteFlags;
}

// ---------------------------------------------------------------------------
// DrumNoteType ↔ NoteType Mapping
// ---------------------------------------------------------------------------

/** Map DrumNoteType → NoteType for the note itself. */
export const drumNoteTypeMap: Record<DrumNoteType, NoteType> = {
  kick: noteTypes.kick,
  redDrum: noteTypes.redDrum,
  yellowDrum: noteTypes.yellowDrum,
  blueDrum: noteTypes.blueDrum,
  greenDrum: noteTypes.greenDrum,
  fiveGreenDrum: noteTypes.greenDrum, // 5-lane green maps to same NoteType
};

/** Reverse: NoteType → DrumNoteType (only for base note types). */
export const noteTypeToDrumNote: Partial<Record<NoteType, DrumNoteType>> = {
  [noteTypes.kick]: 'kick',
  [noteTypes.redDrum]: 'redDrum',
  [noteTypes.yellowDrum]: 'yellowDrum',
  [noteTypes.blueDrum]: 'blueDrum',
  [noteTypes.greenDrum]: 'greenDrum',
};
