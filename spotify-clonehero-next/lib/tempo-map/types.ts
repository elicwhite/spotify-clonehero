/**
 * Shared types for the tempo-mapping pipeline (audio → synctrack).
 */

export interface TempoEvent {
  /** Wall-clock time of the tempo change, in ms. */
  ms: number;
  bpm: number;
}

export interface TimeSignatureEvent {
  ms: number;
  numerator: number;
  denominator: number;
}

/** Output of the beats → synctrack converter. */
export interface Synctrack {
  origin_ms: number;
  tempos: TempoEvent[];
  timeSignatures: TimeSignatureEvent[];
}

/** Progress message posted by the pipeline worker. */
export interface PipelineProgress {
  stage:
    | 'download-separation-model'
    | 'download-beat-model'
    | 'separate'
    | 'beats-fullmix'
    | 'beats-drums'
    | 'convert';
  /** 0..1 within the stage, when known. */
  percent?: number;
  /** Estimated seconds remaining within the stage, when known. */
  etaSeconds?: number;
  /** Optional human-readable detail (e.g. download MB counts). */
  detail?: string;
}

export interface PipelineResult {
  synctrack: Synctrack;
  /** Drum-onset offset in ms (diagnostic). */
  drumOnsetOffsetMs: number | null;
  /** Full-mix PP beat count (diagnostic). */
  fullMixBeatCount: number;
  /** Drum-stem PP beat count (diagnostic). */
  drumStemBeatCount: number;
  /** Meter regularity from the beat tracker (null = too short to measure).
   * frac4 < METER_CONFIDENCE_THRESHOLD → warn that time signatures likely
   * need manual work. */
  meterStats: import('./meter-confidence').MeterStats | null;
}

// --- worker message protocol -------------------------------------------

export interface PipelineRunRequest {
  type: 'run';
  /** Planar mono-per-channel PCM at `sampleRate`. */
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** sha-256 hex of the source bytes, for the OPFS drum-stem cache. */
  sourceHash: string | null;
}

export type PipelineWorkerMessage =
  | ({type: 'progress'} & PipelineProgress)
  | {type: 'result'; result: PipelineResult}
  | {type: 'error'; message: string};
