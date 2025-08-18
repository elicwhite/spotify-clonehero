/**
 * N-gram pattern detection and novelty analysis for drum fills
 */

import {NoteEvent} from '../types';
import {mapNoteToVoice, DrumVoice} from '../drumLaneMap';

/**
 * Represents a rhythmic pattern as a sequence of events
 */
export interface RhythmPattern {
  pattern: number[]; // Binary array representing note positions
  voices: DrumVoice[]; // Voice types at each position
  hash: string; // Unique identifier for the pattern
}

/**
 * Cache for storing seen patterns
 */
export class PatternCache {
  private patterns: Map<string, number> = new Map(); // hash -> frequency
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Adds a pattern to the cache
   */
  addPattern(pattern: RhythmPattern): void {
    const count = this.patterns.get(pattern.hash) || 0;
    this.patterns.set(pattern.hash, count + 1);

    // Prune cache if it gets too large
    if (this.patterns.size > this.maxSize) {
      this.pruneCache();
    }
  }

  /**
   * Checks if a pattern has been seen before
   */
  hasPattern(pattern: RhythmPattern): boolean {
    return this.patterns.has(pattern.hash);
  }

  /**
   * Gets the frequency of a pattern
   */
  getPatternFrequency(pattern: RhythmPattern): number {
    return this.patterns.get(pattern.hash) || 0;
  }

  /**
   * Clears the cache
   */
  clear(): void {
    this.patterns.clear();
  }

  /**
   * Gets the number of unique patterns in cache
   */
  getPatternCount(): number {
    return this.patterns.size;
  }

  /**
   * Removes least frequent patterns to manage cache size
   */
  private pruneCache(): void {
    const entries = Array.from(this.patterns.entries());
    entries.sort((a, b) => a[1] - b[1]); // Sort by frequency

    // Remove bottom 25% of patterns
    const removeCount = Math.floor(entries.length * 0.25);
    for (let i = 0; i < removeCount; i++) {
      this.patterns.delete(entries[i][0]);
    }
  }
}

/**
 * Creates a rhythm pattern from notes within a time window
 */
export function createRhythmPattern(
  notes: NoteEvent[],
  startTick: number,
  endTick: number,
  resolution: number,
  gridDivision = 16, // 16th note resolution
): RhythmPattern {
  const gridSize = Math.max(1, Math.floor(resolution / (gridDivision / 4)));
  const patternLength = Math.ceil((endTick - startTick) / gridSize);

  const pattern = new Array(patternLength).fill(0);
  const voices: DrumVoice[] = new Array(patternLength).fill(DrumVoice.UNKNOWN);

  // Map notes to grid positions
  for (const note of notes) {
    if (note.tick >= startTick && note.tick < endTick) {
      const gridIndex = Math.floor((note.tick - startTick) / gridSize);
      if (gridIndex >= 0 && gridIndex < patternLength) {
        pattern[gridIndex] = 1;

        // Record the primary voice if not already set
        if (voices[gridIndex] === DrumVoice.UNKNOWN) {
          voices[gridIndex] = mapNoteToVoice(note.type);
        }
      }
    }
  }

  // Create hash for pattern identification
  const hash = createPatternHash(pattern, voices);

  return {
    pattern,
    voices,
    hash,
  };
}

/**
 * Creates a unique hash for a rhythm pattern
 */
function createPatternHash(pattern: number[], voices: DrumVoice[]): string {
  // Combine pattern and voice information into a hash
  const patternStr = pattern.join('');
  const voiceStr = voices.map(v => v.charAt(0)).join(''); // First letter of each voice
  return `${patternStr}_${voiceStr}`;
}

/**
 * Extracts overlapping n-gram patterns from a note sequence
 */
export function extractNGramPatterns(
  notes: NoteEvent[],
  startTick: number,
  endTick: number,
  resolution: number,
  ngramSize: number = 4, // Number of beats per n-gram
  stride: number = 1, // Stride in beats
): RhythmPattern[] {
  const patterns: RhythmPattern[] = [];
  const ngramTicks = ngramSize * resolution;
  const strideTicks = stride * resolution;

  for (
    let windowStart = startTick;
    windowStart + ngramTicks <= endTick;
    windowStart += strideTicks
  ) {
    const windowEnd = windowStart + ngramTicks;
    const windowNotes = notes.filter(
      note => note.tick >= windowStart && note.tick < windowEnd,
    );

    if (windowNotes.length > 0) {
      const pattern = createRhythmPattern(
        windowNotes,
        windowStart,
        windowEnd,
        resolution,
      );
      patterns.push(pattern);
    }
  }

  return patterns;
}

/**
 * Calculates novelty score for a set of patterns using a cache
 */
export function calculateNoveltyScore(
  patterns: RhythmPattern[],
  cache: PatternCache,
): number {
  if (patterns.length === 0) return 0;

  let novelCount = 0;

  for (const pattern of patterns) {
    if (!cache.hasPattern(pattern)) {
      novelCount++;
    }

    // Add pattern to cache for future reference
    cache.addPattern(pattern);
  }

  return novelCount / patterns.length;
}

/**
 * Analyzes pattern complexity based on various metrics
 */
export function analyzePatternComplexity(pattern: RhythmPattern): {
  density: number;
  voiceDiversity: number;
  syncopation: number;
  irregularity: number;
} {
  const {pattern: notes, voices} = pattern;

  // Density: ratio of filled positions
  const density = notes.reduce((sum, val) => sum + val, 0) / notes.length;

  // Voice diversity: number of different voices used
  const uniqueVoices = new Set(voices.filter(v => v !== DrumVoice.UNKNOWN));
  const voiceDiversity = uniqueVoices.size / Object.keys(DrumVoice).length;

  // Syncopation: notes on weak beats (simplified metric)
  let syncopation = 0;
  const beatPositions = [0, 2]; // Strong beats in 4/4 time (scaled to pattern)
  const scaledBeats = beatPositions.map(beat =>
    Math.floor((beat * notes.length) / 4),
  );

  for (let i = 0; i < notes.length; i++) {
    if (notes[i] === 1 && !scaledBeats.includes(i % 4)) {
      syncopation++;
    }
  }
  syncopation = syncopation / notes.reduce((sum, val) => sum + val, 0) || 0;

  // Irregularity: variation in inter-onset intervals
  const onsetPositions = notes
    .map((val, idx) => (val === 1 ? idx : -1))
    .filter(pos => pos >= 0);

  let irregularity = 0;
  if (onsetPositions.length > 1) {
    const intervals = [];
    for (let i = 1; i < onsetPositions.length; i++) {
      intervals.push(onsetPositions[i] - onsetPositions[i - 1]);
    }

    const meanInterval =
      intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const variance =
      intervals.reduce((sum, val) => sum + Math.pow(val - meanInterval, 2), 0) /
      intervals.length;
    irregularity = Math.sqrt(variance) / meanInterval || 0;
  }

  return {
    density,
    voiceDiversity,
    syncopation: Math.min(1, syncopation), // Cap at 1
    irregularity: Math.min(1, irregularity), // Cap at 1
  };
}

/**
 * Detects fill-like patterns based on multiple heuristics
 */
export function detectFillPatterns(
  notes: NoteEvent[],
  startTick: number,
  endTick: number,
  resolution: number,
  cache: PatternCache,
): {
  noveltyScore: number;
  complexityScore: number;
  isFillCandidate: boolean;
} {
  // Extract patterns for analysis
  const patterns = extractNGramPatterns(notes, startTick, endTick, resolution);

  if (patterns.length === 0) {
    return {
      noveltyScore: 0,
      complexityScore: 0,
      isFillCandidate: false,
    };
  }

  // Calculate novelty score
  const noveltyScore = calculateNoveltyScore(patterns, cache);

  // Analyze complexity across all patterns
  const complexityMetrics = patterns.map(analyzePatternComplexity);
  const avgComplexity = {
    density:
      complexityMetrics.reduce((sum, c) => sum + c.density, 0) /
      complexityMetrics.length,
    voiceDiversity:
      complexityMetrics.reduce((sum, c) => sum + c.voiceDiversity, 0) /
      complexityMetrics.length,
    syncopation:
      complexityMetrics.reduce((sum, c) => sum + c.syncopation, 0) /
      complexityMetrics.length,
    irregularity:
      complexityMetrics.reduce((sum, c) => sum + c.irregularity, 0) /
      complexityMetrics.length,
  };

  // Combine complexity metrics into single score
  const complexityScore =
    avgComplexity.density * 0.3 +
    avgComplexity.voiceDiversity * 0.3 +
    avgComplexity.syncopation * 0.2 +
    avgComplexity.irregularity * 0.2;

  // Determine if this is a fill candidate
  const isFillCandidate =
    noveltyScore > 0.3 || // At least 30% novel patterns
    complexityScore > 0.6 || // High complexity
    avgComplexity.density > 0.7; // Very dense

  return {
    noveltyScore,
    complexityScore,
    isFillCandidate,
  };
}

/**
 * Global pattern cache for maintaining state across multiple songs
 */
let globalPatternCache: PatternCache | null = null;

/**
 * Gets or creates the global pattern cache
 */
export function getGlobalPatternCache(): PatternCache {
  if (!globalPatternCache) {
    globalPatternCache = new PatternCache();
  }
  return globalPatternCache;
}

/**
 * Resets the global pattern cache
 */
export function resetGlobalPatternCache(): void {
  globalPatternCache = new PatternCache();
}

/**
 * Saves pattern cache state (for potential persistence)
 */
export function serializePatternCache(cache: PatternCache): string {
  return JSON.stringify({
    patterns: Array.from((cache as any).patterns.entries()),
    maxSize: (cache as any).maxSize,
  });
}

/**
 * Loads pattern cache state (for potential persistence)
 */
export function deserializePatternCache(serialized: string): PatternCache {
  const data = JSON.parse(serialized);
  const cache = new PatternCache(data.maxSize);

  for (const [hash, frequency] of data.patterns) {
    (cache as any).patterns.set(hash, frequency);
  }

  return cache;
}
