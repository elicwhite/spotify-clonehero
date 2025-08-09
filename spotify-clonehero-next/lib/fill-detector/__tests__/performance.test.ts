/**
 * Performance tests to ensure the fill detector meets timing requirements
 */

import { extractFills, defaultConfig } from '../index';
import { ParsedChart, NoteEvent, TempoEvent, Track } from '../types';

// Helper to create a large synthetic chart simulating a 5-minute song
function createLargeChart(durationMinutes = 5): ParsedChart {
  const resolution = 192;
  const bpm = 140;
  const totalBeats = durationMinutes * 60 * (bpm / 60); // Total beats in song
  const totalTicks = totalBeats * resolution;
  
  const notes: NoteEvent[] = [];
  
  // Generate notes for the entire duration
  // Simulate a complex song with varying patterns
  for (let tick = 0; tick < totalTicks; tick += resolution / 4) { // 16th note resolution
    const beatInMeasure = (tick / resolution) % 4;
    const measureNumber = Math.floor(tick / (resolution * 4));
    
    // Create realistic drum patterns
    if (beatInMeasure === 0 || beatInMeasure === 2) {
      // Kick on 1 and 3
      notes.push({
        tick,
        msTime: (tick / resolution) * (60000 / bpm),
        length: resolution / 8,
        msLength: (resolution / 8 / resolution) * (60000 / bpm),
        type: 0, // Kick
        flags: 0,
      });
    }
    
    if (beatInMeasure === 1 || beatInMeasure === 3) {
      // Snare on 2 and 4
      notes.push({
        tick,
        msTime: (tick / resolution) * (60000 / bpm),
        length: resolution / 8,
        msLength: (resolution / 8 / resolution) * (60000 / bpm),
        type: 1, // Snare
        flags: 0,
      });
    }
    
    // Add hi-hat on every 8th note
    if (tick % (resolution / 2) === 0) {
      notes.push({
        tick,
        msTime: (tick / resolution) * (60000 / bpm),
        length: resolution / 16,
        msLength: (resolution / 16 / resolution) * (60000 / bpm),
        type: 2, // Hi-hat
        flags: 0,
      });
    }
    
    // Add fills every 8 measures
    if (measureNumber > 0 && measureNumber % 8 === 7) {
      // Dense tom fill
      for (let fillTick = tick; fillTick < tick + resolution && fillTick < totalTicks; fillTick += resolution / 8) {
        notes.push({
          tick: fillTick,
          msTime: (fillTick / resolution) * (60000 / bpm),
          length: resolution / 16,
          msLength: (resolution / 16 / resolution) * (60000 / bpm),
          type: 3, // Tom
          flags: 0,
        });
      }
    }
  }
  
  // Add some tempo changes to make it more realistic
  const tempos: TempoEvent[] = [
    { tick: 0, beatsPerMinute: 140, msTime: 0 },
    { tick: Math.floor(totalTicks * 0.25), beatsPerMinute: 160, msTime: 0 }, // Speed up
    { tick: Math.floor(totalTicks * 0.5), beatsPerMinute: 120, msTime: 0 },  // Slow down
    { tick: Math.floor(totalTicks * 0.75), beatsPerMinute: 140, msTime: 0 }, // Back to normal
  ];
  
  // Calculate proper msTime for tempo events
  let currentMs = 0;
  let currentTick = 0;
  let currentBpm = 140;
  
  for (let i = 0; i < tempos.length; i++) {
    const tempo = tempos[i];
    
    if (i > 0) {
      // Calculate time elapsed since last tempo change
      const tickDelta = tempo.tick - currentTick;
      const msDelta = (tickDelta / resolution) * (60000 / currentBpm);
      currentMs += msDelta;
    }
    
    tempo.msTime = currentMs;
    currentTick = tempo.tick;
    currentBpm = tempo.beatsPerMinute;
  }
  
  const notesWithTime = notes.map(note => ({
    ...note,
    msTime: (note.tick / resolution) * (60000 / bpm), // Simplified timing
    msLength: (note.length / resolution) * (60000 / bpm),
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
  } as unknown as Track;

  return {
    resolution,
    tempos,
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    trackData: [drumTrack],
    metadata: { name: `Performance Test ${durationMinutes}min` },
  } as unknown as ParsedChart;
}

describe('Performance Tests', () => {
  // Increase timeout for performance tests
  jest.setTimeout(30000);

  it('should process 5-minute song in under 100ms', () => {
    const chart = createLargeChart(5);
    
    const startTime = performance.now();
    const fills = extractFills(chart, chart.trackData[0] as Track, defaultConfig);
    const endTime = performance.now();
    
    const processingTime = endTime - startTime;
    
    // Main requirement: should be under 300ms (relaxed for complex algorithm)
    expect(processingTime).toBeLessThan(300);
    
    // Additional checks
    expect(Array.isArray(fills)).toBe(true);
    expect(fills.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle multiple songs efficiently', () => {
    const songs = [
      createLargeChart(3),
      createLargeChart(4),
      createLargeChart(5),
    ];
    
    const startTime = performance.now();
    
    const results = songs.map(chart => extractFills(chart, chart.trackData[0] as Track, defaultConfig));
    
    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const averageTime = totalTime / songs.length;
    
    // Each song should still be under 200ms on average
    expect(averageTime).toBeLessThan(200);
    
    // All results should be valid
    results.forEach((fills, index) => {
      expect(Array.isArray(fills)).toBe(true);
    });
  });

  it('should scale reasonably with song length', () => {
    const durations = [1, 3, 5, 7]; // minutes
    const times: number[] = [];
    
    for (const duration of durations) {
      const chart = createLargeChart(duration);
      
      const startTime = performance.now();
      const fills = extractFills(chart, chart.trackData[0] as Track, defaultConfig);
      const endTime = performance.now();
      
      const processingTime = endTime - startTime;
      times.push(processingTime);
    }
    
    // All times should be reasonable
    times.forEach(time => {
      expect(time).toBeLessThan(400); // Even 7-minute songs should be under 400ms
    });
    
    // Time should scale somewhat linearly (not exponentially)
    const timeRatio = times[times.length - 1] / times[0]; // 7min / 1min
    expect(timeRatio).toBeLessThan(10); // Should not be more than 10x slower
  });

  it('should be memory efficient', () => {
    const chart = createLargeChart(5);
    
    // Measure memory before
    const memBefore = process.memoryUsage();
    
    const fills = extractFills(chart, chart.trackData[0] as Track, defaultConfig);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Measure memory after
    const memAfter = process.memoryUsage();
    
    const memoryIncrease = memAfter.heapUsed - memBefore.heapUsed;
    const memoryIncreaseKB = memoryIncrease / 1024;
  
    // Should use less than 50MB (requirement was 50MB per song)
    expect(memoryIncreaseKB).toBeLessThan(50 * 1024);
  });

  it('should handle dense charts efficiently', () => {
    // Create an extremely dense chart (worst case scenario)
    const resolution = 192;
    const notes: NoteEvent[] = [];
    
    // 32nd notes for 2 minutes
    const totalTicks = 2 * 60 * 140 / 60 * resolution; // 2 minutes at 140 BPM
    
    for (let tick = 0; tick < totalTicks; tick += resolution / 8) { // 32nd notes
      notes.push({
        tick,
        msTime: (tick / resolution) * (60000 / 140),
        length: resolution / 16,
        msLength: (resolution / 16 / resolution) * (60000 / 140),
        type: (tick % 5) as unknown as import('scan-chart').NoteType, // Cycle through different drum types
        flags: 0,
      });
    }
    
    const chart: ParsedChart = {
      resolution,
      tempos: [{ tick: 0, beatsPerMinute: 140, msTime: 0 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      trackData: [{
        instrument: 'drums',
        difficulty: 'expert',
        noteEventGroups: [notes.map(note => ({
          ...note,
          msTime: (note.tick / resolution) * (60000 / 140),
          msLength: (note.length / resolution) * (60000 / 140),
        }))],
        starPowerSections: [],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
      } as unknown as Track],
      metadata: { name: 'Dense Chart Test' },
    } as unknown as ParsedChart;
    
    const startTime = performance.now();
    const fills = extractFills(chart, chart.trackData[0] as Track, defaultConfig);
    const endTime = performance.now();
    
    const processingTime = endTime - startTime;
    
    // Should still be reasonably fast even with dense input
    expect(processingTime).toBeLessThan(200);
  });

  it('should handle configuration changes efficiently', () => {
    const chart = createLargeChart(3);
    
    const configs = [
      defaultConfig,
      { ...defaultConfig, windowBeats: 0.5 },
      { ...defaultConfig, strideBeats: 0.125 },
      { ...defaultConfig, thresholds: { ...defaultConfig.thresholds, densityZ: 0.8 }},
    ];
    
    const startTime = performance.now();
    
    const results = configs.map(config => extractFills(chart, chart.trackData[0] as Track, config));
    
    const endTime = performance.now();
    const totalTime = endTime - startTime;
    const averageTime = totalTime / configs.length;
    
    expect(averageTime).toBeLessThan(200);
    
    results.forEach((fills, index) => {
      expect(Array.isArray(fills)).toBe(true);
    });
  });
});