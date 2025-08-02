/**
 * Integration tests for the complete fill detection pipeline
 */

import { extractFills, defaultConfig, validateFillSegments, createExtractionSummary } from '../index.js';
import { ParsedChart, NoteEvent, TempoEvent, TrackData, DrumTrackNotFoundError } from '../types.js';

// Helper function to create synthetic chart data
function createSyntheticChart(
  noteEvents: NoteEvent[],
  name = 'Test Song',
  resolution = 192,
  tempos: TempoEvent[] = [{ tick: 0, bpm: 120, msTime: 0 }]
): ParsedChart {
  // Calculate msTime for notes based on tempo
  const notesWithTime = noteEvents.map(note => ({
    ...note,
    msTime: (note.tick / resolution) * (60000 / 120), // 120 BPM assumption
    msLength: (note.length / resolution) * (60000 / 120),
  }));

  const drumTrack: TrackData = {
    instrument: 'drums',
    difficulty: 'expert',
    noteEventGroups: [notesWithTime],
  };

  return {
    name,
    resolution,
    tempos,
    trackData: [drumTrack],
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
        tempos: [{ tick: 0, bpm: 120, msTime: 0 }],
        trackData: [], // No drum track
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
      for (let i = 0; i < 16; i++) { // 16th notes
        notes.push({
          tick: fillStart + i * (resolution / 4),
          msTime: 0,
          length: resolution / 8,
          msLength: 0,
          type: 3, // Tom
          flags: 0,
        });
      }

      const chart = createSyntheticChart(notes);
      const fills = extractFills(chart);

      expect(fills.length).toBeGreaterThan(0);
      
      if (fills.length > 0) {
        const fill = fills[0];
        expect(fill.startTick).toBeGreaterThanOrEqual(fillStart);
        expect(fill.endTick).toBeLessThanOrEqual(fillStart + resolution * 4);
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
          type: i % 4, // Vary note types
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
        extractFills(null as any);
      }).toThrow('ParsedChart is required');

      expect(() => {
        extractFills({ resolution: 0 } as any);
      }).toThrow('Invalid chart');

      expect(() => {
        extractFills({ resolution: 192, tempos: [] } as any);
      }).toThrow('at least one tempo');

      expect(() => {
        extractFills({ 
          resolution: 192, 
          tempos: [{ tick: 0, bpm: 120, msTime: 0 }],
          trackData: null
        } as any);
      }).toThrow('trackData array');
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
          type: 0,
          flags: 0,
        },
        {
          tick: 192,
          msTime: 500,
          length: 48,
          msLength: 125,
          type: 1,
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

      const summary = createExtractionSummary(chart, fills, defaultConfig);

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
          type: 0,
          flags: 0,
        },
        {
          tick: 384, // After tempo change
          msTime: 0,
          length: 48,
          msLength: 0,
          type: 1,
          flags: 0,
        },
      ];

      const tempos: TempoEvent[] = [
        { tick: 0, bpm: 120, msTime: 0 },
        { tick: 192, bpm: 140, msTime: 1000 }, // Tempo change
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
          type: 0,
          flags: 0,
        },
      ];

      const invalidTempos: TempoEvent[] = [
        { tick: 0, bpm: -120, msTime: 0 }, // Invalid BPM
      ];

      const chart = createSyntheticChart(notes, 'Invalid Tempo', 192, invalidTempos);

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
          type: 0,
          flags: 0,
        },
      ];

      const chart = createSyntheticChart(notes);
      
      // Add hard difficulty track
      chart.trackData.push({
        instrument: 'drums',
        difficulty: 'hard',
        noteEventGroups: [[{
          ...notes[0],
          msTime: 0,
          msLength: 0,
        }]],
      });

      const fills = extractFills(chart, { difficulty: 'hard' });
      expect(Array.isArray(fills)).toBe(true);
    });

    it('should throw error for missing difficulty', () => {
      const chart = createSyntheticChart([]);
      
      expect(() => {
        extractFills(chart, { difficulty: 'medium' });
      }).toThrow(DrumTrackNotFoundError);
    });
  });
});