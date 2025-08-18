/**
 * Main API for the drum fill extractor
 *
 * Usage:
 * ```ts
 * import { extractFills, defaultConfig } from 'drum-fill-extractor';
 * const fills = extractFills(parsedChart, { ...defaultConfig, thresholds: { densityZ: 1.3 } });
 * ```
 */

import {
  ParsedChart,
  Track,
  FillSegment,
  Config,
  ValidatedConfig,
  DrumTrackNotFoundError,
  NoteEvent,
  TempoEvent,
  TimeSignature,
} from './types';
import {validateConfig, defaultConfig} from './config';
import {mapScanChartNoteToVoice, DrumVoice} from './drumLaneMap';
import {validateTempos, buildTempoMap, tickRangeToMs} from './utils/tempoUtils';
import {getWindowBoundaries} from './quantize';
import {
  createAnalysisWindows,
  extractFeaturesFromWindows,
} from './features/windowStats';
import {updateGrooveDistances} from './features/grooveModel';
import {
  detectCandidateWindows,
  postProcessCandidates,
} from './detector/candidateMask';
import {
  mergeWindowsIntoSegments,
  refineBoundaries,
  removeOverlaps,
  sortSegments,
} from './detector/mergeSegments';

/**
 * Represents a measure with timing information
 */
interface MeasureInfo {
  measureNumber: number; // 1-based
  startTick: number;
  endTick: number;
  startMs: number;
  endMs: number;
  timeSignature: TimeSignature;
}

/**
 * Calculates all measures in the chart based on time signatures
 */
function calculateMeasures(
  chart: ParsedChart,
  tempoMap: TempoEvent[],
): MeasureInfo[] {
  const measures: MeasureInfo[] = [];
  const ppq = chart.resolution;

  // Get the last tick from the chart (approximate end of track)
  const endOfTrackTicks = Math.max(
    ...chart.trackData.flatMap(track =>
      track.noteEventGroups.flatMap(group =>
        group.map(note => note.tick + note.length),
      ),
    ),
  );

  let measureNumber = 1;

  chart.timeSignatures.forEach((timeSig, index) => {
    const pulsesPerDivision = ppq / (timeSig.denominator / 4);
    const barTicks = timeSig.numerator * pulsesPerDivision;
    const segmentEndTick =
      chart.timeSignatures[index + 1]?.tick ?? endOfTrackTicks;
    let startTick = timeSig.tick;

    while (startTick < segmentEndTick) {
      const endTick = startTick + barTicks;

      const startMs = tickToMs(startTick, tempoMap, ppq);
      const endMs = tickToMs(endTick, tempoMap, ppq);

      measures.push({
        measureNumber,
        startTick,
        endTick,
        startMs,
        endMs,
        timeSignature: timeSig,
      });

      startTick = endTick;
      measureNumber++;
    }
  });

  return measures;
}

/**
 * Converts ticks to milliseconds using the tempo map
 */
function tickToMs(
  tick: number,
  tempoMap: TempoEvent[],
  resolution: number,
): number {
  if (tempoMap.length === 0) {
    return 0;
  }

  // Find the tempo event at or before this tick
  let currentTempo = tempoMap[0];
  for (const tempo of tempoMap) {
    if (tempo.tick <= tick) {
      currentTempo = tempo;
    } else {
      break;
    }
  }

  if (tick <= currentTempo.tick) {
    // Tick is before or at the current tempo event
    if (currentTempo.tick === 0) {
      return 0;
    }
    // Calculate backwards from first tempo event
    const tickDelta = currentTempo.tick - tick;
    const msDelta =
      (tickDelta / resolution) * (60000 / currentTempo.beatsPerMinute);
    return Math.max(0, currentTempo.msTime - msDelta);
  }

  // Calculate time from current tempo event to target tick
  const tickDelta = tick - currentTempo.tick;
  const msDelta =
    (tickDelta / resolution) * (60000 / currentTempo.beatsPerMinute);

  return currentTempo.msTime + msDelta;
}

/**
 * Finds the measure that contains the given tick
 */
function findMeasureForTick(
  tick: number,
  measures: MeasureInfo[],
): MeasureInfo | null {
  for (const measure of measures) {
    if (tick >= measure.startTick && tick < measure.endTick) {
      return measure;
    }
  }
  // If not found, return the last measure (edge case for fills at the very end)
  return measures.length > 0 ? measures[measures.length - 1] : null;
}

/**
 * Main API function: extracts drum fills from a chart and track (like convertToVexFlow)
 *
 * @param chart - The parsed chart data from scan-chart
 * @param track - The specific track data from scan-chart
 * @param userConfig - Optional configuration overrides
 * @returns Array of detected fill segments
 */
// Overloads to support both (chart, track) and legacy (chart)
export function extractFills(
  chart: ParsedChart,
  track: Track,
  userConfig?: Partial<Config>,
): FillSegment[];
export function extractFills(
  chart: ParsedChart,
  userConfig?: Partial<Config>,
): FillSegment[];

export function extractFills(
  chart: ParsedChart,
  trackOrConfig?: Track | Partial<Config>,
  maybeConfig?: Partial<Config>,
): FillSegment[] {
  // Determine call signature
  const isLegacyCall =
    !trackOrConfig || !('instrument' in (trackOrConfig as any));
  const config = validateConfig(
    isLegacyCall ? (trackOrConfig as Partial<Config> | undefined) : maybeConfig,
  );

  // Normalize tempos to ensure beatsPerMinute is present
  const normalizedTempos: TempoEvent[] = (chart.tempos as any).map(
    (t: any) => ({
      tick: t.tick,
      msTime: t.msTime,
      beatsPerMinute: t.beatsPerMinute ?? t.bpm,
    }),
  );
  validateTempos(normalizedTempos);
  const tempoMap = buildTempoMap(normalizedTempos, chart.resolution);

  // Resolve track
  let track: Track | null;
  if (isLegacyCall) {
    track =
      (chart.trackData as any as Track[]).find(
        t => t.instrument === 'drums' && t.difficulty === config.difficulty,
      ) || null;
    if (!track) {
      throw new DrumTrackNotFoundError(config.difficulty);
    }
  } else {
    track = trackOrConfig as Track;
  }
  // We already validated/merged config above

  // Check if track is drums
  if (track.instrument !== 'drums') {
    throw new DrumTrackNotFoundError(config.difficulty);
  }

  // Check if track difficulty matches config
  if (track.difficulty !== config.difficulty) {
    throw new DrumTrackNotFoundError(config.difficulty);
  }

  // Extract and flatten note events
  const noteEvents = flattenNoteEvents(track);
  if (noteEvents.length === 0) {
    return []; // No notes, no fills
  }

  // tempoMap already built above

  // Determine analysis boundaries
  const {startTick, endTick} = getAnalysisBounds(noteEvents);

  // Create sliding analysis windows
  const windowBoundaries = getWindowBoundaries(
    startTick,
    endTick,
    config.windowBeats,
    config.strideBeats,
    chart.resolution,
  );

  // Create analysis windows with notes
  const windows = createAnalysisWindows(
    noteEvents,
    startTick,
    endTick,
    config.windowBeats,
    config.strideBeats,
    chart.resolution,
    tempoMap,
  );

  if (windows.length === 0) {
    return []; // No windows to analyze
  }

  // Extract features from all windows
  const featuredWindows = extractFeaturesFromWindows(
    windows,
    config,
    chart.resolution,
  );

  // Update groove distances using rolling model
  updateGrooveDistances(featuredWindows, config);

  // Detect candidate windows
  const candidateWindows = detectCandidateWindows(featuredWindows, config);

  // Post-process candidates (remove isolated, apply constraints)
  const processedWindows = postProcessCandidates(
    candidateWindows,
    config,
    chart.resolution,
  );

  // Merge candidate windows into segments
  const rawSegments = mergeWindowsIntoSegments(
    processedWindows,
    config,
    chart.resolution,
    tempoMap,
    chart.metadata?.name || 'Unknown',
  );

  // Refine segment boundaries
  const refinedSegments = refineBoundaries(
    rawSegments,
    chart.resolution,
    tempoMap,
  );

  // Remove overlapping segments
  const nonOverlappingSegments = removeOverlaps(refinedSegments);

  // Sort segments chronologically
  const sortedSegments = sortSegments(nonOverlappingSegments);

  // Collapse segments that are within a half-note (2 beats) gap into a single longer fill
  const finalSegments = collapseSegmentsByProximity(
    sortedSegments,
    chart.resolution,
    tempoMap,
    2,
  );

  // Calculate measures and enrich segments with measure information
  const measures = calculateMeasures(chart, tempoMap);
  const enrichedSegments = finalSegments.map(segment => {
    // If segment already contains measure fields (computed from anchor tick), preserve them
    if (
      (segment as any).measureStartTick !== undefined &&
      (segment as any).measureEndTick !== undefined &&
      (segment as any).measureNumber !== undefined
    ) {
      return segment;
    }

    const measure = findMeasureForTick(segment.startTick, measures);
    if (measure) {
      return {
        ...segment,
        measureStartTick: measure.startTick,
        measureEndTick: measure.endTick,
        measureStartMs: measure.startMs,
        measureEndMs: measure.endMs,
        measureNumber: measure.measureNumber,
      };
    }

    // Fallback if no measure found (shouldn't happen, but safety first)
    return {
      ...segment,
      measureStartTick: segment.startTick,
      measureEndTick: segment.endTick,
      measureStartMs: segment.startMs,
      measureEndMs: segment.endMs,
      measureNumber: 1,
    };
  });
  // Collapse multiple segments detected within the same measure into a single representative
  const collapsedByMeasure = collapseSegmentsByMeasure(enrichedSegments);

  return collapsedByMeasure;
}

/**
 * Flattens note event groups into a single chronological array
 */
function flattenNoteEvents(drumTrack: Track): NoteEvent[] {
  const allNotes: NoteEvent[] = [];

  for (const noteGroup of drumTrack.noteEventGroups) {
    allNotes.push(...noteGroup);
  }

  // Sort by tick position
  return allNotes.sort((a, b) => a.tick - b.tick);
}

/**
 * Determines the analysis boundaries based on note events
 */
function getAnalysisBounds(noteEvents: NoteEvent[]): {
  startTick: number;
  endTick: number;
} {
  if (noteEvents.length === 0) {
    return {startTick: 0, endTick: 0};
  }

  const firstNote = noteEvents[0];
  const lastNote = noteEvents[noteEvents.length - 1];

  if (!firstNote || !lastNote) {
    return {startTick: 0, endTick: 0};
  }

  return {startTick: firstNote.tick, endTick: lastNote.tick};
}

/**
 * Creates a summary of the extraction process
 */
export function createExtractionSummary(
  chart: ParsedChart,
  track: Track,
  fills: FillSegment[],
  config: ValidatedConfig,
): {
  songInfo: {
    name: string;
    artist?: string;
    duration: number; // in seconds
    noteCount: number;
  };
  detectionInfo: {
    fillCount: number;
    totalFillDuration: number; // in seconds
    averageFillDuration: number; // in seconds
    fillDensityRatio: number; // fills per minute
  };
  configUsed: ValidatedConfig;
} {
  const noteEvents = flattenNoteEvents(track);

  // Calculate song duration (simplified - uses last note time)
  const duration =
    noteEvents.length > 0
      ? Math.max(...noteEvents.map(n => n.msTime)) / 1000
      : 0;

  const totalFillDuration =
    fills.reduce((sum, fill) => sum + (fill.endMs - fill.startMs), 0) / 1000;

  const averageFillDuration =
    fills.length > 0 ? totalFillDuration / fills.length : 0;
  const fillDensityRatio = duration > 0 ? (fills.length / duration) * 60 : 0;

  return {
    songInfo: {
      name: chart.metadata?.name || 'Unknown',
      artist: chart.metadata?.artist,
      duration,
      noteCount: noteEvents.length,
    },
    detectionInfo: {
      fillCount: fills.length,
      totalFillDuration,
      averageFillDuration,
      fillDensityRatio,
    },
    configUsed: config,
  };
}

/**
 * Validates a fill segment array for common issues
 */
export function validateFillSegments(fills: FillSegment[]): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < fills.length; i++) {
    const fill = fills[i];

    if (!fill) {
      errors.push(`Fill ${i}: is null or undefined`);
      continue;
    }

    // Check time consistency
    if (fill.startTick >= fill.endTick) {
      errors.push(`Fill ${i}: startTick >= endTick`);
    }

    if (fill.startMs >= fill.endMs) {
      errors.push(`Fill ${i}: startMs >= endMs`);
    }

    // Check duration reasonableness
    const durationMs = fill.endMs - fill.startMs;
    if (durationMs > 10000) {
      // > 10 seconds
      warnings.push(`Fill ${i}: very long duration (${durationMs / 1000}s)`);
    }

    if (durationMs < 100) {
      // < 100ms
      warnings.push(`Fill ${i}: very short duration (${durationMs}ms)`);
    }

    // Check feature values
    if (!isFinite(fill.densityZ) || !isFinite(fill.grooveDist)) {
      errors.push(`Fill ${i}: invalid feature values`);
    }
  }

  // Check for overlaps
  for (let i = 1; i < fills.length; i++) {
    const currentFill = fills[i];
    const prevFill = fills[i - 1];

    if (currentFill && prevFill && currentFill.startTick < prevFill.endTick) {
      errors.push(`Fill ${i}: overlaps with previous fill`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Ensures there is at most one fill per measure by selecting the best segment
 * when multiple segments fall within the same (songId, measureNumber).
 * Selection heuristic prefers longer duration, then higher densityZ, then higher grooveDist.
 */
function collapseSegmentsByMeasure(segments: FillSegment[]): FillSegment[] {
  if (segments.length === 0) return segments;
  const groups = new Map<string, FillSegment[]>();
  for (const seg of segments) {
    const key = `${seg.songId}__${seg.measureNumber}`;
    const list = groups.get(key) || [];
    list.push(seg);
    groups.set(key, list);
  }

  const pickBest = (list: FillSegment[]): FillSegment => {
    if (list.length === 1) return list[0];
    // Prefer longest duration; tiebreak on densityZ, then grooveDist
    return list.sort((a, b) => {
      const durA = a.endTick - a.startTick;
      const durB = b.endTick - b.startTick;
      if (durA !== durB) return durB - durA;
      if (a.densityZ !== b.densityZ) return b.densityZ - a.densityZ;
      return b.grooveDist - a.grooveDist;
    })[0];
  };

  const result: FillSegment[] = [];
  for (const [, list] of groups) {
    result.push(pickBest(list));
  }
  // Keep chronological order
  return sortSegments(result);
}

/**
 * Collapse adjacent fills separated by a short gap into a single longer fill.
 * Gap threshold is specified in beats (default 2 beats = half note in 4/4).
 */
function collapseSegmentsByProximity(
  segments: FillSegment[],
  resolution: number,
  tempos: TempoEvent[],
  gapBeats = 2,
): FillSegment[] {
  if (segments.length <= 1) return segments;
  const gapTicks = gapBeats * resolution;
  const merged: FillSegment[] = [];
  let current: FillSegment | null = null;

  for (const seg of segments) {
    if (!current) {
      current = seg;
      continue;
    }
    const gap = seg.startTick - current.endTick;
    if (gap <= gapTicks) {
      // Merge seg into current
      const newStartTick = Math.min(current.startTick, seg.startTick);
      const newEndTick = Math.max(current.endTick, seg.endTick);
      const times = tickRangeToMs(newStartTick, newEndTick, tempos, resolution);
      current = {
        ...current,
        startTick: newStartTick,
        endTick: newEndTick,
        startMs: times.startMs,
        endMs: times.endMs,
        // Keep stronger evidence across features
        densityZ: Math.max(current.densityZ, seg.densityZ),
        tomRatioJump: Math.max(current.tomRatioJump, seg.tomRatioJump),
        hatDropout: Math.max(current.hatDropout, seg.hatDropout),
        kickDrop: Math.max(current.kickDrop, seg.kickDrop),
        ioiStdZ: Math.max(current.ioiStdZ, seg.ioiStdZ),
        ngramNovelty: Math.max(current.ngramNovelty, seg.ngramNovelty),
        samePadBurst: current.samePadBurst || seg.samePadBurst,
        crashResolve: current.crashResolve || seg.crashResolve,
        grooveDist: Math.max(current.grooveDist, seg.grooveDist),
      };
    } else {
      merged.push(current);
      current = seg;
    }
  }
  if (current) merged.push(current);
  return merged;
}

// Re-export key types and utilities for external use
export type {Config, FillSegment, ParsedChart} from './types';

export {DrumTrackNotFoundError} from './types';

export {defaultConfig as config, defaultConfig} from './config';

// Export version information
export const version = '1.0.0';

/**
 * Default export for CommonJS compatibility
 */
const drumFillExtractor = {
  extractFills,
  createExtractionSummary,
  validateFillSegments,
  defaultConfig,
  version,
};

export default drumFillExtractor;
