/**
 * Types for the drum-fill detection + classification engine.
 *
 * These describe the heuristic pipeline that turns an Expert drums track into
 * a list of detected fills (short departures from the local groove) plus a
 * learnable taxonomy classification for each one.
 */

/**
 * Voice classes used for rhythmic fingerprints. Every drum onset is reduced to
 * one of these classes (a single onset may carry several, e.g. kick + crash).
 */
export type DrumVoice = 'kick' | 'snare' | 'hat' | 'tom' | 'crash';

/** Number of grid divisions per bar used for onset quantization. */
export const GRID_DIVISIONS_PER_BAR = 48;

/**
 * A single quantized onset within a bar.
 *
 * `slot` is the grid index in `[0, GRID_DIVISIONS_PER_BAR * barsSpanned)` —
 * for a normal 1-bar fingerprint it is `[0, 48)`.
 */
export interface GridOnset {
  slot: number;
  voices: Set<DrumVoice>;
  /** Absolute chart tick of the onset (nearest note in the group). */
  tick: number;
}

/**
 * A rhythmic fingerprint over a single bar (or half-bar window).
 *
 * `key` is a stable string used for equality / dedupe; `onsets` is kept for
 * feature extraction.
 */
export interface BarFingerprint {
  /** Bar index within the song (0-based, in musical bars). */
  barIndex: number;
  /** Absolute tick at the start of the bar. */
  startTick: number;
  /** Absolute tick at the end of the bar (exclusive). */
  endTick: number;
  /** Time-signature-derived grid resolution for this bar. */
  divisions: number;
  onsets: GridOnset[];
  /** Stable fingerprint key (slot:voiceMask, comma-joined). */
  key: string;
}

/** Raw numeric features captured for a detected fill, used for classification + tuning. */
export interface FillFeatures {
  /** Number of distinct onset positions in the fill span. */
  onsetCount: number;
  /** Notes (voice-onsets) per second across the fill span. */
  notesPerSecond: number;
  /** Local groove baseline notes-per-second (for the preceding groove). */
  grooveNotesPerSecond: number;
  /** notesPerSecond / grooveNotesPerSecond (>= 1 means denser). */
  densityRatio: number;
  /** Fraction of onsets that include a tom voice. */
  tomFraction: number;
  /** Fraction of onsets that include snare. */
  snareFraction: number;
  /** Fraction of onsets that include kick. */
  kickFraction: number;
  /** Fingerprint dissimilarity vs the local groove (0..1; 1 = totally different). */
  grooveDissimilarity: number;
  /** True if the fill terminates at a crash on or near a downbeat. */
  endsOnCrash: boolean;
  /** True if a section boundary falls at/after the fill end. */
  endsAtSection: boolean;
  /** Number of distinct voices used during the fill. */
  voiceCount: number;
}

/** A fill detected in a track. Tick ranges are absolute chart ticks. */
export interface DetectedFill {
  startTick: number;
  endTick: number;
  /** Start of the preceding groove span (1-2 bars before the fill). */
  grooveStartTick: number;
  /** End of the preceding groove span (== startTick). */
  grooveEndTick: number;
  /** Tempo (BPM) in effect at the fill's start tick. */
  tempoBpm: number;
  /** Heuristic confidence in [0, 1]. */
  confidence: number;
  features: FillFeatures;
}

export type FillSubdivision = '8th' | '16th' | 'triplet' | 'mixed';

export type VoicingTag =
  | 'toms'
  | 'snare-only'
  | 'kick-woven'
  | 'crash-end'
  | 'cymbal-work'
  | 'flams'
  | 'ghosts';

/** Learnable taxonomy classification for a detected fill. */
export interface Classification {
  /** Length in musical bars (0.5, 1, or 2). */
  lengthBars: number;
  subdivision: FillSubdivision;
  voicingTags: VoicingTag[];
  /** Complexity 1 (easy) .. 5 (hard). */
  complexity: number;
  /**
   * Continuous difficulty in [0, 100], computed from onset count, peak hit rate
   * at the fill's actual tempo, subdivision level/mixing, voice variety/switch
   * rate, syncopation, ornaments, and length. Used to order a groove cluster's
   * fills into a simple→complex ladder (`complexity` stays for coarse
   * filtering). See `computeDifficultyScore`.
   */
  difficultyScore: number;
  /**
   * Stable fingerprint string for dedupe within a song — derived from the
   * fill's quantized onset/voice pattern (tempo/position independent).
   */
  fingerprint: string;
  /**
   * Cross-song fill similarity key: canonical fill fingerprint with dynamics
   * stripped (cymbal choice collapsed, 16th-grid quantized). Equivalent fills
   * across different songs share this key, enabling library-wide dedupe.
   */
  similarityKey: string;
}

/** A detected fill plus its classification. */
export interface ClassifiedFill {
  fill: DetectedFill;
  classification: Classification;
  /** How many near-identical repetitions of this fill exist in the song. */
  repetitions: number;
}

/** Tunable thresholds for the detection heuristic. */
export interface DetectionOptions {
  /** Bar-fingerprint similarity (0..1) needed to count two bars as "the same groove". */
  grooveSimilarity: number;
  /** Min number of similar bars (out of the recent window) to treat as an established groove. */
  minGrooveBars: number;
  /** Size of the sliding window of recent bars used for groove inference. */
  grooveWindow: number;
  /** Min fingerprint dissimilarity vs groove for a bar to be fill-eligible. */
  minDissimilarity: number;
  /** Density ratio (vs groove) that qualifies as a density spike. */
  densitySpike: number;
  /** Tom fraction that qualifies as tom-heavy. */
  tomHeavy: number;
  /** Min confidence to emit a fill. */
  minConfidence: number;
  /**
   * Apply the substance gate (reject degenerate one-shot "fills": lone crash,
   * crash+kick push, single flam). Default true; the spot-check harness toggles
   * it off to measure how many candidates the gate removes.
   */
  substanceGate: boolean;
  /**
   * Skip charts longer than this (ms) entirely. Excludes full-album charts,
   * which are single very long charts whose fills aren't useful practice
   * material. Default 15 minutes.
   */
  maxSongMs: number;
}

export const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  grooveSimilarity: 0.7,
  minGrooveBars: 2,
  grooveWindow: 6,
  minDissimilarity: 0.45,
  densitySpike: 1.4,
  tomHeavy: 0.35,
  minConfidence: 0.5,
  substanceGate: true,
  maxSongMs: 15 * 60 * 1000,
};
