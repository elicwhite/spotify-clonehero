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

/**
 * Default mel spectrogram config matching the CRNN training pipeline
 * (pipeline/build_packed_dataset.py: 48 kHz, nFft=1024, hop=480 -> 100 fps,
 * 256 HTK mel bands, fmin=0, fmax=Nyquist).
 */
export const DEFAULT_MEL_CONFIG: MelSpectrogramConfig = {
  sampleRate: 48000,
  nFft: 1024,
  hopLength: 480, // 100 fps
  nMels: 256,
  fMin: 0,
  fMax: 24000, // Nyquist
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
    | 'inference'
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

/** Frames per second of the model output grid. */
export const MODEL_FPS = 100;

/**
 * NMS window for peak picking, in frames on each side of a kept peak
 * (20 ms at 100 fps).
 */
export const PEAK_NMS_FRAMES = 2;

/**
 * Per-lane detection thresholds for the CRNN model, in model output order
 * (BD, SD, HT, MT, FT, HH, CR, CR2, RD). A peak is kept when its height is
 * strictly greater than the lane threshold. Lanes with a threshold > 1.5 are
 * structurally excluded (never fire) — crash-2 = 2.0 matches the deployed
 * reference (adt_eval provisional thresholds).
 */
export const CRNN_THRESHOLDS: readonly number[] = [
  0.5, // BD
  0.5, // SD
  0.75, // HT
  0.75, // MT
  0.75, // FT
  0.65, // HH
  0.75, // CR
  2.0, // CR2 (excluded)
  0.65, // RD
];

/** Lanes whose threshold exceeds this value are skipped entirely. */
export const THRESHOLD_LANE_EXCLUDED = 1.5;

// ---------------------------------------------------------------------------
// Song context configuration
// ---------------------------------------------------------------------------

/**
 * Dimensionality of the song context vector: the 512-dim time-mean of the
 * stereo mel (L 256 bins, then R 256 bins) tiled 10x.
 */
export const SONG_CONTEXT_DIM = 5120;

// ---------------------------------------------------------------------------
// Windowed inference configuration
// ---------------------------------------------------------------------------

/** Number of frames per inference window (5 seconds at 100 fps). */
export const WINDOW_SIZE = 500;

/** Stride between windows (25% overlap). */
export const WINDOW_STRIDE = 375; // WINDOW_SIZE * 3 / 4
