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
 * Parameters for the log-filtered spectrogram computation (legacy ADTOF).
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

/**
 * Parameters for the mel spectrogram computation (CRNN model).
 */
export interface MelSpectrogramConfig {
  /** Sample rate in Hz. */
  sampleRate: number;
  /** FFT size in samples. */
  nFft: number;
  /** Hop length in samples (sampleRate / fps). */
  hopLength: number;
  /** Number of mel frequency bands. */
  nMels: number;
  /** Minimum frequency for the filterbank in Hz. */
  fMin: number;
  /** Maximum frequency for the filterbank in Hz (Nyquist). */
  fMax: number;
}

/** Default mel spectrogram config matching the CRNN training pipeline. */
export const DEFAULT_MEL_CONFIG: MelSpectrogramConfig = {
  sampleRate: 44100,
  nFft: 2048,
  hopLength: 441, // 100 fps
  nMels: 128,
  fMin: 0,
  fMax: 22050, // Nyquist
};

// ---------------------------------------------------------------------------
// CRNN Model Classes (9 instruments)
// ---------------------------------------------------------------------------

/** A single drum class definition. */
export interface DrumClass {
  readonly index: number;
  readonly midiPitch: number;
  readonly name: string;
  readonly description: string;
}

/** The CRNN model's 9 output classes, in model output order. */
export const DRUM_CLASSES: readonly DrumClass[] = [
  {index: 0, midiPitch: 36, name: 'BD', description: 'Bass Drum (kick)'},
  {index: 1, midiPitch: 38, name: 'SD', description: 'Snare Drum'},
  {index: 2, midiPitch: 50, name: 'HT', description: 'High Tom'},
  {index: 3, midiPitch: 47, name: 'MT', description: 'Mid Tom'},
  {index: 4, midiPitch: 43, name: 'FT', description: 'Floor Tom'},
  {index: 5, midiPitch: 42, name: 'HH', description: 'Hi-Hat'},
  {index: 6, midiPitch: 49, name: 'CR', description: 'Crash Cymbal'},
  {index: 7, midiPitch: 57, name: 'CR2', description: 'Crash Cymbal 2'},
  {index: 8, midiPitch: 51, name: 'RD', description: 'Ride Cymbal'},
] as const;

/** Number of output classes from the CRNN model. */
export const NUM_DRUM_CLASSES = 9;

/** CRNN drum class name union type. */
export type DrumClassName =
  | 'BD'
  | 'SD'
  | 'HT'
  | 'MT'
  | 'FT'
  | 'HH'
  | 'CR'
  | 'CR2'
  | 'RD';

// ---------------------------------------------------------------------------
// Model Output
// ---------------------------------------------------------------------------

/** Raw output from the ONNX model before post-processing. */
export interface ModelOutput {
  /** Per-frame sigmoid predictions, shape [n_frames, 9], row-major. */
  predictions: Float32Array;
  /** Number of time frames. */
  nFrames: number;
  /** Number of output classes (9). */
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
  /** CRNN drum class name. */
  drumClass: DrumClassName;
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
  /** Source CRNN class name. */
  modelClass: DrumClassName;
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
    | 'computing-panning'
    | 'inference-pass-1'
    | 'inference-pass-2'
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
  /** Frames per second (100 for CRNN). */
  fps: number;
}

/** Default peak picking parameters. */
export const DEFAULT_PEAK_PICKING_PARAMS: PeakPickingParams = {
  preAvg: 0.1,
  postAvg: 0.01,
  preMax: 0.02,
  postMax: 0.01,
  combine: 0.02,
  fps: 100,
};

/** Per-class detection thresholds for the CRNN model (initial values, tune later). */
export const CRNN_THRESHOLDS: Record<DrumClassName, number> = {
  BD: 0.25,
  SD: 0.25,
  HT: 0.3,
  MT: 0.3,
  FT: 0.3,
  HH: 0.25,
  CR: 0.3,
  CR2: 0.3,
  RD: 0.3,
};

// ---------------------------------------------------------------------------
// Panning configuration
// ---------------------------------------------------------------------------

/** Frequency bands for panning feature computation (Hz). */
export const PANNING_BANDS_HZ: readonly [number, number][] = [
  [0, 300],
  [300, 3000],
  [3000, 8000],
  [8000, 20000],
];

// ---------------------------------------------------------------------------
// Song context configuration
// ---------------------------------------------------------------------------

/** Dimensionality of the song context vector. */
export const SONG_CONTEXT_DIM = 1280; // 128 (mean mel) + 9 * 128 (per-instrument onset mel)

/** Radius (in frames) around each onset for computing per-instrument mel profiles. */
export const ONSET_RADIUS = 5;

// ---------------------------------------------------------------------------
// Windowed inference configuration
// ---------------------------------------------------------------------------

/** Number of frames per inference window (5 seconds at 100 fps). */
export const WINDOW_SIZE = 500;

/** Stride between windows (25% overlap). */
export const WINDOW_STRIDE = 375; // WINDOW_SIZE * 3 / 4
