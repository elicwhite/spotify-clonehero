/**
 * Configuration for the drum fill extractor
 */

import { Config, InvalidConfigError } from './types';

export const defaultConfig: Config = {
  difficulty: "expert",
  quantDiv: 4,
  windowBeats: 1,
  strideBeats: 0.25,
  lookbackBars: 8,
  thresholds: {
    densityZ: 1.2,
    dist: 2.0,
    tomJump: 1.5,
    minBeats: 0.75,
    maxBeats: 4,
    mergeGapBeats: 0.25,
    burstMs: 120,
  },
};

/**
 * Validates and merges user config with defaults
 */
export function validateConfig(userConfig?: Partial<Config>): Config {
  const config = { ...defaultConfig, ...userConfig };
  
  // Merge nested thresholds object properly
  if (userConfig?.thresholds) {
    config.thresholds = { ...defaultConfig.thresholds, ...userConfig.thresholds };
  }

  // Validation
  if (config.quantDiv !== undefined && config.quantDiv <= 0) {
    throw new InvalidConfigError('quantDiv must be positive');
  }
  
  if (config.windowBeats !== undefined && config.windowBeats <= 0) {
    throw new InvalidConfigError('windowBeats must be positive');
  }
  
  if (config.strideBeats !== undefined && config.strideBeats <= 0) {
    throw new InvalidConfigError('strideBeats must be positive');
  }
  
  if (config.lookbackBars !== undefined && config.lookbackBars <= 0) {
    throw new InvalidConfigError('lookbackBars must be positive');
  }

  // Validate thresholds (only if they exist)
  if (config.thresholds) {
    const t = config.thresholds;
    if (t.minBeats !== undefined && t.minBeats <= 0) {
      throw new InvalidConfigError('thresholds.minBeats must be positive');
    }
    
    if (t.maxBeats !== undefined && t.minBeats !== undefined && t.maxBeats <= t.minBeats) {
      throw new InvalidConfigError('thresholds.maxBeats must be greater than minBeats');
    }
    
    if (t.mergeGapBeats !== undefined && t.mergeGapBeats < 0) {
      throw new InvalidConfigError('thresholds.mergeGapBeats must be non-negative');
    }
    
    if (t.burstMs !== undefined && t.burstMs <= 0) {
      throw new InvalidConfigError('thresholds.burstMs must be positive');  
    }
  }

  return config;
}

/**
 * Export the Config interface for external use
 */
export type { Config };