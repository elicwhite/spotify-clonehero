/**
 * Adaptive groove model for detecting deviations from established patterns
 */
import { AnalysisWindow, Config } from '../types.js';
/**
 * Represents the statistical model of the groove
 */
export interface GrooveModel {
    mean: number[];
    covariance: number[][];
    covarianceInverse: number[][] | null;
    sampleCount: number;
    isValid: boolean;
}
/**
 * Creates an empty groove model
 */
export declare function createEmptyGrooveModel(featureCount: number): GrooveModel;
/**
 * Updates the groove model with new training windows
 */
export declare function updateGrooveModel(model: GrooveModel, trainingWindows: AnalysisWindow[]): GrooveModel;
/**
 * Calculates Mahalanobis distance for a window relative to the groove model
 */
export declare function calculateGrooveDistance(window: AnalysisWindow, model: GrooveModel): number;
/**
 * Updates groove distances for all windows using rolling groove model
 */
export declare function updateGrooveDistances(windows: AnalysisWindow[], config: Config): void;
/**
 * Identifies windows that are likely part of the main groove pattern
 * These are used as reliable training data for the model
 */
export declare function identifyGrooveWindows(windows: AnalysisWindow[], config: Config): boolean[];
/**
 * Builds a global groove model from the most stable windows
 */
export declare function buildGlobalGrooveModel(windows: AnalysisWindow[], config: Config): GrooveModel;
/**
 * Validates a groove model for consistency
 */
export declare function validateGrooveModel(model: GrooveModel): boolean;
/**
 * Computes confidence score for groove distance measurement
 * Higher confidence means the model is more reliable
 */
export declare function getModelConfidence(model: GrooveModel): number;
//# sourceMappingURL=grooveModel.d.ts.map