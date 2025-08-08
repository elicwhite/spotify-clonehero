/**
 * Type definitions for the drum fill extractor
 */

export type NoteType = number;

export interface NoteEvent {
  tick: number;
  msTime: number;
  length: number;
  msLength: number;
  type: NoteType;   // e.g. 0-5 for drum lanes, authoring dependent
  flags: number;
}

export interface TempoEvent {
  tick: number;
  bpm: number;
  msTime: number;
}

export interface TrackData {
  instrument: "drums" | "guitar" | "bass" | "keys" | "vocals";
  difficulty: "expert" | "hard" | "medium" | "easy";
  noteEventGroups: (NoteEvent & { msTime: number; msLength: number })[][];
}

export interface ParsedChart {
  resolution: number;                // ticks per quarter note
  tempos: TempoEvent[];
  trackData: TrackData[];
  name?: string;                     // optional song name
  artist?: string;                   // optional artist name
  // other fields may exist but are not needed for fill detection
}

export interface FillSegment {
  songId: string;        // caller supplies or derived from file name
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;

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
  difficulty?: "expert" | "hard" | "medium" | "easy";
  quantDiv?: number;              // smaller → finer grid
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

// Voice categories for drum mapping
export enum DrumVoice {
  KICK = "kick",
  SNARE = "snare",
  HAT = "hat",
  TOM = "tom",
  CYMBAL = "cymbal",
  UNKNOWN = "unknown"
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