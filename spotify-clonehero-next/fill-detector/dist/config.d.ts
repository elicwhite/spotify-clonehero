/**
 * Configuration for the drum fill extractor
 */
import { Config } from './types.js';
export declare const defaultConfig: Config;
/**
 * Validates and merges user config with defaults
 */
export declare function validateConfig(userConfig?: Partial<Config>): Config;
/**
 * Export the Config interface for external use
 */
export type { Config };
//# sourceMappingURL=config.d.ts.map