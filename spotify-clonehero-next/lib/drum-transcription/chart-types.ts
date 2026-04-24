/**
 * Re-exports from chart-edit + drum-transcription-specific types.
 *
 * All chart I/O types come from chart-edit. This file adds types
 * that are specific to the drum transcription pipeline (ML output,
 * timing helpers, validation).
 */

// Re-export everything consumers need from chart-edit
export type {
  ChartDocument,
  File,
  ParsedTrackData,
  NoteEvent,
  DrumNote,
  DrumNoteType,
  DrumNoteFlags,
  EventType,
  Instrument,
  Difficulty,
} from '@/lib/chart-edit';

export {
  readChart,
  createEmptyChart,
  writeChartFolder,
  addDrumNote,
  removeDrumNote,
  getDrumNotes,
  setDrumNoteFlags,
  addStarPower,
  removeStarPower,
  addActivationLane,
  removeActivationLane,
  addSoloSection,
  removeSoloSection,
  addFlexLane,
  removeFlexLane,
  addTempo,
  removeTempo,
  addTimeSignature,
  removeTimeSignature,
  addSection,
  removeSection,
  eventTypes,
  instruments,
  difficulties,
} from '@/lib/chart-edit';

// Re-export scan-chart types used by drum-transcription
export type {NoteType} from '@eliwhite/scan-chart';
export {noteTypes, noteFlags} from '@eliwhite/scan-chart';

// ---------------------------------------------------------------------------
// Drum-transcription-specific types (not in chart-edit)
// ---------------------------------------------------------------------------

/** A tempo event with its pre-computed absolute millisecond time. */
export interface TimedTempo {
  tick: number;
  beatsPerMinute: number;
  msTime: number;
}

/** A drum hit detected by the ML transcription model, before quantization. */
export interface RawDrumHit {
  /** Time in seconds from the start of the audio. */
  timeSeconds: number;
  /** The drum instrument detected (mapped to scan-chart NoteType). */
  noteType: import('@eliwhite/scan-chart').NoteType;
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
  noteType: import('@eliwhite/scan-chart').NoteType;
  /** Original confidence from the ML model. */
  confidence: number;
  /** Original time in seconds (before quantization). */
  originalTimeSeconds: number;
  /** Quantization error in milliseconds (positive = snapped later, negative = earlier). */
  quantizationErrorMs: number;
}

/** Validation result with auto-corrected document. */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
  document: import('@/lib/chart-edit').ChartDocument;
}
