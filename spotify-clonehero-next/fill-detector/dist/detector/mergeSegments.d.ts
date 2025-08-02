/**
 * Merges adjacent candidate windows into fill segments and applies duration filtering
 */
import { AnalysisWindow, FillSegment, Config, TempoEvent } from '../types.js';
/**
 * Merges candidate windows into fill segments
 */
export declare function mergeWindowsIntoSegments(windows: AnalysisWindow[], config: Config, resolution: number, tempos: TempoEvent[], songId: string): FillSegment[];
/**
 * Refines segment boundaries to align with musical boundaries
 */
export declare function refineBoundaries(segments: FillSegment[], resolution: number, tempos: TempoEvent[]): FillSegment[];
/**
 * Validates fill segments for consistency
 */
export declare function validateFillSegments(segments: FillSegment[]): string[];
/**
 * Sorts segments chronologically
 */
export declare function sortSegments(segments: FillSegment[]): FillSegment[];
/**
 * Removes overlapping segments, keeping the one with higher confidence
 */
export declare function removeOverlaps(segments: FillSegment[]): FillSegment[];
/**
 * Gets statistics about the segmentation process
 */
export declare function getSegmentationStats(originalWindows: AnalysisWindow[], finalSegments: FillSegment[]): {
    totalWindows: number;
    candidateWindows: number;
    finalSegments: number;
    averageSegmentLength: number;
    totalFillTime: number;
};
//# sourceMappingURL=mergeSegments.d.ts.map