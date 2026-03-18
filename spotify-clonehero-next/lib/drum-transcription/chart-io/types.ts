/**
 * Type definitions for the drum transcription chart I/O layer.
 *
 * Reuses scan-chart types directly where possible. These types represent
 * the in-memory chart document that the writer serializes to .chart format
 * and the editor works with.
 *
 * See plan 0002 for the full specification.
 */

import type {Instrument, Difficulty, NoteType} from '@eliwhite/scan-chart';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

// Re-export scan-chart types so consumers can import from one place
export type {Instrument, Difficulty, NoteType};
export {noteTypes, noteFlags};

// ---------------------------------------------------------------------------
// Tempo & Time Signature
// ---------------------------------------------------------------------------

/**
 * A tempo (BPM) change event at a specific tick.
 *
 * Matches the shape of `RawChartData['tempos'][number]` from scan-chart,
 * except we use `bpm` instead of `beatsPerMinute` for brevity.
 * Convert to/from `beatsPerMinute` at the boundary.
 */
export interface TempoEvent {
  tick: number;
  /** BPM as a float (e.g. 120.0). Serialized as millibeats (120000). */
  bpm: number;
}

/**
 * Same shape as `RawChartData['timeSignatures'][number]` from scan-chart.
 */
export interface TimeSignatureEvent {
  tick: number;
  numerator: number;
  /** Denominator as the actual value (4, 8, etc.), NOT the exponent. */
  denominator: number;
}

/**
 * Same shape as `RawChartData['sections'][number]` from scan-chart.
 */
export interface SectionEvent {
  tick: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Song Metadata
// ---------------------------------------------------------------------------

/**
 * Chart metadata for the [Song] section.
 *
 * scan-chart exports `RawChartData['metadata']` with a subset of these
 * fields (name, artist, album, genre, year, charter, delay,
 * preview_start_time). We extend beyond that for serialization-specific
 * fields (musicStream, drumStream, etc.) that scan-chart does not model.
 * This type is NOT exported by scan-chart.
 */
export interface ChartMetadata {
  name: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: string;
  charter?: string;
  resolution: number; // Same as ChartDocument.resolution
  offset?: number; // Seconds (float). Audio delay.
  difficulty?: number; // Overall difficulty rating
  previewStart?: number; // Seconds (float)
  previewEnd?: number; // Seconds (float)
  /** Audio stem file references */
  musicStream?: string; // e.g. "song.ogg"
  drumStream?: string; // e.g. "drums.ogg"
}

// ---------------------------------------------------------------------------
// Track Data
// ---------------------------------------------------------------------------

/**
 * Uses `Instrument` and `Difficulty` from `@eliwhite/scan-chart`.
 * The `starPower` and `activationLanes` shapes match
 * `RawChartData['trackData'][number]['starPowerSections']` and
 * `RawChartData['trackData'][number]['drumFreestyleSections']` respectively.
 */
export interface TrackData {
  instrument: Instrument;
  difficulty: Difficulty;
  notes: DrumNote[];
  /** Star power phrases. */
  starPower?: {tick: number; length: number}[];
  /** Drum activation lanes (freestyle sections). */
  activationLanes?: {tick: number; length: number}[];
}

// ---------------------------------------------------------------------------
// Drum Notes
// ---------------------------------------------------------------------------

/**
 * Note: scan-chart's `NoteEvent` (exported) uses numeric `NoteType` and a
 * bitmask `flags` field. Our `DrumNote` uses string-based `DrumNoteType`
 * and a boolean-based `DrumNoteFlags` for ergonomic construction from ML
 * output. Conversion between these representations happens at
 * serialization time and uses `noteTypes` / `noteFlags` from scan-chart.
 *
 * `DrumNote` is NOT exported by scan-chart -- it is specific to our writer.
 */
export interface DrumNote {
  tick: number;
  /** Note type determines which .chart note number(s) to emit. */
  type: DrumNoteType;
  /** Note length in ticks. 0 for non-sustained hits (almost always 0 for drums). */
  length: number;
  /** Flags for pro drums (cymbal), accent, ghost, double kick. */
  flags: DrumNoteFlags;
}

/**
 * String-based drum note type for ergonomic construction. Maps to
 * scan-chart's numeric `noteTypes.kick`, `noteTypes.redDrum`, etc.
 * NOT exported by scan-chart.
 */
export type DrumNoteType = 'kick' | 'red' | 'yellow' | 'blue' | 'green';

/**
 * Boolean-based flags for ergonomic construction. Maps to scan-chart's
 * bitmask `noteFlags` (cymbal=32, doubleKick=8, ghost=512, accent=1024).
 * NOT exported by scan-chart.
 */
export interface DrumNoteFlags {
  cymbal?: boolean; // For yellow/blue/green in pro drums mode
  doubleKick?: boolean; // Expert+ double kick (note 32)
  accent?: boolean;
  ghost?: boolean;
}

// ---------------------------------------------------------------------------
// Chart Document (in-memory representation)
// ---------------------------------------------------------------------------

/**
 * Top-level chart document. Everything needed to write a .chart file.
 *
 * This mirrors the shape of scan-chart's `RawChartData` (exported from
 * `@eliwhite/scan-chart`). Fields like `tempos`, `timeSignatures`,
 * `sections`, and `endEvents` use the same structure as `RawChartData`
 * so that data can move between parsing and serialization without
 * transformation. `ChartDocument` is NOT directly exported by scan-chart,
 * so we define it here.
 */
export interface ChartDocument {
  /** Ticks per quarter note. Use 480 for our pipeline. */
  resolution: number;

  metadata: ChartMetadata;

  /** Must be sorted by tick, ascending. First entry must be at tick 0. */
  tempos: TempoEvent[];

  /** Must be sorted by tick, ascending. First entry must be at tick 0. */
  timeSignatures: TimeSignatureEvent[];

  /** Section markers (e.g. "Intro", "Verse 1"). Sorted by tick. */
  sections: SectionEvent[];

  /** End event, if any. */
  endEvents: {tick: number}[];

  /** Note tracks keyed by instrument+difficulty. For drums, we only need ExpertDrums. */
  tracks: TrackData[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** The (possibly auto-corrected) document */
  document: ChartDocument;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** A tempo event annotated with its absolute millisecond time. */
export interface TimedTempo {
  tick: number;
  bpm: number;
  msTime: number;
}

// ---------------------------------------------------------------------------
// Drum-specific types for the transcription pipeline
// ---------------------------------------------------------------------------

/** A drum hit detected by the ML transcription model, before quantization. */
export interface RawDrumHit {
  /** Time in seconds from the start of the audio. */
  timeSeconds: number;
  /** The drum instrument detected (mapped to scan-chart NoteType). */
  noteType: NoteType;
  /** Confidence score from the ML model, 0.0 to 1.0. */
  confidence: number;
}

/**
 * A quantized drum note ready to be placed on the chart.
 * This is the output of the quantization step that snaps raw hits to
 * the nearest tick grid position.
 */
export interface QuantizedDrumNote {
  /** Chart tick position (quantized). */
  tick: number;
  /** The drum instrument. */
  noteType: NoteType;
  /** Original confidence from the ML model. */
  confidence: number;
  /** Original time in seconds (before quantization). */
  originalTimeSeconds: number;
  /** Quantization error in milliseconds (positive = snapped later, negative = earlier). */
  quantizationErrorMs: number;
}
