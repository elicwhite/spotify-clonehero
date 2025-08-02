/**
 * Type definitions for the drum fill extractor
 */
export type NoteType = number;
export interface NoteEvent {
    tick: number;
    msTime: number;
    length: number;
    msLength: number;
    type: NoteType;
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
    noteEventGroups: (NoteEvent & {
        msTime: number;
        msLength: number;
    })[][];
}
export interface ParsedChart {
    resolution: number;
    tempos: TempoEvent[];
    trackData: TrackData[];
    name?: string;
    artist?: string;
}
export interface FillSegment {
    songId: string;
    startTick: number;
    endTick: number;
    startMs: number;
    endMs: number;
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
    quantDiv?: number;
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
export declare enum DrumVoice {
    KICK = "kick",
    SNARE = "snare",
    HAT = "hat",
    TOM = "tom",
    CYMBAL = "cymbal",
    UNKNOWN = "unknown"
}
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
export interface AnalysisWindow {
    startTick: number;
    endTick: number;
    startMs: number;
    endMs: number;
    notes: NoteEvent[];
    features: FeatureVector;
    isCandidate: boolean;
}
export declare class DrumTrackNotFoundError extends Error {
    constructor(difficulty: string);
}
export declare class InvalidConfigError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=types.d.ts.map