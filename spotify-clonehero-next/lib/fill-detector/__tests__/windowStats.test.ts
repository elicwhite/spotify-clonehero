import {
  createAnalysisWindows,
  extractFeaturesFromWindows,
  computeWindowFeatures,
} from '../features/windowStats';
import {validateConfig, defaultConfig} from '../config';
import {buildTempoMap} from '../utils/tempoUtils';
import {NoteEvent, AnalysisWindow, ValidatedConfig} from '../types';

// Helper function to create test chart data
function createTestChart() {
  const resolution = 192;
  const notes: NoteEvent[] = [];

  // Simple pattern (4 bars) - kick and snare
  for (let bar = 0; bar < 4; bar++) {
    const barStart = bar * resolution * 4;

    // Kick on 1 and 3
    notes.push({
      tick: barStart,
      msTime: (barStart / resolution) * (60000 / 120),
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });

    notes.push({
      tick: barStart + resolution * 2,
      msTime: ((barStart + resolution * 2) / resolution) * (60000 / 120),
      length: resolution / 4,
      msLength: 125,
      type: 0, // Kick
      flags: 0,
    });

    // Snare on 2 and 4
    notes.push({
      tick: barStart + resolution,
      msTime: ((barStart + resolution) / resolution) * (60000 / 120),
      length: resolution / 4,
      msLength: 125,
      type: 1, // Snare
      flags: 0,
    });

    notes.push({
      tick: barStart + resolution * 3,
      msTime: ((barStart + resolution * 3) / resolution) * (60000 / 120),
      length: resolution / 4,
      msLength: 125,
      type: 1, // Snare
      flags: 0,
    });
  }

  // Dense fill pattern (1 bar) - 16 tom notes
  const fillStart = 4 * resolution * 4;
  for (let i = 0; i < 16; i++) {
    const tick = fillStart + i * (resolution / 4);
    notes.push({
      tick,
      msTime: (tick / resolution) * (60000 / 120),
      length: resolution / 8,
      msLength: 62.5,
      type: 3, // Tom
      flags: 0,
    });
  }

  return {
    name: 'Test Chart',
    resolution,
    tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    trackData: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        noteEventGroups: [notes],
      },
    ],
    notes,
  };
}

describe('Window Statistics', () => {
  let testChart: ReturnType<typeof createTestChart>;
  let config: ValidatedConfig;
  let tempoMap: any[];

  beforeEach(() => {
    testChart = createTestChart();
    config = validateConfig();
    tempoMap = buildTempoMap(testChart.tempos, testChart.resolution);
  });

  describe('createAnalysisWindows', () => {
    it('should create correct number of analysis windows', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      expect(windows.length).toBeGreaterThan(0);
      expect(windows.length).toBeLessThan(200); // Reasonable upper bound
    });

    it('should create windows with correct tick boundaries', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        1000, // Small range for testing
        1, // 1 beat windows
        0.25, // 0.25 beat stride
        testChart.resolution,
        tempoMap,
      );

      // Check that windows have correct size (1 beat = 192 ticks)
      windows.forEach(window => {
        const windowSize = window.endTick - window.startTick;
        expect(windowSize).toBe(192); // 1 beat
      });

      // Check stride between windows (0.25 beat = 48 ticks)
      if (windows.length > 1) {
        const stride = windows[1].startTick - windows[0].startTick;
        expect(stride).toBe(48); // 0.25 beat
      }
    });

    it('should assign notes to correct windows', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      // Find windows in the fill section (ticks 3072-3840)
      const fillWindows = windows.filter(
        w => w.startTick >= 3000 && w.startTick <= 3800,
      );

      expect(fillWindows.length).toBeGreaterThan(0);

      // Check that fill windows have more notes than regular windows
      const regularWindows = windows.filter(
        w => w.startTick >= 0 && w.startTick < 3000,
      );

      const avgFillNotes =
        fillWindows.reduce((sum, w) => sum + w.notes.length, 0) /
        fillWindows.length;
      const avgRegularNotes =
        regularWindows.length > 0
          ? regularWindows.reduce((sum, w) => sum + w.notes.length, 0) /
            regularWindows.length
          : 0;

      expect(avgFillNotes).toBeGreaterThan(avgRegularNotes);
    });
  });

  describe('extractFeaturesFromWindows', () => {
    it('should extract features for all windows', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      const featuredWindows = extractFeaturesFromWindows(
        windows,
        config,
        testChart.resolution,
      );

      expect(featuredWindows.length).toBe(windows.length);

      featuredWindows.forEach(window => {
        expect(window.features).toBeDefined();
        expect(typeof window.features.noteDensity).toBe('number');
        expect(typeof window.features.densityZ).toBe('number');
        expect(typeof window.features.tomRatioJump).toBe('number');
        expect(typeof window.features.grooveDist).toBe('number');
      });
    });

    it('should calculate density correctly for fill windows', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      const featuredWindows = extractFeaturesFromWindows(
        windows,
        config,
        testChart.resolution,
      );

      // Find windows in the fill section
      const fillWindows = featuredWindows.filter(
        w => w.startTick >= 3072 && w.startTick <= 3800 && w.notes.length >= 3,
      );

      expect(fillWindows.length).toBeGreaterThan(0);

      fillWindows.forEach(window => {
        // Density should be finite and positive
        expect(window.features.noteDensity).toBeGreaterThan(0);
        expect(isFinite(window.features.noteDensity)).toBe(true);
        expect(window.features.noteDensity).not.toBe(Infinity);

        // Fill windows should have high density (4+ notes per beat)
        expect(window.features.noteDensity).toBeGreaterThanOrEqual(3);
      });
    });

    it('should calculate high densityZ for fill sections', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      const featuredWindows = extractFeaturesFromWindows(
        windows,
        config,
        testChart.resolution,
      );

      // Find windows in the fill section
      const fillWindows = featuredWindows.filter(
        w => w.startTick >= 3072 && w.startTick <= 3800 && w.notes.length >= 3,
      );

      expect(fillWindows.length).toBeGreaterThan(0);

      // At least some fill windows should have high densityZ
      const highDensityWindows = fillWindows.filter(
        w => w.features.densityZ > 2,
      );
      expect(highDensityWindows.length).toBeGreaterThan(0);
    });

    it('should detect high tom content in fill windows', () => {
      const windows = createAnalysisWindows(
        testChart.notes,
        0,
        testChart.notes[testChart.notes.length - 1].tick + 100,
        config.windowBeats,
        config.strideBeats,
        testChart.resolution,
        tempoMap,
      );

      const featuredWindows = extractFeaturesFromWindows(
        windows,
        config,
        testChart.resolution,
      );

      // Find windows in the fill section (should be all toms)
      const fillWindows = featuredWindows.filter(
        w => w.startTick >= 3072 && w.startTick <= 3800 && w.notes.length >= 3,
      );

      expect(fillWindows.length).toBeGreaterThan(0);

      fillWindows.forEach(window => {
        // Check that notes are mostly toms (type 3)
        const tomCount = window.notes.filter(n => n.type === 3).length;
        const tomRatio = tomCount / window.notes.length;
        expect(tomRatio).toBeGreaterThan(0.9); // Should be mostly toms
      });
    });
  });

  describe('computeWindowFeatures', () => {
    it('should compute features for a single window', () => {
      const testWindow: AnalysisWindow = {
        startTick: 3072,
        endTick: 3264,
        startMs: 0,
        endMs: 1000,
        notes: [
          {
            tick: 3072,
            msTime: 0,
            length: 24,
            msLength: 62.5,
            type: 3,
            flags: 0,
          },
          {
            tick: 3120,
            msTime: 0,
            length: 24,
            msLength: 62.5,
            type: 3,
            flags: 0,
          },
          {
            tick: 3168,
            msTime: 0,
            length: 24,
            msLength: 62.5,
            type: 3,
            flags: 0,
          },
          {
            tick: 3216,
            msTime: 0,
            length: 24,
            msLength: 62.5,
            type: 3,
            flags: 0,
          },
        ],
        features: {
          noteDensity: 0,
          densityZ: 0,
          tomRatioJump: 0,
          hatDropout: 0,
          kickDrop: 0,
          ioiStdZ: 0,
          ngramNovelty: 0,
          samePadBurst: false,
          crashResolve: false,
          grooveDist: 0,
        },
        isCandidate: false,
      };

      const features = computeWindowFeatures(
        testWindow,
        config,
        testChart.resolution,
      );

      expect(features.noteDensity).toBe(4); // 4 notes in 1 beat
      expect(features.densityZ).toBe(0); // No rolling stats provided
      expect(features.tomRatioJump).toBe(1); // No rolling stats provided
      expect(typeof features.grooveDist).toBe('number');
      expect(typeof features.ngramNovelty).toBe('number');
      expect(typeof features.samePadBurst).toBe('boolean');
      expect(typeof features.crashResolve).toBe('boolean');
    });

    it('should handle empty windows gracefully', () => {
      const emptyWindow: AnalysisWindow = {
        startTick: 0,
        endTick: 192,
        startMs: 0,
        endMs: 500,
        notes: [],
        features: {
          noteDensity: 0,
          densityZ: 0,
          tomRatioJump: 0,
          hatDropout: 0,
          kickDrop: 0,
          ioiStdZ: 0,
          ngramNovelty: 0,
          samePadBurst: false,
          crashResolve: false,
          grooveDist: 0,
        },
        isCandidate: false,
      };

      const features = computeWindowFeatures(
        emptyWindow,
        config,
        testChart.resolution,
      );

      expect(features.noteDensity).toBe(0);
      expect(isFinite(features.noteDensity)).toBe(true);
      expect(features.densityZ).toBe(0);
      expect(features.tomRatioJump).toBe(1);
    });

    it('should not produce infinite density values', () => {
      const testWindow: AnalysisWindow = {
        startTick: 0,
        endTick: 192,
        startMs: 0,
        endMs: 500,
        notes: [
          {tick: 48, msTime: 0, length: 24, msLength: 62.5, type: 0, flags: 0},
          {tick: 96, msTime: 0, length: 24, msLength: 62.5, type: 1, flags: 0},
        ],
        features: {
          noteDensity: 0,
          densityZ: 0,
          tomRatioJump: 0,
          hatDropout: 0,
          kickDrop: 0,
          ioiStdZ: 0,
          ngramNovelty: 0,
          samePadBurst: false,
          crashResolve: false,
          grooveDist: 0,
        },
        isCandidate: false,
      };

      const features = computeWindowFeatures(
        testWindow,
        config,
        testChart.resolution,
      );

      expect(isFinite(features.noteDensity)).toBe(true);
      expect(features.noteDensity).not.toBe(Infinity);
      expect(features.noteDensity).not.toBe(NaN);
      expect(features.noteDensity).toBe(2); // 2 notes in 1 beat
    });
  });
});
