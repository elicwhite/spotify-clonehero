/**
 * Integration tests for the complete fill detection pipeline
 */

import {
  extractFills,
  defaultConfig,
  validateFillSegments,
  createExtractionSummary,
} from '../index';
import {
  ParsedChart,
  NoteEvent,
  TempoEvent,
  DrumTrackNotFoundError,
  Track,
} from '../types';
import type {NoteType} from '@eliwhite/scan-chart';

// Helper function to create synthetic chart data
function createSyntheticChart(
  noteEvents: NoteEvent[],
  name = 'Test Song',
  resolution = 192,
  tempos: TempoEvent[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}],
): ParsedChart {
  // Calculate msTime for notes based on tempo
  const notesWithTime = noteEvents.map(note => ({
    ...note,
    msTime: (note.tick / resolution) * (60000 / 120), // 120 BPM assumption
    msLength: (note.length / resolution) * (60000 / 120),
  }));

  const drumTrack: Track = {
    instrument: 'drums',
    difficulty: 'expert',
    noteEventGroups: [notesWithTime],
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
  };

  return {
    resolution,
    tempos,
    timeSignatures: [
      {tick: 0, numerator: 4, denominator: 4, msTime: 0, msLength: 0},
    ],
    trackData: [drumTrack],
    metadata: {name},
    hasLyrics: false,
    hasVocals: false,
    hasForcedNotes: false,
    endEvents: [],
    sections: [],
    drumType: 1,
  };
}

describe('Fill Detection Integration', () => {
  describe('extractFills', () => {
    it('should handle empty chart', () => {
      const chart = createSyntheticChart([]);
      const fills = extractFills(chart);
      expect(fills).toEqual([]);
    });

    it('should throw error for missing drum track', () => {
      const chart: ParsedChart = {
        resolution: 192,
        tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
        timeSignatures: [
          {tick: 0, numerator: 4, denominator: 4, msTime: 0, msLength: 0},
        ],
        trackData: [], // No drum track
        metadata: {name: 'No Track'},
        hasLyrics: false,
        hasVocals: false,
        hasForcedNotes: false,
        endEvents: [],
        sections: [],
        drumType: 1,
      };

      expect(() => {
        extractFills(chart);
      }).toThrow(DrumTrackNotFoundError);
    });

    it('should detect simple fill pattern', () => {
      // Create a simple pattern: steady beat followed by dense fill
      const notes: NoteEvent[] = [];
      const resolution = 192;

      // Steady beat pattern (4 bars)
      for (let bar = 0; bar < 4; bar++) {
        const barStart = bar * resolution * 4;

        // Kick on 1 and 3
        notes.push({
          tick: barStart,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 0, // Kick
          flags: 0,
        });

        notes.push({
          tick: barStart + resolution * 2,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 0, // Kick
          flags: 0,
        });

        // Snare on 2 and 4
        notes.push({
          tick: barStart + resolution,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 1, // Snare
          flags: 0,
        });

        notes.push({
          tick: barStart + resolution * 3,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 1, // Snare
          flags: 0,
        });
      }

      // Dense fill pattern (1 bar)
      const fillStart = 4 * resolution * 4;
      for (let i = 0; i < 16; i++) {
        // 16th notes
        const tick = fillStart + i * (resolution / 4);
        notes.push({
          tick,
          msTime: (tick / resolution) * (60000 / 120),
          length: resolution / 8,
          msLength: (resolution / 8 / resolution) * (60000 / 120),
          type: 3, // Tom
          flags: 0,
        });
      }

      const chart = createSyntheticChart(notes);
      const fills = extractFills(chart, chart.trackData[0] as Track);

      expect(fills.length).toBeGreaterThan(0);

      if (fills.length > 0) {
        const fill = fills[0];

        expect(fill.songId).toBe('Test Song');
        expect(fill.startMs).toBeGreaterThanOrEqual(0);
        expect(fill.endMs).toBeGreaterThan(fill.startMs);
      }
    });

    it('should not detect fills in consistent groove', () => {
      // Create consistent groove pattern
      const notes: NoteEvent[] = [];
      const resolution = 192;

      // Consistent pattern for 8 bars
      for (let bar = 0; bar < 8; bar++) {
        const barStart = bar * resolution * 4;

        // Simple rock beat
        notes.push({
          tick: barStart,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 0, // Kick
          flags: 0,
        });

        notes.push({
          tick: barStart + resolution,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 1, // Snare
          flags: 0,
        });

        notes.push({
          tick: barStart + resolution * 2,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 0, // Kick
          flags: 0,
        });

        notes.push({
          tick: barStart + resolution * 3,
          msTime: 0,
          length: resolution / 4,
          msLength: 0,
          type: 1, // Snare
          flags: 0,
        });
      }

      const chart = createSyntheticChart(notes);
      const fills = extractFills(chart);

      // Should detect very few or no fills in consistent groove
      expect(fills.length).toBeLessThanOrEqual(1);
    });

    it('should handle custom configuration', () => {
      const notes: NoteEvent[] = [];
      const resolution = 192;

      // Create some pattern
      for (let i = 0; i < 32; i++) {
        notes.push({
          tick: i * (resolution / 4),
          msTime: 0,
          length: resolution / 8,
          msLength: 0,
          type: [0, 1, 2, 3][i % 4] as NoteType, // Vary note types using valid NoteType values
          flags: 0,
        });
      }

      const chart = createSyntheticChart(notes);

      // Use more sensitive thresholds
      const customConfig = {
        ...defaultConfig,
        thresholds: {
          ...defaultConfig.thresholds,
          densityZ: 0.5, // Lower threshold
          minBeats: 0.5, // Shorter minimum
        },
      };

      const fills = extractFills(chart, customConfig);
      expect(Array.isArray(fills)).toBe(true);
    });

    it('should validate input chart', () => {
      expect(() => {
        extractFills(null as unknown as ParsedChart);
      }).toThrow();

      expect(() => {
        extractFills({resolution: 0} as unknown as ParsedChart);
      }).toThrow();

      expect(() => {
        extractFills({resolution: 192, tempos: []} as unknown as ParsedChart);
      }).toThrow();

      expect(() => {
        extractFills({
          resolution: 192,
          tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
          trackData: null as unknown as Track[],
        } as unknown as ParsedChart);
      }).toThrow();
    });
  });

  describe('validateFillSegments', () => {
    it('should validate fill segments', () => {
      const validFills = [
        {
          songId: 'test',
          startTick: 0,
          endTick: 100,
          startMs: 0,
          endMs: 1000,
          measureStartTick: 0,
          measureEndTick: 192 * 4,
          measureStartMs: 0,
          measureEndMs: 2000,
          measureNumber: 1,
          densityZ: 1.5,
          tomRatioJump: 2.0,
          hatDropout: 0.5,
          kickDrop: 0.3,
          ioiStdZ: 1.2,
          ngramNovelty: 0.8,
          samePadBurst: false,
          crashResolve: true,
          grooveDist: 2.5,
        },
      ];

      const result = validateFillSegments(validFills);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect invalid segments', () => {
      const invalidFills = [
        {
          songId: 'test',
          startTick: 100, // Start after end
          endTick: 50,
          startMs: 1000, // Start after end
          endMs: 500,
          measureStartTick: 0,
          measureEndTick: 100,
          measureStartMs: 0,
          measureEndMs: 1000,
          measureNumber: 1,
          densityZ: NaN, // Invalid value
          tomRatioJump: 2.0,
          hatDropout: 0.5,
          kickDrop: 0.3,
          ioiStdZ: 1.2,
          ngramNovelty: 0.8,
          samePadBurst: false,
          crashResolve: true,
          grooveDist: 2.5,
        },
      ];

      const result = validateFillSegments(invalidFills);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect overlapping segments', () => {
      const overlappingFills = [
        {
          songId: 'test',
          startTick: 0,
          endTick: 100,
          startMs: 0,
          endMs: 1000,
          measureStartTick: 0,
          measureEndTick: 100,
          measureStartMs: 0,
          measureEndMs: 1000,
          measureNumber: 1,
          densityZ: 1.5,
          tomRatioJump: 2.0,
          hatDropout: 0.5,
          kickDrop: 0.3,
          ioiStdZ: 1.2,
          ngramNovelty: 0.8,
          samePadBurst: false,
          crashResolve: true,
          grooveDist: 2.5,
        },
        {
          songId: 'test',
          startTick: 50, // Overlaps with previous
          endTick: 150,
          startMs: 500,
          endMs: 1500,
          measureStartTick: 0,
          measureEndTick: 150,
          measureStartMs: 0,
          measureEndMs: 1500,
          measureNumber: 1,
          densityZ: 1.5,
          tomRatioJump: 2.0,
          hatDropout: 0.5,
          kickDrop: 0.3,
          ioiStdZ: 1.2,
          ngramNovelty: 0.8,
          samePadBurst: false,
          crashResolve: true,
          grooveDist: 2.5,
        },
      ];

      const result = validateFillSegments(overlappingFills);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('overlaps'))).toBe(true);
    });
  });

  describe('createExtractionSummary', () => {
    it('should create extraction summary', () => {
      const notes: NoteEvent[] = [
        {
          tick: 0,
          msTime: 0,
          length: 48,
          msLength: 125,
          type: 0 as NoteType,
          flags: 0,
        },
        {
          tick: 192,
          msTime: 500,
          length: 48,
          msLength: 125,
          type: 1 as NoteType,
          flags: 0,
        },
      ];

      const chart = createSyntheticChart(notes, 'Test Song');
      const fills = [
        {
          songId: 'Test Song',
          startTick: 0,
          endTick: 192,
          startMs: 0,
          endMs: 500,
          measureStartTick: 0,
          measureEndTick: 192 * 4,
          measureStartMs: 0,
          measureEndMs: 2000,
          measureNumber: 1,
          densityZ: 1.5,
          tomRatioJump: 2.0,
          hatDropout: 0.5,
          kickDrop: 0.3,
          ioiStdZ: 1.2,
          ngramNovelty: 0.8,
          samePadBurst: false,
          crashResolve: true,
          grooveDist: 2.5,
        },
      ];

      const summary = createExtractionSummary(
        chart,
        chart.trackData[0],
        fills,
        defaultConfig,
      );

      expect(summary.songInfo.name).toBe('Test Song');
      expect(summary.songInfo.noteCount).toBe(2);
      expect(summary.detectionInfo.fillCount).toBe(1);
      expect(summary.detectionInfo.totalFillDuration).toBe(0.5);
      expect(summary.configUsed).toEqual(defaultConfig);
    });
  });

  describe('tempo handling', () => {
    it('should handle tempo changes', () => {
      const notes: NoteEvent[] = [
        {
          tick: 0,
          msTime: 0,
          length: 48,
          msLength: 0,
          type: 0 as NoteType,
          flags: 0,
        },
        {
          tick: 384, // After tempo change
          msTime: 0,
          length: 48,
          msLength: 0,
          type: 1 as NoteType,
          flags: 0,
        },
      ];

      const tempos: TempoEvent[] = [
        {tick: 0, beatsPerMinute: 120, msTime: 0},
        {tick: 192, beatsPerMinute: 140, msTime: 1000}, // Tempo change
      ];

      const chart = createSyntheticChart(notes, 'Tempo Test', 192, tempos);
      const fills = extractFills(chart);

      // Should not throw and should handle tempo changes
      expect(Array.isArray(fills)).toBe(true);
    });

    it('should reject invalid tempos', () => {
      const notes: NoteEvent[] = [
        {
          tick: 0,
          msTime: 0,
          length: 48,
          msLength: 0,
          type: 0 as NoteType,
          flags: 0,
        },
      ];

      const invalidTempos: TempoEvent[] = [
        {tick: 0, beatsPerMinute: -120, msTime: 0}, // Invalid BPM
      ];

      const chart = createSyntheticChart(
        notes,
        'Invalid Tempo',
        192,
        invalidTempos,
      );

      expect(() => {
        extractFills(chart);
      }).toThrow();
    });
  });

  describe('difficulty handling', () => {
    it('should handle different difficulties', () => {
      const notes: NoteEvent[] = [
        {
          tick: 0,
          msTime: 0,
          length: 48,
          msLength: 0,
          type: 0 as NoteType,
          flags: 0,
        },
      ];

      const chart = createSyntheticChart(notes);

      // Add hard difficulty track
      chart.trackData.push({
        instrument: 'drums',
        difficulty: 'hard',
        noteEventGroups: [
          [
            {
              ...notes[0],
              msTime: 0,
              msLength: 0,
              type: 0 as NoteType,
            },
          ],
        ],
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
      });

      const fills = extractFills(chart, {difficulty: 'hard'});
      expect(Array.isArray(fills)).toBe(true);
    });

    it('should throw error for missing difficulty', () => {
      const chart = createSyntheticChart([]);

      expect(() => {
        extractFills(chart, {difficulty: 'medium'});
      }).toThrow(DrumTrackNotFoundError);
    });
  });

  describe('When I Come Around fixture test', () => {
    xit('should detect fills on expected measures', async () => {
      const fixtureData = await import(
        './__fixtures__/When I Come Around - Green Day.json'
      );
      const chart: ParsedChart = fixtureData.default as unknown as ParsedChart;
      const drumTrack = chart.trackData.find(
        track => track.instrument === 'drums' && track.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found in fixture');

      const fills = extractFills(chart, drumTrack);

      const measuresDetected = fills.map(f => f.measureNumber);
      console.log('Detected measures:', measuresDetected);
      console.log(
        'Fills summary:',
        fills.map(f => ({
          m: f.measureNumber,
          st: f.startTick,
          et: f.endTick,
          mst: f.startMs,
          met: f.endMs,
        })),
      );
      const expectedAtLeast = [24, 26, 28, 48, 50, 52, 60, 62, 64];

      // Each expected measure should appear at least once
      expectedAtLeast.forEach(m => {
        expect(measuresDetected).toContain(m);
      });

      // Sanity: measure starts should not be after fill starts
      fills.forEach(f => {
        expect(f.measureStartMs).toBeLessThanOrEqual(f.startMs);
      });
    });
  });

  describe('Downfall Of Us All - A Day To Remember fixture test', () => {
    // Expected fills on at least 13, 17, 21, 26-27 (this is a single fill that is a quarter note and full measure), 31, 45, 49 & 50, 57, 63, 77, 93, 101, 104, 113
    xit('should detect fills on expected measures', async () => {
      const chart: ParsedChart = require('./__fixtures__/Downfall Of Us All - A Day To Remember.json');
      const drumTrack = chart.trackData.find(
        track => track.instrument === 'drums' && track.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found in fixture');

      const fills = extractFills(chart, drumTrack);
      const measuresDetected = fills.map(f => f.measureNumber);
      console.log('Downfall measures detected:', measuresDetected);

      const expectedAtLeast = [
        14, 18, 22, 27, 28, 32, 46, 50, 51, 58, 64, 78, 94, 102, 105, 114,
      ];
      expectedAtLeast.forEach(m => expect(measuresDetected).toContain(m));

      // Optional candidate that may or may not be detected depending on config
      const maybe = 89;
      // no assertion, but log if missing
      if (!measuresDetected.includes(maybe)) {
        console.warn('Optional expected measure not detected:', maybe);
      }

      // Sanity checks
      fills.forEach(f => {
        expect(f.measureStartMs).toBeLessThanOrEqual(f.startMs);
      });
    });

    it('should not detect fills in the repeating intro section (measures 1-13, 1-based)', async () => {
      const chart: ParsedChart = require('./__fixtures__/Downfall Of Us All - A Day To Remember.json');
      const drumTrack = chart.trackData.find(
        track => track.instrument === 'drums' && track.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found in fixture');

      const fills = extractFills(chart, drumTrack);
      const measuresDetected = fills.map(f => f.measureNumber);

      // Assert no fills are detected in measures 1..13 inclusive (1-based indexing)
      for (let m = 1; m <= 13; m++) {
        expect(measuresDetected).not.toContain(m);
      }
    });
  });

  describe('Unravelling by Muse fixture test', () => {
    it('should not mark repeating groove bars as fills', async () => {
      const chart: ParsedChart = require('./__fixtures__/Unravelling by Muse.json');
      const drumTrack = chart.trackData.find(
        track => track.instrument === 'drums' && track.difficulty === 'expert',
      );
      if (!drumTrack) throw new Error('No expert drum track found in fixture');

      const fills = extractFills(chart, drumTrack);
      const measuresDetected = fills.map(f => f.measureNumber);
      console.log('Unravelling measures detected:', measuresDetected);

      // These are part of the main beat and repeated many times; they should not be fills
      const repeatedGrooveMeasures = [8, 10, 12, 14, 16, 20];
      repeatedGrooveMeasures.forEach(m => {
        expect(measuresDetected).not.toContain(m);
      });
    });
  });
});
