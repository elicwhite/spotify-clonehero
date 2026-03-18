/**
 * Type definitions for the ML drum transcription pipeline.
 *
 * These types represent the data flowing through the pipeline:
 *   audio -> spectrogram -> ONNX model -> raw output -> peak picking -> class mapping -> chart notes
 */

// ---------------------------------------------------------------------------
// Spectrogram Configuration
// ---------------------------------------------------------------------------

/**
 * Parameters for the log-filtered spectrogram computation.
 * These must exactly match ADTOF's training configuration from
 * `adtof/model/hyperparameters.py`.
 */
export interface SpectrogramConfig {
  /** Sample rate in Hz. */
  sampleRate: number;
  /** FFT frame size in samples. */
  frameSize: number;
  /** Frames per second (hop_length = sampleRate / fps). */
  fps: number;
  /** Number of logarithmic frequency bands per octave. */
  bandsPerOctave: number;
  /** Minimum frequency for the filterbank in Hz. */
  fMin: number;
  /** Maximum frequency for the filterbank in Hz. */
  fMax: number;
}

/** Default spectrogram config matching ADTOF's Frame_RNN model. */
export const DEFAULT_SPECTROGRAM_CONFIG: SpectrogramConfig = {
  sampleRate: 44100,
  frameSize: 2048,
  fps: 100,
  bandsPerOctave: 12,
  fMin: 20,
  fMax: 20000,
};

// ---------------------------------------------------------------------------
// ADTOF Model Classes
// ---------------------------------------------------------------------------

/** A single ADTOF output class definition. */
export interface AdtofClass {
  readonly index: number;
  readonly midiPitch: number;
  readonly name: string;
  readonly description: string;
}

/** ADTOF's 5 output classes, in the order the model outputs them. */
export const ADTOF_CLASSES: readonly AdtofClass[] = [
  {index: 0, midiPitch: 35, name: 'BD', description: 'Bass Drum'},
  {index: 1, midiPitch: 38, name: 'SD', description: 'Snare Drum'},
  {index: 2, midiPitch: 47, name: 'TT', description: 'Tom-Tom (all toms grouped)'},
  {index: 3, midiPitch: 42, name: 'HH', description: 'Hi-Hat (open + closed grouped)'},
  {
    index: 4,
    midiPitch: 49,
    name: 'CY+RD',
    description: 'Cymbal + Ride (all cymbals grouped)',
  },
] as const;

/** Number of output classes from the ADTOF model. */
export const NUM_ADTOF_CLASSES = 5;

/** ADTOF class name union type. */
export type AdtofClassName = 'BD' | 'SD' | 'TT' | 'HH' | 'CY+RD';

// ---------------------------------------------------------------------------
// Model Output
// ---------------------------------------------------------------------------

/** Raw output from the ONNX model before post-processing. */
export interface ModelOutput {
  /** Per-frame sigmoid predictions, shape [n_frames, 5], row-major. */
  predictions: Float32Array;
  /** Number of time frames. */
  nFrames: number;
  /** Number of output classes (always 5). */
  nClasses: number;
}

// ---------------------------------------------------------------------------
// Drum Events (pipeline stages)
// ---------------------------------------------------------------------------

/**
 * A raw drum event from peak picking, before class-to-chart mapping.
 * This is the intermediate format between model output and chart notes.
 */
export interface RawDrumEvent {
  /** Time in seconds from the start of the audio. */
  timeSeconds: number;
  /** ADTOF class name. */
  drumClass: AdtofClassName;
  /** General MIDI pitch number for this drum class. */
  midiPitch: number;
  /** Peak confidence score from the model, 0.0 to 1.0. */
  confidence: number;
}

/**
 * A drum event with chart note mapping applied, ready for tick quantization.
 * This is the output of the class mapping stage.
 */
export interface EditorDrumEvent {
  /** Unique ID for the editor. */
  id: string;
  /** Tick position on the chart (after quantization). */
  tick: number;
  /** Millisecond time in the audio. */
  msTime: number;
  /** .chart note number (0=kick, 1=red, 2=yellow, 3=blue, 4=green). */
  noteNumber: number;
  /** Pro drums cymbal marker (66, 67, 68) or null. */
  cymbalMarker: number | null;
  /** Source ADTOF class name. */
  modelClass: AdtofClassName;
  /** Confidence from the model, or null for manually added notes. */
  confidence: number | null;
  /** Whether the note has been reviewed by the user. */
  reviewed: boolean;
  /** Source of this note. */
  source: 'model' | 'manual';
}

// ---------------------------------------------------------------------------
// Transcription Result
// ---------------------------------------------------------------------------

/** Complete result from the transcription pipeline. */
export interface TranscriptionResult {
  /** Raw drum events with timestamps and confidence scores. */
  events: RawDrumEvent[];
  /** Model output predictions (for visualization / debugging). */
  modelOutput: ModelOutput;
  /** Duration of the audio in seconds. */
  durationSeconds: number;
}

// ---------------------------------------------------------------------------
// Transcription Progress
// ---------------------------------------------------------------------------

/** Progress updates from the transcription pipeline. */
export interface TranscriptionProgress {
  step:
    | 'loading-model'
    | 'computing-spectrogram'
    | 'running-inference'
    | 'post-processing'
    | 'done';
  /** Overall progress from 0 to 1. */
  percent: number;
  /** Optional detail message. */
  detail?: string;
}

/** Callback type for progress updates. */
export type TranscriptionProgressCallback = (
  progress: TranscriptionProgress,
) => void;

// ---------------------------------------------------------------------------
// Peak Picking Configuration
// ---------------------------------------------------------------------------

/** Parameters for the madmom-style peak picking algorithm. */
export interface PeakPickingParams {
  /** Pre-average window in seconds. */
  preAvg: number;
  /** Post-average window in seconds. */
  postAvg: number;
  /** Pre-max window in seconds. */
  preMax: number;
  /** Post-max window in seconds. */
  postMax: number;
  /** Combine window in seconds (merge detections within this window). */
  combine: number;
  /** Frames per second (100 for ADTOF). */
  fps: number;
}

/** Default peak picking parameters from ADTOF. */
export const DEFAULT_PEAK_PICKING_PARAMS: PeakPickingParams = {
  preAvg: 0.1,
  postAvg: 0.01,
  preMax: 0.02,
  postMax: 0.01,
  combine: 0.02,
  fps: 100,
};

/** Per-class detection thresholds, optimized during ADTOF validation. */
export const ADTOF_THRESHOLDS: Record<AdtofClassName, number> = {
  BD: 0.22,
  SD: 0.24,
  TT: 0.32,
  HH: 0.22,
  'CY+RD': 0.3,
};
