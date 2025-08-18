/**
 * Sliding window feature extraction for drum fill detection
 */

import {
  NoteEvent,
  FeatureVector,
  AnalysisWindow,
  ValidatedConfig,
} from '../types';
import {
  countNotesByVoice,
  DrumVoice,
  isTom,
  isHat,
  isKick,
  isCymbal,
} from '../drumLaneMap';
import {ticksToBeats, isDownbeat} from '../quantize';
import {standardDeviation} from '../utils/math';

/**
 * Computes the feature vector for a single analysis window
 */
export function computeWindowFeatures(
  window: AnalysisWindow,
  config: ValidatedConfig,
  resolution: number,
  rollingStats?: {
    densityMean: number;
    densityStd: number;
    tomRatioMean: number;
    hatRatioMean: number;
    kickRatioMean: number;
    ioiStdMean: number;
    ioiStdStd: number;
  },
): FeatureVector {
  const notes = window.notes;
  const windowDurationBeats = ticksToBeats(
    window.endTick - window.startTick,
    resolution,
  );

  // Basic density calculation
  const noteDensity = notes.length / windowDurationBeats;

  // Voice-based counts
  // Thread through chart drum type when available on window (AnalysisWindow doesn't currently carry it,
  // so pass null which triggers scan-chart aware mapping using drum-specific note types)
  const voiceCounts = countNotesByVoice(notes, undefined, null);
  const totalNotes = notes.length;

  // Calculate ratios (avoid division by zero)
  const tomRatio = totalNotes > 0 ? voiceCounts[DrumVoice.TOM] / totalNotes : 0;
  const hatRatio = totalNotes > 0 ? voiceCounts[DrumVoice.HAT] / totalNotes : 0;
  const kickRatio =
    totalNotes > 0 ? voiceCounts[DrumVoice.KICK] / totalNotes : 0;

  // Calculate inter-onset intervals (IOI)
  const iois = calculateIOIs(notes);
  const ioiStd = standardDeviation(iois);

  // Calculate feature values with fallbacks for missing rolling stats
  const densityZ = rollingStats
    ? rollingStats.densityStd > 0
      ? (noteDensity - rollingStats.densityMean) / rollingStats.densityStd
      : 0
    : 0;

  const tomRatioJump = rollingStats
    ? rollingStats.tomRatioMean > 0
      ? tomRatio / rollingStats.tomRatioMean
      : 1
    : 1;

  const hatDropout = rollingStats
    ? Math.max(
        0,
        1 -
          (rollingStats.hatRatioMean > 0
            ? hatRatio / rollingStats.hatRatioMean
            : 1),
      )
    : 0;

  const kickDrop = rollingStats
    ? Math.max(0, rollingStats.kickRatioMean - kickRatio)
    : 0;

  const ioiStdZ = rollingStats
    ? rollingStats.ioiStdStd > 0
      ? (ioiStd - rollingStats.ioiStdMean) / rollingStats.ioiStdStd
      : 0
    : 0;

  // Calculate pattern-based features
  const ngramNovelty = calculateNgramNovelty(notes, resolution);
  const samePadBurst = detectSamePadBurst(
    notes,
    config.thresholds?.burstMs || 120,
  );
  const crashResolve = detectCrashResolve(window, resolution);

  return {
    noteDensity,
    densityZ,
    tomRatioJump,
    hatDropout,
    kickDrop,
    ioiStdZ,
    ngramNovelty,
    samePadBurst,
    crashResolve,
    grooveDist: 0, // Will be calculated later by groove model
  };
}

/**
 * Calculates inter-onset intervals (time between consecutive notes)
 */
function calculateIOIs(notes: NoteEvent[]): number[] {
  if (notes.length < 2) return [];

  const sortedNotes = [...notes].sort((a, b) => a.tick - b.tick);
  const iois: number[] = [];

  for (let i = 1; i < sortedNotes.length; i++) {
    const interval = sortedNotes[i].msTime - sortedNotes[i - 1].msTime;
    if (interval > 0) {
      iois.push(interval);
    }
  }

  return iois;
}

/**
 * Calculates n-gram novelty - detects unseen rhythm patterns
 * Uses 16-tick (typically 1/4 beat) patterns
 */
function calculateNgramNovelty(notes: NoteEvent[], resolution: number): number {
  if (notes.length === 0) return 0;

  // Create rhythm pattern using 16-tick grid
  const gridSize = Math.max(1, Math.floor(resolution / 4)); // Approximately 16th notes
  const sortedNotes = [...notes].sort((a, b) => a.tick - b.tick);

  if (sortedNotes.length === 0) return 0;

  const minTick = sortedNotes[0].tick;
  const maxTick = sortedNotes[sortedNotes.length - 1].tick;
  const patternLength = Math.ceil((maxTick - minTick) / gridSize);

  if (patternLength <= 1) return 0;

  // Create binary pattern array
  const pattern = new Array(patternLength).fill(0);

  for (const note of sortedNotes) {
    const gridIndex = Math.floor((note.tick - minTick) / gridSize);
    if (gridIndex >= 0 && gridIndex < patternLength) {
      pattern[gridIndex] = 1;
    }
  }

  // Simple novelty heuristic - check for dense patterns or syncopation
  const density = pattern.reduce((sum, val) => sum + val, 0) / pattern.length;

  // High novelty if very dense (> 50% filled) or has syncopated patterns
  return density > 0.5 ? 1 : 0;
}

/**
 * Detects burst patterns on the same drum pad
 */
function detectSamePadBurst(
  notes: NoteEvent[],
  burstThresholdMs: number,
): boolean {
  if (notes.length < 3) return false;

  // Group notes by type
  const notesByType = new Map<number, NoteEvent[]>();

  for (const note of notes) {
    if (!notesByType.has(note.type)) {
      notesByType.set(note.type, []);
    }
    notesByType.get(note.type)!.push(note);
  }

  // Check each note type for burst patterns
  for (const [, typeNotes] of notesByType) {
    if (typeNotes.length < 3) continue;

    const sortedNotes = typeNotes.sort((a, b) => a.msTime - b.msTime);

    // Look for 3+ consecutive notes within burst threshold
    let consecutiveCount = 1;

    for (let i = 1; i < sortedNotes.length; i++) {
      const interval = sortedNotes[i].msTime - sortedNotes[i - 1].msTime;

      if (interval <= burstThresholdMs) {
        consecutiveCount++;
        if (consecutiveCount >= 3) {
          return true;
        }
      } else {
        consecutiveCount = 1;
      }
    }
  }

  return false;
}

/**
 * Detects if the window ends with a crash that resolves to downbeat
 */
function detectCrashResolve(
  window: AnalysisWindow,
  resolution: number,
): boolean {
  const notes = window.notes;
  if (notes.length === 0) return false;

  // Look for cymbal/crash notes near the end of the window
  const windowDuration = window.endTick - window.startTick;
  const lastQuarter = window.endTick - windowDuration * 0.25;

  const lateCrashes = notes.filter(
    note => note.tick >= lastQuarter && isCymbal(note.type),
  );

  if (lateCrashes.length === 0) return false;

  // Check if the next downbeat after the window would be a likely resolution point
  const nextDownbeat =
    Math.ceil(window.endTick / (resolution * 4)) * (resolution * 4);
  const ticksToDownbeat = nextDownbeat - window.endTick;

  // Consider it a crash resolve if downbeat is within 1 beat
  return ticksToDownbeat <= resolution;
}

/**
 * Extracts features from multiple analysis windows
 */
export function extractFeaturesFromWindows(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
): AnalysisWindow[] {
  if (windows.length === 0) return [];

  // First pass: calculate basic features without rolling stats
  const featuredWindows = windows.map(window => ({
    ...window,
    features: computeWindowFeatures(window, config, resolution),
  }));

  // Second pass: calculate rolling statistics and update z-scores
  updateRollingStatistics(featuredWindows, config, resolution);

  return featuredWindows;
}

/**
 * Updates windows with rolling statistics for z-score calculations
 */
function updateRollingStatistics(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
): void {
  const lookbackWindowCount = Math.max(
    1,
    Math.floor((config.lookbackBars! * 4) / config.strideBeats!),
  );

  for (let i = 0; i < windows.length; i++) {
    const lookbackStart = Math.max(0, i - lookbackWindowCount);
    const lookbackWindows = windows.slice(lookbackStart, i);

    if (lookbackWindows.length === 0) continue;

    // Calculate rolling means and standard deviations
    const densities = lookbackWindows.map(w => w.features.noteDensity);
    const tomRatios = lookbackWindows.map(w => w.features.tomRatioJump);
    const hatDropouts = lookbackWindows.map(w => w.features.hatDropout);
    const kickDrops = lookbackWindows.map(w => w.features.kickDrop);
    const ioiStds = lookbackWindows.map(w => w.features.ioiStdZ);

    const rollingStats = {
      densityMean: densities.reduce((a, b) => a + b, 0) / densities.length,
      densityStd: standardDeviation(densities),
      tomRatioMean: tomRatios.reduce((a, b) => a + b, 0) / tomRatios.length,
      hatRatioMean:
        1 - hatDropouts.reduce((a, b) => a + b, 0) / hatDropouts.length,
      kickRatioMean: kickDrops.reduce((a, b) => a + b, 0) / kickDrops.length,
      ioiStdMean: ioiStds.reduce((a, b) => a + b, 0) / ioiStds.length,
      ioiStdStd: standardDeviation(ioiStds),
    };

    // Recompute features with rolling stats
    windows[i].features = computeWindowFeatures(
      windows[i],
      config,
      resolution, // resolution IS needed for density calculation
      rollingStats,
    );
  }
}

/**
 * Creates analysis windows from note events
 */
export function createAnalysisWindows(
  notes: NoteEvent[],
  startTick: number,
  endTick: number,
  windowBeats: number,
  strideBeats: number,
  resolution: number,
  tempos: any[], // TempoEvent[] but avoiding circular import
): AnalysisWindow[] {
  const windows: AnalysisWindow[] = [];
  const windowTicks = windowBeats * resolution;
  const strideTicks = strideBeats * resolution;

  for (
    let windowStart = startTick;
    windowStart + windowTicks <= endTick;
    windowStart += strideTicks
  ) {
    const windowEnd = windowStart + windowTicks;

    // Filter notes within this window
    const windowNotes = notes.filter(
      note => note.tick >= windowStart && note.tick < windowEnd,
    );

    // Calculate window timing (simplified - would use tempo utils in real implementation)
    const startMs = windowStart; // Simplified
    const endMs = windowEnd; // Simplified

    const window: AnalysisWindow = {
      startTick: windowStart,
      endTick: windowEnd,
      startMs,
      endMs,
      notes: windowNotes,
      features: {
        noteDensity: 0,
        densityZ: 0,
        tomRatioJump: 0,
        hatDropout: 0,
        kickDrop: 0,
        ioiStdZ: 0,
        ngramNovelty: 0,
        samePadBurst: false,
        crashResolve: false,
        grooveDist: 0,
      },
      isCandidate: false,
    };

    windows.push(window);
  }

  return windows;
}
