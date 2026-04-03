/**
 * Type definitions for the chart-edit library.
 *
 * Extends scan-chart's RawChartData with metadata, format info, and assets.
 * All scan-chart types are re-exported for consumer convenience.
 */

import type {
  RawChartData,
  EventType,
  Instrument,
  Difficulty,
  IniChartModifiers,
} from '@eliwhite/scan-chart';
import { eventTypes, instruments, difficulties } from '@eliwhite/scan-chart';

// Re-export scan-chart types for consumers
export type { RawChartData, EventType, Instrument, Difficulty, IniChartModifiers };
export { eventTypes, instruments, difficulties };

// ---------------------------------------------------------------------------
// FileEntry
// ---------------------------------------------------------------------------

/** A file with its name and binary data. Same shape as scan-chart I/O. */
export interface FileEntry {
  fileName: string;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// ChartMetadata (song.ini source of truth)
// ---------------------------------------------------------------------------

/** Full song.ini field set. All fields optional. */
export interface ChartMetadata {
  name?: string;
  artist?: string;
  album?: string;
  genre?: string;
  year?: string;
  charter?: string;
  song_length?: number;
  diff_band?: number;
  diff_guitar?: number;
  diff_guitar_coop?: number;
  diff_rhythm?: number;
  diff_bass?: number;
  diff_drums?: number;
  diff_drums_real?: number;
  diff_keys?: number;
  diff_guitarghl?: number;
  diff_guitar_coop_ghl?: number;
  diff_rhythm_ghl?: number;
  diff_bassghl?: number;
  diff_vocals?: number;
  preview_start_time?: number;
  icon?: string;
  loading_phrase?: string;
  album_track?: number;
  playlist_track?: number;
  modchart?: boolean;
  delay?: number;
  hopo_frequency?: number;
  eighthnote_hopo?: boolean;
  multiplier_note?: number;
  sustain_cutoff_threshold?: number;
  chord_snap_threshold?: number;
  video_start_time?: number;
  five_lane_drums?: boolean;
  pro_drums?: boolean;
  end_events?: boolean;
  /**
   * Preserves any song.ini fields not explicitly modeled in ChartMetadata.
   * Written verbatim after known fields during INI serialization to prevent
   * data loss on round-trip (e.g. sysex_slider, sysex_open_bass, diff_bass_real).
   */
  extraIniFields?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ChartDocument
// ---------------------------------------------------------------------------

/**
 * Extends scan-chart's RawChartData with fields needed for write-back and metadata.
 *
 * Spreads all of RawChartData's fields directly:
 * - chartTicksPerBeat, hasLyrics, hasVocals, lyrics, vocalPhrases
 * - tempos, timeSignatures, sections, endEvents, trackData
 *
 * RawChartData.metadata is overridden by ChartDocument.metadata (full ChartMetadata).
 */
export interface ChartDocument extends Omit<RawChartData, 'metadata'> {
  /** Song metadata (source of truth for song.ini output). */
  metadata: ChartMetadata;
  /** Original file format — determines write-back format. */
  originalFormat: 'chart' | 'mid';
  /** Pass-through files not managed by the library (audio, album art, video). */
  assets: FileEntry[];
  /**
   * Raw key-value pairs from the .chart [Song] section, preserving original
   * field order and unknown fields (Player2, MediaType, etc.) that scan-chart
   * doesn't parse. Used by the .chart writer for byte-level roundtrip fidelity.
   * Only populated when reading .chart files.
   */
  chartSongSection?: Array<{ key: string; value: string }>;
}

/**
 * Extract the TrackData element type from RawChartData.trackData.
 * scan-chart doesn't export this as a named type.
 */
export type TrackData = RawChartData['trackData'][number];

/** A single track event from scan-chart's trackEvents array. */
export type TrackEvent = TrackData['trackEvents'][number];

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
// DrumNoteType ↔ EventType Mapping
// ---------------------------------------------------------------------------

/** Map DrumNoteType → base EventType for the note itself. */
export const drumNoteEventType: Record<DrumNoteType, EventType> = {
  kick: eventTypes.kick,
  redDrum: eventTypes.redDrum,
  yellowDrum: eventTypes.yellowDrum,
  blueDrum: eventTypes.blueDrum,
  greenDrum: eventTypes.fiveOrangeFourGreenDrum,
  fiveGreenDrum: eventTypes.fiveGreenDrum,
};

/** Reverse: EventType → DrumNoteType (only for base note types). */
export const eventTypeToDrumNote: Partial<Record<EventType, DrumNoteType>> = {
  [eventTypes.kick]: 'kick',
  [eventTypes.redDrum]: 'redDrum',
  [eventTypes.yellowDrum]: 'yellowDrum',
  [eventTypes.blueDrum]: 'blueDrum',
  [eventTypes.fiveOrangeFourGreenDrum]: 'greenDrum',
  [eventTypes.fiveGreenDrum]: 'fiveGreenDrum',
};

/** Cymbal marker EventTypes per DrumNoteType (only yellow/blue/green). */
export const drumCymbalEventType: Partial<Record<DrumNoteType, EventType>> = {
  yellowDrum: eventTypes.yellowCymbalMarker,
  blueDrum: eventTypes.blueCymbalMarker,
  greenDrum: eventTypes.greenCymbalMarker,
};

/** Tom marker EventTypes per DrumNoteType (for MIDI — only yellow/blue/green). */
export const drumTomEventType: Partial<Record<DrumNoteType, EventType>> = {
  yellowDrum: eventTypes.yellowTomMarker,
  blueDrum: eventTypes.blueTomMarker,
  greenDrum: eventTypes.greenTomMarker,
};

/** Accent marker EventTypes per DrumNoteType. */
export const drumAccentEventType: Partial<Record<DrumNoteType, EventType>> = {
  redDrum: eventTypes.redAccent,
  yellowDrum: eventTypes.yellowAccent,
  blueDrum: eventTypes.blueAccent,
  greenDrum: eventTypes.fiveOrangeFourGreenAccent,
  fiveGreenDrum: eventTypes.fiveGreenAccent,
};

/** Ghost marker EventTypes per DrumNoteType. */
export const drumGhostEventType: Partial<Record<DrumNoteType, EventType>> = {
  redDrum: eventTypes.redGhost,
  yellowDrum: eventTypes.yellowGhost,
  blueDrum: eventTypes.blueGhost,
  greenDrum: eventTypes.fiveOrangeFourGreenGhost,
  fiveGreenDrum: eventTypes.fiveGreenGhost,
};

/** Set of EventTypes that are base drum note types (not modifiers). */
export const baseDrumEventTypes = new Set<EventType>([
  eventTypes.kick,
  eventTypes.redDrum,
  eventTypes.yellowDrum,
  eventTypes.blueDrum,
  eventTypes.fiveOrangeFourGreenDrum,
  eventTypes.fiveGreenDrum,
]);

/** Set of EventTypes that are drum modifier types. */
export const drumModifierEventTypes = new Set<EventType>([
  eventTypes.kick2x,
  eventTypes.yellowCymbalMarker,
  eventTypes.blueCymbalMarker,
  eventTypes.greenCymbalMarker,
  eventTypes.yellowTomMarker,
  eventTypes.blueTomMarker,
  eventTypes.greenTomMarker,
  eventTypes.redAccent,
  eventTypes.yellowAccent,
  eventTypes.blueAccent,
  eventTypes.fiveOrangeFourGreenAccent,
  eventTypes.fiveGreenAccent,
  eventTypes.redGhost,
  eventTypes.yellowGhost,
  eventTypes.blueGhost,
  eventTypes.fiveOrangeFourGreenGhost,
  eventTypes.fiveGreenGhost,
  eventTypes.forceFlam,
]);
