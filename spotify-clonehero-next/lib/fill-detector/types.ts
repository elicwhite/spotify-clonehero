/**
 * Type definitions for the drum fill extractor
 */

import {parseChartFile, NoteEvent} from '@eliwhite/scan-chart';

// Use scan-chart types directly
export type ParsedChart = ReturnType<typeof parseChartFile>;
export type Track = ParsedChart['trackData'][0];
export type TempoEvent = ParsedChart['tempos'][0];
export type TimeSignature = ParsedChart['timeSignatures'][0];

// Re-export NoteEvent from scan-chart for convenience
export type {NoteEvent} from '@eliwhite/scan-chart';

export interface FillSegment {
  songId: string; // caller supplies or derived from file name
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;

  // measure information
  measureStartTick: number;
  measureEndTick: number;
  measureStartMs: number;
  measureEndMs: number;
  measureNumber: number; // 1-based measure number

  // heuristic scores
  densityZ: number;
  tomRatioJump: number;
  hatDropout: number;
  kickDrop: number;
  ioiStdZ: number;
  ngramNovelty: number;
  samePadBurst: boolean;
  crashResolve: boolean;
  grooveDist: number;
}

export interface Config {
  difficulty?: 'expert' | 'hard' | 'medium' | 'easy';
  quantDiv?: number; // smaller → finer grid
  windowBeats?: number;
  strideBeats?: number;
  lookbackBars?: number;
  thresholds?: {
    densityZ?: number;
    dist?: number;
    tomJump?: number;
    minBeats?: number;
    maxBeats?: number;
    mergeGapBeats?: number;
    burstMs?: number;
  };
}

// Type for validated config where all properties are guaranteed to exist
export interface ValidatedConfig {
  difficulty: 'expert' | 'hard' | 'medium' | 'easy';
  quantDiv: number;
  windowBeats: number;
  strideBeats: number;
  lookbackBars: number;
  thresholds: {
    densityZ: number;
    dist: number;
    tomJump: number;
    minBeats: number;
    maxBeats: number;
    mergeGapBeats: number;
    burstMs: number;
  };
}

// Voice categories for drum mapping
export enum DrumVoice {
  KICK = 'kick',
  SNARE = 'snare',
  HAT = 'hat',
  TOM = 'tom',
  CYMBAL = 'cymbal',
  UNKNOWN = 'unknown',
}

// Feature vector for sliding window analysis
export interface FeatureVector {
  noteDensity: number;
  densityZ: number;
  tomRatioJump: number;
  hatDropout: number;
  kickDrop: number;
  ioiStdZ: number;
  ngramNovelty: number;
  samePadBurst: boolean;
  crashResolve: boolean;
  grooveDist: number;
}

// Window data for analysis
export interface AnalysisWindow {
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;
  notes: NoteEvent[];
  features: FeatureVector;
  isCandidate: boolean;
}

// Custom error types
export class DrumTrackNotFoundError extends Error {
  constructor(difficulty: string) {
    super(`No drum track found for difficulty: ${difficulty}`);
    this.name = 'DrumTrackNotFoundError';
  }
}

export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(`Invalid configuration: ${message}`);
    this.name = 'InvalidConfigError';
  }
}
