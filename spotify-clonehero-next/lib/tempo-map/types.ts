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
    | 'sections'
    | 'convert';
  /** 0..1 within the stage, when known. */
  percent?: number;
  /** Estimated seconds remaining within the stage, when known. */
  etaSeconds?: number;
  /** Optional human-readable detail (e.g. download MB counts). */
  detail?: string;
}

/** LinkSeg section labeling: functional-section boundaries + labels.
 * `times` has length S+1 (segment edges in seconds, incl. 0 and duration);
 * `labels` has length S (one product-facing name per segment). */
export interface LinkSegSections {
  times: number[];
  labels: string[];
}

export interface PipelineResult {
  synctrack: Synctrack;
  /** LinkSeg functional section labels (null if too few beats or model failed). */
  sections: LinkSegSections | null;
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
  /**
   * The drum stem the pipeline ran on, planar stereo at 44.1 kHz —
   * present whenever a stem exists, whether freshly separated, loaded
   * from the OPFS cache, or supplied by the caller (echoed back; request
   * buffers are transferred to the worker, so this is the caller's only
   * live copy). Lets a caller run CRNN transcription
   * (lib/drum-transcription/pipeline/tempo-track.ts) on the SAME stem
   * without a second BS-Roformer pass. `null` only when separation
   * failed.
   */
  drumStemStereo: {left: Float32Array; right: Float32Array} | null;
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
  /**
   * Optional pre-separated drum stem, planar stereo at 44.1 kHz. When
   * provided and its length matches the 44.1k input, the worker skips
   * BS-Roformer separation entirely (deriving its own mono mixdown for
   * Beat This!). Used by the drum-transcription pipeline, which has
   * already separated the stem.
   */
  drumStemStereo?: {left: Float32Array; right: Float32Array} | null;
}

export type PipelineWorkerMessage =
  | ({type: 'progress'} & PipelineProgress)
  | {type: 'result'; result: PipelineResult}
  | {type: 'error'; message: string};
