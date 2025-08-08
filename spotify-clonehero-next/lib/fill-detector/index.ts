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
  TempoEvent
} from './types';
import { validateConfig, defaultConfig } from './config';
import { validateTempos, buildTempoMap } from './utils/tempoUtils';
import { getWindowBoundaries } from './quantize';
import { createAnalysisWindows, extractFeaturesFromWindows } from './features/windowStats';
import { updateGrooveDistances } from './features/grooveModel';
import { detectCandidateWindows, postProcessCandidates } from './detector/candidateMask';
import { mergeWindowsIntoSegments, refineBoundaries, removeOverlaps, sortSegments } from './detector/mergeSegments';

/**
 * Main API function: extracts drum fills from a chart and track (like convertToVexFlow)
 * 
 * @param chart - The parsed chart data from scan-chart
 * @param track - The specific track data from scan-chart
 * @param userConfig - Optional configuration overrides
 * @returns Array of detected fill segments
 */
export function extractFills(
  chart: ParsedChart,
  track: Track,
  userConfig?: Partial<Config>
): FillSegment[] {
  // Validate and merge configuration
  const config = validateConfig(userConfig);
  
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
  
  // Validate and build tempo map
  validateTempos(chart.tempos);
  const tempoMap = buildTempoMap(chart.tempos, chart.resolution);
  
  // Determine analysis boundaries
  const { startTick, endTick } = getAnalysisBounds(noteEvents);
  
  // Create sliding analysis windows
  const windowBoundaries = getWindowBoundaries(
    startTick,
    endTick,
    config.windowBeats,
    config.strideBeats,
    chart.resolution
  );
  
  // Create analysis windows with notes
  const windows = createAnalysisWindows(
    noteEvents,
    startTick,
    endTick,
    config.windowBeats,
    config.strideBeats,
    chart.resolution,
    tempoMap
  );
  
  if (windows.length === 0) {
    return []; // No windows to analyze
  }
  
  // Extract features from all windows
  const featuredWindows = extractFeaturesFromWindows(windows, config, chart.resolution);
  
  // Update groove distances using rolling model
  updateGrooveDistances(featuredWindows, config);
  
  // Detect candidate windows
  const candidateWindows = detectCandidateWindows(featuredWindows, config);
  
  // Post-process candidates (remove isolated, apply constraints)
  const processedWindows = postProcessCandidates(candidateWindows, config);
  
  // Merge candidate windows into segments
  const rawSegments = mergeWindowsIntoSegments(
    processedWindows,
    config,
    chart.resolution,
    tempoMap,
    chart.metadata?.name || 'Unknown'
  );
  
  // Refine segment boundaries
  const refinedSegments = refineBoundaries(rawSegments, chart.resolution, tempoMap);
  
  // Remove overlapping segments
  const nonOverlappingSegments = removeOverlaps(refinedSegments);
  
  // Sort segments chronologically
  const finalSegments = sortSegments(nonOverlappingSegments);
  
  return finalSegments;
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
function getAnalysisBounds(noteEvents: NoteEvent[]): { startTick: number; endTick: number } {
  if (noteEvents.length === 0) {
    return { startTick: 0, endTick: 0 };
  }
  
  const firstNote = noteEvents[0];
  const lastNote = noteEvents[noteEvents.length - 1];
  
  if (!firstNote || !lastNote) {
    return { startTick: 0, endTick: 0 };
  }
  
  return { startTick: firstNote.tick, endTick: lastNote.tick };
}

/**
 * Creates a summary of the extraction process
 */
export function createExtractionSummary(
  chart: ParsedChart,
  track: Track,
  fills: FillSegment[],
  config: ValidatedConfig
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
  const duration = noteEvents.length > 0 ? 
    Math.max(...noteEvents.map(n => n.msTime)) / 1000 : 0;
  
  const totalFillDuration = fills.reduce((sum, fill) => 
    sum + (fill.endMs - fill.startMs), 0) / 1000;
  
  const averageFillDuration = fills.length > 0 ? totalFillDuration / fills.length : 0;
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
    if (durationMs > 10000) { // > 10 seconds
      warnings.push(`Fill ${i}: very long duration (${durationMs / 1000}s)`);
    }
    
    if (durationMs < 100) { // < 100ms
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

// Re-export key types and utilities for external use
export type {
  Config,
  FillSegment,
  ParsedChart,
} from './types';

export {
  DrumTrackNotFoundError,
} from './types';

export { defaultConfig as config, defaultConfig } from './config';

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