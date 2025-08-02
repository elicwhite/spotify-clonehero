/**
 * Main API for the drum fill extractor
 *
 * Usage:
 * ```ts
 * import { extractFills, defaultConfig } from 'drum-fill-extractor';
 * const fills = extractFills(parsedChart, { ...defaultConfig, thresholds: { densityZ: 1.3 } });
 * ```
 */
import { ParsedChart, FillSegment, Config } from './types.js';
/**
 * Main API function: extracts drum fills from a parsed chart
 *
 * @param parsedChart - The parsed chart data
 * @param userConfig - Optional configuration overrides
 * @returns Array of detected fill segments
 */
export declare function extractFills(parsedChart: ParsedChart, userConfig?: Partial<Config>): FillSegment[];
/**
 * Creates a summary of the extraction process
 */
export declare function createExtractionSummary(chart: ParsedChart, fills: FillSegment[], config: Config): {
    songInfo: {
        name: string;
        artist?: string;
        duration: number;
        noteCount: number;
    };
    detectionInfo: {
        fillCount: number;
        totalFillDuration: number;
        averageFillDuration: number;
        fillDensityRatio: number;
    };
    configUsed: Config;
};
/**
 * Validates a fill segment array for common issues
 */
export declare function validateFillSegments(fills: FillSegment[]): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
};
export { Config, FillSegment, ParsedChart, DrumTrackNotFoundError, } from './types.js';
export { defaultConfig as config, defaultConfig } from './config.js';
export declare const version = "1.0.0";
/**
 * Default export for CommonJS compatibility
 */
declare const _default: {
    extractFills: typeof extractFills;
    createExtractionSummary: typeof createExtractionSummary;
    validateFillSegments: typeof validateFillSegments;
    defaultConfig: Config;
    version: string;
};
export default _default;
//# sourceMappingURL=index.d.ts.map