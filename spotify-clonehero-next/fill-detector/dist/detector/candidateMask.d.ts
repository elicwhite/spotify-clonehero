/**
 * Candidate window detection using threshold-based rules
 */
import { AnalysisWindow, Config } from '../types.js';
/**
 * Detection result for a single window
 */
export interface DetectionResult {
    isCandidate: boolean;
    reasons: string[];
    confidence: number;
}
/**
 * Applies threshold-based rules to identify fill candidate windows
 */
export declare function detectCandidateWindows(windows: AnalysisWindow[], config: Config): AnalysisWindow[];
/**
 * Evaluates a single window against detection criteria
 */
export declare function evaluateWindow(window: AnalysisWindow, config: Config): DetectionResult;
/**
 * Applies post-processing rules to refine candidate detection
 */
export declare function postProcessCandidates(windows: AnalysisWindow[], config: Config): AnalysisWindow[];
/**
 * Gets statistics about candidate detection results
 */
export declare function getCandidateStatistics(windows: AnalysisWindow[]): {
    totalWindows: number;
    candidateWindows: number;
    candidateRatio: number;
    averageConfidence: number;
    candidateGroups: number;
};
/**
 * Validates detection parameters
 */
export declare function validateDetectionConfig(config: Config): string[];
/**
 * Creates a debug report for candidate detection
 */
export declare function createDetectionReport(windows: AnalysisWindow[], config: Config): string;
//# sourceMappingURL=candidateMask.d.ts.map