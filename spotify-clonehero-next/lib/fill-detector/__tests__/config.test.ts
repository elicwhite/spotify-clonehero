/**
 * Unit tests for configuration validation
 */

import {validateConfig, defaultConfig} from '../config';
import {InvalidConfigError, ValidatedConfig} from '../types';

describe('Configuration', () => {
  describe('validateConfig', () => {
    it('should return default config when no user config provided', () => {
      const config = validateConfig();
      expect(config).toEqual(defaultConfig);
    });

    it('should merge user config with defaults', () => {
      const userConfig = {
        difficulty: 'hard' as const,
        windowBeats: 2,
      };

      const config = validateConfig(userConfig);

      expect(config.difficulty).toBe('hard');
      expect(config.windowBeats).toBe(2);
      expect(config.strideBeats).toBe(defaultConfig.strideBeats); // Should keep default
    });

    it('should merge nested thresholds properly', () => {
      const userConfig = {
        thresholds: {
          densityZ: 2.0,
          // Other thresholds should remain default
        },
      };

      const config = validateConfig(userConfig);

      expect(config.thresholds.densityZ).toBe(2.0);
      expect(config.thresholds.dist).toBe(defaultConfig.thresholds.dist);
      expect(config.thresholds.tomJump).toBe(defaultConfig.thresholds.tomJump);
    });

    it('should validate quantDiv', () => {
      expect(() => {
        validateConfig({quantDiv: 0});
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({quantDiv: -1});
      }).toThrow(InvalidConfigError);
    });

    it('should validate windowBeats', () => {
      expect(() => {
        validateConfig({windowBeats: 0});
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({windowBeats: -1});
      }).toThrow(InvalidConfigError);
    });

    it('should validate strideBeats', () => {
      expect(() => {
        validateConfig({strideBeats: 0});
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({strideBeats: -1});
      }).toThrow(InvalidConfigError);
    });

    it('should validate lookbackBars', () => {
      expect(() => {
        validateConfig({lookbackBars: 0});
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({lookbackBars: -1});
      }).toThrow(InvalidConfigError);
    });

    it('should validate thresholds.minBeats', () => {
      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, minBeats: 0},
        });
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, minBeats: -1},
        });
      }).toThrow(InvalidConfigError);
    });

    it('should validate thresholds.maxBeats > minBeats', () => {
      expect(() => {
        validateConfig({
          thresholds: {
            ...defaultConfig.thresholds,
            minBeats: 5,
            maxBeats: 3,
          },
        });
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({
          thresholds: {
            ...defaultConfig.thresholds,
            minBeats: 2,
            maxBeats: 2,
          },
        });
      }).toThrow(InvalidConfigError);
    });

    it('should validate thresholds.mergeGapBeats', () => {
      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, mergeGapBeats: -1},
        });
      }).toThrow(InvalidConfigError);

      // Zero should be allowed
      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, mergeGapBeats: 0},
        });
      }).not.toThrow();
    });

    it('should validate thresholds.burstMs', () => {
      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, burstMs: 0},
        });
      }).toThrow(InvalidConfigError);

      expect(() => {
        validateConfig({
          thresholds: {...defaultConfig.thresholds, burstMs: -1},
        });
      }).toThrow(InvalidConfigError);
    });

    it('should accept valid configuration', () => {
      const validConfig = {
        difficulty: 'expert' as const,
        quantDiv: 8,
        windowBeats: 1.5,
        strideBeats: 0.5,
        lookbackBars: 16,
        thresholds: {
          densityZ: 1.5,
          dist: 2.5,
          tomJump: 2.0,
          minBeats: 1.0,
          maxBeats: 6.0,
          mergeGapBeats: 0.5,
          burstMs: 150,
        },
      };

      expect(() => {
        const config = validateConfig(validConfig);
        expect(config).toMatchObject(validConfig);
      }).not.toThrow();
    });
  });

  describe('defaultConfig', () => {
    it('should have valid default values', () => {
      expect(defaultConfig.difficulty).toBe('expert');
      expect(defaultConfig.quantDiv).toBeGreaterThan(0);
      expect(defaultConfig.windowBeats).toBeGreaterThan(0);
      expect(defaultConfig.strideBeats).toBeGreaterThan(0);
      expect(defaultConfig.lookbackBars).toBeGreaterThan(0);

      const t = defaultConfig.thresholds;
      expect(t.densityZ).toBeGreaterThan(0);
      expect(t.dist).toBeGreaterThan(0);
      expect(t.tomJump).toBeGreaterThan(1);
      expect(t.minBeats).toBeGreaterThan(0);
      expect(t.maxBeats).toBeGreaterThan(t.minBeats);
      expect(t.mergeGapBeats).toBeGreaterThanOrEqual(0);
      expect(t.burstMs).toBeGreaterThan(0);
    });

    it('should pass its own validation', () => {
      expect(() => {
        validateConfig(defaultConfig);
      }).not.toThrow();
    });
  });
});
