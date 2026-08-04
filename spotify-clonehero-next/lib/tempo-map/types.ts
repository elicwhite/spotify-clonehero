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

/**
 * What a pipeline run is FOR. The tempo map (a grid) and the section labels
 * (song structure) are independent products, and a caller regenerating one
 * must not silently regenerate the other (plan 0076 item 23), so a run names
 * which it wants and gets back exactly that shape.
 *
 * `'sections'` skips drum separation and the drum-stem beat pass entirely:
 * LinkSeg reads full-mix beats and the 22.05 kHz full-mix audio only, so a
 * sections-only run never needs a stem, and its result cannot carry a grid.
 */
export type PipelineRunKind = 'tempo-map' | 'tempo-map+sections' | 'sections';

/** What every run produces, both derived from the full-mix beat pass that
 *  every run performs. */
interface PipelineDiagnostics {
  /** Full-mix PP beat count (diagnostic). */
  fullMixBeatCount: number;
  /** Meter regularity from the beat tracker (null = too short to measure).
   * frac4 < METER_CONFIDENCE_THRESHOLD → warn that time signatures likely
   * need manual work. */
  meterStats: import('./meter-confidence').MeterStats | null;
}

/** Result of a `'tempo-map'` or `'tempo-map+sections'` run. */
export interface TempoMapPipelineResult extends PipelineDiagnostics {
  kind: 'tempo-map';
  /** The generated grid. Always present: a run that asks for a tempo map and
   *  can't build one rejects instead. */
  synctrack: Synctrack;
  /** LinkSeg functional section labels. Null on a `'tempo-map'` run (which
   *  never asks for them), and on a `'tempo-map+sections'` run whose audio
   *  had too few beats or whose model failed. */
  sections: LinkSegSections | null;
  /** Drum-onset offset in ms (diagnostic). */
  drumOnsetOffsetMs: number | null;
  /** Drum-stem PP beat count (diagnostic). */
  drumStemBeatCount: number;
  /**
   * The drum stem the pipeline ran on, planar stereo at 44.1 kHz — whether
   * freshly separated, loaded from the OPFS cache, or supplied by the caller
   * (echoed back; request buffers are transferred to the worker, so this is
   * the caller's only live copy). Lets a caller run CRNN transcription
   * (lib/drum-transcription/pipeline/tempo-track.ts) on the SAME stem
   * without a second BS-Roformer pass.
   */
  drumStemStereo: {left: Float32Array; right: Float32Array};
}

/** Result of a `'sections'` run — structurally unable to carry a grid. */
export interface SectionsPipelineResult extends PipelineDiagnostics {
  kind: 'sections';
  /** LinkSeg functional section labels (null when the song had too few beats
   *  or the model failed). */
  sections: LinkSegSections | null;
}

export type PipelineResult = TempoMapPipelineResult | SectionsPipelineResult;

/** The result shape a given run kind produces. */
export type PipelineResultFor<K extends PipelineRunKind> = K extends 'sections'
  ? SectionsPipelineResult
  : TempoMapPipelineResult;

// --- worker message protocol -------------------------------------------

export interface PipelineRunRequest {
  type: 'run';
  /** Which product this run is for (see {@link PipelineRunKind}). */
  kind: PipelineRunKind;
  /** Planar mono-per-channel PCM at `sampleRate`. */
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  /** Fingerprint of the source bytes, for the OPFS drum-stem cache. */
  fingerprint: string | null;
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
