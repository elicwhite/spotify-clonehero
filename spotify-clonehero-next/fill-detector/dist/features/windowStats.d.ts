/**
 * Sliding window feature extraction for drum fill detection
 */
import { NoteEvent, FeatureVector, AnalysisWindow, Config } from '../types.js';
/**
 * Computes the feature vector for a single analysis window
 */
export declare function computeWindowFeatures(window: AnalysisWindow, config: Config, resolution: number, rollingStats?: {
    densityMean: number;
    densityStd: number;
    tomRatioMean: number;
    hatRatioMean: number;
    kickRatioMean: number;
    ioiStdMean: number;
    ioiStdStd: number;
}): FeatureVector;
/**
 * Extracts features from multiple analysis windows
 */
export declare function extractFeaturesFromWindows(windows: AnalysisWindow[], config: Config, resolution: number): AnalysisWindow[];
/**
 * Creates analysis windows from note events
 */
export declare function createAnalysisWindows(notes: NoteEvent[], startTick: number, endTick: number, windowBeats: number, strideBeats: number, resolution: number, tempos: any[]): AnalysisWindow[];
//# sourceMappingURL=windowStats.d.ts.map