/**
 * Merges adjacent candidate windows into fill segments and applies duration filtering
 */

import {
  AnalysisWindow,
  FillSegment,
  ValidatedConfig,
  TempoEvent,
} from '../types';
import {ticksToBeats} from '../quantize';
import {tickRangeToMs} from '../utils/tempoUtils';
import {mean} from '../utils/math';

/**
 * Intermediate segment representation before final conversion
 */
interface CandidateSegment {
  startTick: number;
  endTick: number;
  windows: AnalysisWindow[];
  gapBeforeNext?: number; // Gap to next segment in beats
}

/**
 * Merges candidate windows into fill segments
 */
export function mergeWindowsIntoSegments(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
  tempos: TempoEvent[],
  songId: string,
): FillSegment[] {
  // Step 1: Group consecutive candidate windows
  const candidateSegments = groupConsecutiveCandidates(
    windows,
    config,
    resolution,
  );

  // Step 2: Merge segments that are close together
  const mergedSegments = mergeNearbySegments(
    candidateSegments,
    config,
    resolution,
  );

  // Step 3: Filter segments by duration constraints
  const filteredSegments = filterSegmentsByDuration(
    mergedSegments,
    config,
    resolution,
  );

  // Step 4: Convert to final FillSegment format
  const fillSegments = convertToFillSegments(
    filteredSegments,
    tempos,
    resolution,
    songId,
  );

  return fillSegments;
}

/**
 * Groups consecutive candidate windows into initial segments
 */
function groupConsecutiveCandidates(
  windows: AnalysisWindow[],
  config: ValidatedConfig,
  resolution: number,
): CandidateSegment[] {
  const segments: CandidateSegment[] = [];
  let currentSegment: CandidateSegment | null = null;

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];

    if (window.isCandidate) {
      if (!currentSegment) {
        // Start new segment
        currentSegment = {
          startTick: window.startTick,
          endTick: window.endTick,
          windows: [window],
        };
      } else {
        // Extend current segment
        currentSegment.endTick = window.endTick;
        currentSegment.windows.push(window);
      }
    } else if (currentSegment) {
      // End current segment
      segments.push(currentSegment);
      currentSegment = null;
    }
  }

  // Don't forget the last segment if it ends with candidates
  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Merges segments that are separated by small gaps
 */
function mergeNearbySegments(
  segments: CandidateSegment[],
  config: ValidatedConfig,
  resolution: number,
): CandidateSegment[] {
  if (segments.length <= 1) return segments;

  const mergedSegments: CandidateSegment[] = [];
  const mergeGapTicks = (config.thresholds?.mergeGapBeats || 0.2) * resolution;

  let currentSegment = segments[0];

  for (let i = 1; i < segments.length; i++) {
    const nextSegment = segments[i];
    const gap = nextSegment.startTick - currentSegment.endTick;

    if (gap <= mergeGapTicks) {
      // Merge segments
      currentSegment = {
        startTick: currentSegment.startTick,
        endTick: nextSegment.endTick,
        windows: [...currentSegment.windows, ...nextSegment.windows],
      };
    } else {
      // Gap too large, finalize current and start new
      mergedSegments.push(currentSegment);
      currentSegment = nextSegment;
    }
  }

  // Add the final segment
  mergedSegments.push(currentSegment);

  return mergedSegments;
}

/**
 * Filters segments based on duration constraints
 */
function filterSegmentsByDuration(
  segments: CandidateSegment[],
  config: ValidatedConfig,
  resolution: number,
): CandidateSegment[] {
  return segments.filter(segment => {
    const durationTicks = segment.endTick - segment.startTick;
    const durationBeats = ticksToBeats(durationTicks, resolution);

    return (
      durationBeats >= (config.thresholds?.minBeats || 1.0) &&
      durationBeats <= (config.thresholds?.maxBeats || 4)
    );
  });
}

// Removed content-alignment step to avoid unintended start shifts

/**
 * Converts candidate segments to final FillSegment format
 */
function convertToFillSegments(
  segments: CandidateSegment[],
  tempos: TempoEvent[],
  resolution: number,
  songId: string,
): FillSegment[] {
  return segments.map(segment => {
    const {startMs, endMs} = tickRangeToMs(
      segment.startTick,
      segment.endTick,
      tempos,
      resolution,
    );

    // Aggregate features from all windows in the segment
    const aggregatedFeatures = aggregateSegmentFeatures(segment.windows);

    // Determine an anchor tick to decide the measure: prefer the first TOM/CYMBAL-heavy onset
    // within a 1-beat window; fallback to first note tick.
    const oneBeat = resolution;
    let firstNoteTick: number | null = null;
    let tomAnchorTick: number | null = null;

    const allNotes = segment.windows
      .flatMap(w => w.notes)
      .filter(n => n.tick >= segment.startTick && n.tick <= segment.endTick)
      .sort((a, b) => a.tick - b.tick);

    for (const note of allNotes) {
      if (firstNoteTick === null) firstNoteTick = note.tick;
      // Look ahead 1 beat from this note and compute tom ratio
      const windowNotes = allNotes.filter(
        n => n.tick >= note.tick && n.tick < note.tick + oneBeat,
      );
      if (windowNotes.length >= 3) {
        const tomCount = windowNotes.filter(
          n => n.type === 3 || n.type === 5 || n.type === 4,
        ).length; // toms/crashes
        const ratio = tomCount / windowNotes.length;
        if (ratio >= 0.5) {
          // tom-heavy
          tomAnchorTick = note.tick;
          break;
        }
      }
    }
    const anchorTick = tomAnchorTick ?? firstNoteTick ?? segment.startTick;

    // Compute measure based on anchor tick (assume 4/4 default)
    const barTicks = 4 * resolution;
    const measureIndex = Math.floor(anchorTick / barTicks); // 0-based
    const measureStartTick = measureIndex * barTicks;
    const measureEndTick = measureStartTick + barTicks;
    const measureTimes = tickRangeToMs(
      measureStartTick,
      measureEndTick,
      tempos,
      resolution,
    );

    return {
      songId,
      startTick: segment.startTick,
      endTick: segment.endTick,
      startMs,
      endMs,
      // Measure is defined by where the first beat of the fill takes place
      measureStartTick,
      measureEndTick,
      measureStartMs: measureTimes.startMs,
      measureEndMs: measureTimes.endMs,
      measureNumber: measureIndex + 1,
      ...aggregatedFeatures,
    };
  });
}

/**
 * Aggregates features from multiple windows into segment-level scores
 */
function aggregateSegmentFeatures(windows: AnalysisWindow[]): {
  densityZ: number;
  tomRatioJump: number;
  hatDropout: number;
  kickDrop: number;
  ioiStdZ: number;
  ngramNovelty: number;
  samePadBurst: boolean;
  crashResolve: boolean;
  grooveDist: number;
} {
  if (windows.length === 0) {
    return {
      densityZ: 0,
      tomRatioJump: 0,
      hatDropout: 0,
      kickDrop: 0,
      ioiStdZ: 0,
      ngramNovelty: 0,
      samePadBurst: false,
      crashResolve: false,
      grooveDist: 0,
    };
  }

  // For continuous features, take the mean
  const densityZ = mean(windows.map(w => w.features.densityZ));
  const tomRatioJump = mean(windows.map(w => w.features.tomRatioJump));
  const hatDropout = mean(windows.map(w => w.features.hatDropout));
  const kickDrop = mean(windows.map(w => w.features.kickDrop));
  const ioiStdZ = mean(windows.map(w => w.features.ioiStdZ));
  const ngramNovelty = mean(windows.map(w => w.features.ngramNovelty));
  const grooveDist = mean(windows.map(w => w.features.grooveDist));

  // For boolean features, use logical OR (any window with the feature)
  const samePadBurst = windows.some(w => w.features.samePadBurst);
  const crashResolve = windows.some(w => w.features.crashResolve);

  return {
    densityZ,
    tomRatioJump,
    hatDropout,
    kickDrop,
    ioiStdZ,
    ngramNovelty,
    samePadBurst,
    crashResolve,
    grooveDist,
  };
}

/**
 * Refines segment boundaries to align with musical boundaries
 */
export function refineBoundaries(
  segments: FillSegment[],
  resolution: number,
  tempos: TempoEvent[],
): FillSegment[] {
  return segments.map(segment => {
    // Keep start at or before the first hit of the fill
    const alignedStart = alignToBeatFloor(segment.startTick, resolution);
    // End can be snapped up to ensure we fully capture the fill
    const alignedEnd = alignToBeatCeil(segment.endTick, resolution);

    // Recalculate timing with aligned boundaries
    const {startMs, endMs} = tickRangeToMs(
      alignedStart,
      alignedEnd,
      tempos,
      resolution,
    );

    return {
      ...segment,
      startTick: alignedStart,
      endTick: alignedEnd,
      startMs,
      endMs,
    };
  });
}

/**
 * Aligns a tick to the nearest beat boundary
 */
function alignToBeatCeil(tick: number, resolution: number): number {
  return Math.ceil(tick / resolution) * resolution;
}

function alignToBeatFloor(tick: number, resolution: number): number {
  return Math.floor(tick / resolution) * resolution;
}

/**
 * Validates fill segments for consistency
 */
export function validateFillSegments(segments: FillSegment[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // Check basic constraints
    if (segment.startTick >= segment.endTick) {
      errors.push(`Segment ${i}: startTick >= endTick`);
    }

    if (segment.startMs >= segment.endMs) {
      errors.push(`Segment ${i}: startMs >= endMs`);
    }

    if (segment.startTick < 0 || segment.endTick < 0) {
      errors.push(`Segment ${i}: negative tick values`);
    }

    if (segment.startMs < 0 || segment.endMs < 0) {
      errors.push(`Segment ${i}: negative time values`);
    }

    // Check for overlapping segments
    if (i > 0) {
      const prevSegment = segments[i - 1];
      if (segment.startTick < prevSegment.endTick) {
        errors.push(`Segment ${i}: overlaps with previous segment`);
      }
    }

    // Validate feature values
    if (!isFinite(segment.densityZ) || !isFinite(segment.grooveDist)) {
      errors.push(`Segment ${i}: invalid feature values`);
    }
  }

  return errors;
}

/**
 * Sorts segments chronologically
 */
export function sortSegments(segments: FillSegment[]): FillSegment[] {
  return [...segments].sort((a, b) => {
    if (a.songId !== b.songId) {
      return a.songId.localeCompare(b.songId);
    }
    return a.startTick - b.startTick;
  });
}

/**
 * Removes overlapping segments, keeping the one with higher confidence
 */
export function removeOverlaps(segments: FillSegment[]): FillSegment[] {
  if (segments.length <= 1) return segments;

  const sorted = sortSegments(segments);
  const result: FillSegment[] = [];

  for (const segment of sorted) {
    const lastSegment = result[result.length - 1];

    if (!lastSegment || segment.startTick >= lastSegment.endTick) {
      // No overlap, add segment
      result.push(segment);
    } else {
      // Overlap detected, keep the one with higher groove distance (more confident)
      if (segment.grooveDist > lastSegment.grooveDist) {
        result[result.length - 1] = segment;
      }
      // Otherwise, keep the existing segment (do nothing)
    }
  }

  return result;
}

/**
 * Gets statistics about the segmentation process
 */
export function getSegmentationStats(
  originalWindows: AnalysisWindow[],
  finalSegments: FillSegment[],
): {
  totalWindows: number;
  candidateWindows: number;
  finalSegments: number;
  averageSegmentLength: number;
  totalFillTime: number;
} {
  const totalWindows = originalWindows.length;
  const candidateWindows = originalWindows.filter(w => w.isCandidate).length;
  const finalSegmentCount = finalSegments.length;

  const segmentLengths = finalSegments.map(s => s.endMs - s.startMs);
  const averageSegmentLength =
    segmentLengths.length > 0 ? mean(segmentLengths) : 0;
  const totalFillTime = segmentLengths.reduce((sum, length) => sum + length, 0);

  return {
    totalWindows,
    candidateWindows,
    finalSegments: finalSegmentCount,
    averageSegmentLength,
    totalFillTime,
  };
}
