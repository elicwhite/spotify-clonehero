/**
 * N-gram pattern detection and novelty analysis for drum fills
 */
import { NoteEvent } from '../types.js';
import { DrumVoice } from '../drumLaneMap.js';
/**
 * Represents a rhythmic pattern as a sequence of events
 */
export interface RhythmPattern {
    pattern: number[];
    voices: DrumVoice[];
    hash: string;
}
/**
 * Cache for storing seen patterns
 */
export declare class PatternCache {
    private patterns;
    private maxSize;
    constructor(maxSize?: number);
    /**
     * Adds a pattern to the cache
     */
    addPattern(pattern: RhythmPattern): void;
    /**
     * Checks if a pattern has been seen before
     */
    hasPattern(pattern: RhythmPattern): boolean;
    /**
     * Gets the frequency of a pattern
     */
    getPatternFrequency(pattern: RhythmPattern): number;
    /**
     * Clears the cache
     */
    clear(): void;
    /**
     * Gets the number of unique patterns in cache
     */
    getPatternCount(): number;
    /**
     * Removes least frequent patterns to manage cache size
     */
    private pruneCache;
}
/**
 * Creates a rhythm pattern from notes within a time window
 */
export declare function createRhythmPattern(notes: NoteEvent[], startTick: number, endTick: number, resolution: number, gridDivision?: number): RhythmPattern;
/**
 * Extracts overlapping n-gram patterns from a note sequence
 */
export declare function extractNGramPatterns(notes: NoteEvent[], startTick: number, endTick: number, resolution: number, ngramSize?: number, // Number of beats per n-gram
stride?: number): RhythmPattern[];
/**
 * Calculates novelty score for a set of patterns using a cache
 */
export declare function calculateNoveltyScore(patterns: RhythmPattern[], cache: PatternCache): number;
/**
 * Analyzes pattern complexity based on various metrics
 */
export declare function analyzePatternComplexity(pattern: RhythmPattern): {
    density: number;
    voiceDiversity: number;
    syncopation: number;
    irregularity: number;
};
/**
 * Detects fill-like patterns based on multiple heuristics
 */
export declare function detectFillPatterns(notes: NoteEvent[], startTick: number, endTick: number, resolution: number, cache: PatternCache): {
    noveltyScore: number;
    complexityScore: number;
    isFillCandidate: boolean;
};
/**
 * Gets or creates the global pattern cache
 */
export declare function getGlobalPatternCache(): PatternCache;
/**
 * Resets the global pattern cache
 */
export declare function resetGlobalPatternCache(): void;
/**
 * Saves pattern cache state (for potential persistence)
 */
export declare function serializePatternCache(cache: PatternCache): string;
/**
 * Loads pattern cache state (for potential persistence)
 */
export declare function deserializePatternCache(serialized: string): PatternCache;
//# sourceMappingURL=novelty.d.ts.map