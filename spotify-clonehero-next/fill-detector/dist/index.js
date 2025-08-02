/**
 * Main API for the drum fill extractor
 *
 * Usage:
 * ```ts
 * import { extractFills, defaultConfig } from 'drum-fill-extractor';
 * const fills = extractFills(parsedChart, { ...defaultConfig, thresholds: { densityZ: 1.3 } });
 * ```
 */
import { DrumTrackNotFoundError } from './types.js';
import { validateConfig, defaultConfig } from './config.js';
import { validateTempos, buildTempoMap } from './utils/tempoUtils.js';
import { getWindowBoundaries } from './quantize.js';
import { createAnalysisWindows, extractFeaturesFromWindows } from './features/windowStats.js';
import { updateGrooveDistances } from './features/grooveModel.js';
import { detectCandidateWindows, postProcessCandidates } from './detector/candidateMask.js';
import { mergeWindowsIntoSegments, refineBoundaries, removeOverlaps, sortSegments } from './detector/mergeSegments.js';
/**
 * Main API function: extracts drum fills from a parsed chart
 *
 * @param parsedChart - The parsed chart data
 * @param userConfig - Optional configuration overrides
 * @returns Array of detected fill segments
 */
export function extractFills(parsedChart, userConfig) {
    // Validate and merge configuration
    const config = validateConfig(userConfig);
    // Validate input chart
    validateParsedChart(parsedChart);
    // Find drum track
    const drumTrack = findDrumTrack(parsedChart, config.difficulty);
    if (!drumTrack) {
        throw new DrumTrackNotFoundError(config.difficulty);
    }
    // Extract and flatten note events
    const noteEvents = flattenNoteEvents(drumTrack);
    if (noteEvents.length === 0) {
        return []; // No notes, no fills
    }
    // Validate and build tempo map
    validateTempos(parsedChart.tempos);
    const tempoMap = buildTempoMap(parsedChart.tempos, parsedChart.resolution);
    // Determine analysis boundaries
    const { startTick, endTick } = getAnalysisBounds(noteEvents);
    // Create sliding analysis windows
    const windowBoundaries = getWindowBoundaries(startTick, endTick, config.windowBeats, config.strideBeats, parsedChart.resolution);
    // Create analysis windows with notes
    const windows = createAnalysisWindows(noteEvents, startTick, endTick, config.windowBeats, config.strideBeats, parsedChart.resolution, tempoMap);
    if (windows.length === 0) {
        return []; // No windows to analyze
    }
    // Extract features from all windows
    const featuredWindows = extractFeaturesFromWindows(windows, config, parsedChart.resolution);
    // Update groove distances using rolling model
    updateGrooveDistances(featuredWindows, config);
    // Detect candidate windows
    const candidateWindows = detectCandidateWindows(featuredWindows, config);
    // Post-process candidates (remove isolated, apply constraints)
    const processedWindows = postProcessCandidates(candidateWindows, config);
    // Merge candidate windows into segments
    const rawSegments = mergeWindowsIntoSegments(processedWindows, config, parsedChart.resolution, tempoMap, parsedChart.name || 'Unknown');
    // Refine segment boundaries
    const refinedSegments = refineBoundaries(rawSegments, parsedChart.resolution, tempoMap);
    // Remove overlapping segments
    const nonOverlappingSegments = removeOverlaps(refinedSegments);
    // Sort segments chronologically
    const finalSegments = sortSegments(nonOverlappingSegments);
    return finalSegments;
}
/**
 * Validates the parsed chart structure
 */
function validateParsedChart(chart) {
    if (!chart) {
        throw new Error('ParsedChart is required');
    }
    if (typeof chart.resolution !== 'number' || chart.resolution <= 0) {
        throw new Error('Invalid chart resolution');
    }
    if (!Array.isArray(chart.tempos) || chart.tempos.length === 0) {
        throw new Error('Chart must have at least one tempo event');
    }
    if (!Array.isArray(chart.trackData)) {
        throw new Error('Chart must have trackData array');
    }
}
/**
 * Finds the drum track for the specified difficulty
 */
function findDrumTrack(chart, difficulty) {
    return chart.trackData.find(track => track.instrument === 'drums' && track.difficulty === difficulty) || null;
}
/**
 * Flattens note event groups into a single chronological array
 */
function flattenNoteEvents(drumTrack) {
    const allNotes = [];
    for (const noteGroup of drumTrack.noteEventGroups) {
        allNotes.push(...noteGroup);
    }
    // Sort by tick position
    return allNotes.sort((a, b) => a.tick - b.tick);
}
/**
 * Determines the analysis boundaries based on note events
 */
function getAnalysisBounds(noteEvents) {
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
export function createExtractionSummary(chart, fills, config) {
    const drumTrack = findDrumTrack(chart, config.difficulty);
    const noteEvents = drumTrack ? flattenNoteEvents(drumTrack) : [];
    // Calculate song duration (simplified - uses last note time)
    const duration = noteEvents.length > 0 ?
        Math.max(...noteEvents.map(n => n.msTime)) / 1000 : 0;
    const totalFillDuration = fills.reduce((sum, fill) => sum + (fill.endMs - fill.startMs), 0) / 1000;
    const averageFillDuration = fills.length > 0 ? totalFillDuration / fills.length : 0;
    const fillDensityRatio = duration > 0 ? (fills.length / duration) * 60 : 0;
    return {
        songInfo: {
            name: chart.name || 'Unknown',
            artist: chart.artist,
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
export function validateFillSegments(fills) {
    const errors = [];
    const warnings = [];
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
export { DrumTrackNotFoundError, } from './types.js';
export { defaultConfig as config, defaultConfig } from './config.js';
// Export version information
export const version = '1.0.0';
/**
 * Default export for CommonJS compatibility
 */
export default {
    extractFills,
    createExtractionSummary,
    validateFillSegments,
    defaultConfig,
    version,
};
//# sourceMappingURL=index.js.map