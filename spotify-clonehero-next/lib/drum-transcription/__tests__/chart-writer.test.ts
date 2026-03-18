/**
 * Round-trip tests for the .chart file writer.
 *
 * Strategy: serialize a ChartDocument to a .chart string, then parse it back
 * with scan-chart's parseChartFile(), and verify the data matches.
 */

import {describe, test, expect} from '@jest/globals';
import {parseChartFile, noteTypes, noteFlags} from '@eliwhite/scan-chart';

import {serializeChart} from '../chart-io/writer';
import {drumNoteTypeToScanChartType} from '../chart-io/note-mapping';
import {buildTimedTempos, msToTick, snapToGrid} from '../chart-io/timing';
import {validateChart} from '../chart-io/validate';
import type {
  ChartDocument,
  DrumNote,
  DrumNoteType,
  TrackData,
} from '../chart-io/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a serialized chart string through scan-chart with pro_drums enabled. */
function parseBack(chartText: string) {
  const bytes = new TextEncoder().encode(chartText);
  return parseChartFile(bytes, 'chart', {pro_drums: true});
}

/** Build a minimal valid ChartDocument with sensible defaults. */
function makeDoc(overrides: Partial<ChartDocument> = {}): ChartDocument {
  return {
    resolution: 480,
    metadata: {name: 'Test', artist: 'Test', resolution: 480},
    tempos: [{tick: 0, bpm: 120}],
    timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
    sections: [],
    endEvents: [],
    tracks: [],
    ...overrides,
  };
}

/** Shorthand for creating a DrumNote. */
function note(
  tick: number,
  type: DrumNoteType,
  flags: DrumNote['flags'] = {},
  length = 0,
): DrumNote {
  return {tick, type, length, flags};
}

/** Build an ExpertDrums track with the given notes. */
function expertTrack(
  notes: DrumNote[],
  extras: Partial<TrackData> = {},
): TrackData {
  return {
    instrument: 'drums',
    difficulty: 'expert',
    notes,
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chart-writer round-trip', () => {
  test('1. minimal chart — single note, single tempo, single time signature', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(480, 'red'),
        ]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    expect(parsed.resolution).toBe(480);
    expect(parsed.trackData).toHaveLength(1);
    expect(parsed.trackData[0].noteEventGroups).toHaveLength(2);

    // First group: kick at tick 0
    const g0 = parsed.trackData[0].noteEventGroups[0];
    expect(g0).toHaveLength(1);
    expect(g0[0].tick).toBe(0);
    expect(g0[0].type).toBe(noteTypes.kick);

    // Second group: red at tick 480
    const g1 = parsed.trackData[0].noteEventGroups[1];
    expect(g1).toHaveLength(1);
    expect(g1[0].tick).toBe(480);
    expect(g1[0].type).toBe(noteTypes.redDrum);
  });

  test('2. multiple notes at same tick (chord) — kick + hi-hat', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(0, 'yellow', {cymbal: true}),
        ]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    expect(parsed.trackData[0].noteEventGroups).toHaveLength(1);
    const group = parsed.trackData[0].noteEventGroups[0];
    expect(group).toHaveLength(2);

    const kick = group.find(n => n.type === noteTypes.kick);
    const yellow = group.find(n => n.type === noteTypes.yellowDrum);
    expect(kick).toBeDefined();
    expect(yellow).toBeDefined();
    expect(yellow!.flags & noteFlags.cymbal).toBeTruthy();
  });

  test('3. pro drums — mix of toms and cymbals', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          // Yellow tom (no cymbal flag)
          note(0, 'yellow'),
          // Yellow cymbal (hi-hat)
          note(480, 'yellow', {cymbal: true}),
          // Blue tom
          note(960, 'blue'),
          // Blue cymbal (ride)
          note(1440, 'blue', {cymbal: true}),
          // Green tom
          note(1920, 'green'),
          // Green cymbal (crash)
          note(2400, 'green', {cymbal: true}),
          // Red is always tom
          note(2880, 'red'),
        ]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    const groups = parsed.trackData[0].noteEventGroups;
    expect(groups).toHaveLength(7);

    // Yellow tom: should have tom flag, NOT cymbal
    expect(groups[0][0].type).toBe(noteTypes.yellowDrum);
    expect(groups[0][0].flags & noteFlags.tom).toBeTruthy();
    expect(groups[0][0].flags & noteFlags.cymbal).toBeFalsy();

    // Yellow cymbal: should have cymbal flag
    expect(groups[1][0].type).toBe(noteTypes.yellowDrum);
    expect(groups[1][0].flags & noteFlags.cymbal).toBeTruthy();

    // Blue tom
    expect(groups[2][0].type).toBe(noteTypes.blueDrum);
    expect(groups[2][0].flags & noteFlags.tom).toBeTruthy();

    // Blue cymbal
    expect(groups[3][0].type).toBe(noteTypes.blueDrum);
    expect(groups[3][0].flags & noteFlags.cymbal).toBeTruthy();

    // Green tom
    expect(groups[4][0].type).toBe(noteTypes.greenDrum);
    expect(groups[4][0].flags & noteFlags.tom).toBeTruthy();

    // Green cymbal
    expect(groups[5][0].type).toBe(noteTypes.greenDrum);
    expect(groups[5][0].flags & noteFlags.cymbal).toBeTruthy();

    // Red is always tom
    expect(groups[6][0].type).toBe(noteTypes.redDrum);
    expect(groups[6][0].flags & noteFlags.tom).toBeTruthy();
  });

  test('4. tempo changes — multiple BPM changes mid-song', () => {
    const doc = makeDoc({
      tempos: [
        {tick: 0, bpm: 120},
        {tick: 1920, bpm: 140},
        {tick: 3840, bpm: 100},
      ],
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(1920, 'red'),
          note(3840, 'kick'),
        ]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    expect(parsed.tempos).toHaveLength(3);
    expect(parsed.tempos[0].tick).toBe(0);
    expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(120, 1);
    expect(parsed.tempos[1].tick).toBe(1920);
    expect(parsed.tempos[1].beatsPerMinute).toBeCloseTo(140, 1);
    expect(parsed.tempos[2].tick).toBe(3840);
    expect(parsed.tempos[2].beatsPerMinute).toBeCloseTo(100, 1);
  });

  test('5. time signature changes — 4/4 to 3/4 to 6/8', () => {
    const doc = makeDoc({
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 1920, numerator: 3, denominator: 4},
        {tick: 3360, numerator: 6, denominator: 8},
      ],
      tracks: [
        expertTrack([note(0, 'kick')]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    expect(parsed.timeSignatures).toHaveLength(3);
    expect(parsed.timeSignatures[0]).toMatchObject({tick: 0, numerator: 4, denominator: 4});
    expect(parsed.timeSignatures[1]).toMatchObject({tick: 1920, numerator: 3, denominator: 4});
    expect(parsed.timeSignatures[2]).toMatchObject({tick: 3360, numerator: 6, denominator: 8});
  });

  test('6. fractional BPM — 145.5 BPM (millibeats = 145500)', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: 145.5}],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const text = serializeChart(doc);
    // Verify the raw text contains the correct millibeats
    expect(text).toContain('B 145500');

    const parsed = parseBack(text);
    expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(145.5, 1);
  });

  test('7. double kick — note 0 + note 32', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'kick', {doubleKick: true}),
          note(480, 'kick'), // normal kick for comparison
        ]),
      ],
    });

    const text = serializeChart(doc);
    // Verify both N 0 and N 32 appear for the double kick
    expect(text).toContain('0 = N 0 0');
    expect(text).toContain('0 = N 32 0');

    const parsed = parseBack(text);
    const groups = parsed.trackData[0].noteEventGroups;
    expect(groups).toHaveLength(2);

    // Double kick should have the doubleKick flag
    const dkGroup = groups[0];
    expect(dkGroup[0].type).toBe(noteTypes.kick);
    expect(dkGroup[0].flags & noteFlags.doubleKick).toBeTruthy();

    // Normal kick should NOT have the doubleKick flag
    const normalGroup = groups[1];
    expect(normalGroup[0].type).toBe(noteTypes.kick);
    expect(normalGroup[0].flags & noteFlags.doubleKick).toBeFalsy();
  });

  test('8. accent and ghost flags — all modifier note numbers', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'red', {accent: true}),
          note(480, 'yellow', {accent: true}),
          note(960, 'blue', {ghost: true}),
          note(1440, 'green', {ghost: true}),
        ]),
      ],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    const groups = parsed.trackData[0].noteEventGroups;
    expect(groups).toHaveLength(4);

    // Red accent
    expect(groups[0][0].flags & noteFlags.accent).toBeTruthy();
    // Yellow accent
    expect(groups[1][0].flags & noteFlags.accent).toBeTruthy();
    // Blue ghost
    expect(groups[2][0].flags & noteFlags.ghost).toBeTruthy();
    // Green ghost
    expect(groups[3][0].flags & noteFlags.ghost).toBeTruthy();
  });

  test('9. star power and activation lanes — S events round-trip', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack(
          [
            note(0, 'kick'),
            note(480, 'red'),
            note(960, 'kick'),
            note(1440, 'red'),
          ],
          {
            starPower: [{tick: 0, length: 960}],
            activationLanes: [{tick: 1440, length: 480}],
          },
        ),
      ],
    });

    const text = serializeChart(doc);
    // Verify S 2 (star power) and S 64 (activation lane) are in the text
    expect(text).toContain('S 2 960');
    expect(text).toContain('S 64 480');

    const parsed = parseBack(text);

    expect(parsed.trackData[0].starPowerSections).toHaveLength(1);
    expect(parsed.trackData[0].starPowerSections[0].tick).toBe(0);
    expect(parsed.trackData[0].starPowerSections[0].length).toBe(960);

    expect(parsed.trackData[0].drumFreestyleSections).toHaveLength(1);
    expect(parsed.trackData[0].drumFreestyleSections[0].tick).toBe(1440);
    expect(parsed.trackData[0].drumFreestyleSections[0].length).toBe(480);
  });

  test('10. section markers — multiple sections with spaces', () => {
    const doc = makeDoc({
      sections: [
        {tick: 0, name: 'Intro'},
        {tick: 1920, name: 'Verse 1'},
        {tick: 3840, name: 'Chorus'},
        {tick: 7680, name: 'Guitar Solo'},
      ],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    expect(parsed.sections).toHaveLength(4);
    expect(parsed.sections[0]).toMatchObject({tick: 0, name: 'Intro'});
    expect(parsed.sections[1]).toMatchObject({tick: 1920, name: 'Verse 1'});
    expect(parsed.sections[2]).toMatchObject({tick: 3840, name: 'Chorus'});
    expect(parsed.sections[3]).toMatchObject({tick: 7680, name: 'Guitar Solo'});
  });

  test('11. full song simulation — realistic chart with ~100 notes, tempo changes, sections', () => {
    // Build a realistic rock beat pattern
    const drumNotes: DrumNote[] = [];
    const resolution = 480;

    // 16 bars of basic rock beat at various tempos
    for (let bar = 0; bar < 16; bar++) {
      const barStart = bar * resolution * 4; // 4 beats per bar
      for (let beat = 0; beat < 4; beat++) {
        const beatTick = barStart + beat * resolution;

        // Kick on beats 1 and 3
        if (beat === 0 || beat === 2) {
          drumNotes.push(note(beatTick, 'kick'));
        }

        // Snare on beats 2 and 4
        if (beat === 1 || beat === 3) {
          drumNotes.push(note(beatTick, 'red'));
        }

        // Hi-hat on every 8th note
        drumNotes.push(note(beatTick, 'yellow', {cymbal: true}));
        drumNotes.push(note(beatTick + resolution / 2, 'yellow', {cymbal: true}));
      }

      // Crash on bar 1, 5, 9, 13
      if (bar % 4 === 0) {
        drumNotes.push(note(barStart, 'green', {cymbal: true}));
      }
    }

    const doc = makeDoc({
      metadata: {
        name: 'Rock Song',
        artist: 'Test Band',
        album: 'Test Album',
        genre: 'rock',
        year: '2024',
        charter: 'AutoChart',
        resolution: 480,
        musicStream: 'song.ogg',
        drumStream: 'drums.ogg',
      },
      tempos: [
        {tick: 0, bpm: 120},
        {tick: 7680, bpm: 130},
        {tick: 15360, bpm: 120},
      ],
      timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      sections: [
        {tick: 0, name: 'Intro'},
        {tick: 7680, name: 'Verse'},
        {tick: 15360, name: 'Chorus'},
        {tick: 23040, name: 'Outro'},
      ],
      endEvents: [{tick: 30720}],
      tracks: [expertTrack(drumNotes)],
    });

    const text = serializeChart(doc);
    const parsed = parseBack(text);

    // Verify structure
    expect(parsed.resolution).toBe(480);
    expect(parsed.tempos).toHaveLength(3);
    expect(parsed.timeSignatures).toHaveLength(1);
    expect(parsed.sections).toHaveLength(4);
    expect(parsed.endEvents).toHaveLength(1);
    expect(parsed.endEvents[0].tick).toBe(30720);
    expect(parsed.trackData).toHaveLength(1);

    // Verify we got a reasonable number of note groups
    // (some notes at the same tick are grouped together)
    expect(parsed.trackData[0].noteEventGroups.length).toBeGreaterThan(50);
  });

  test('12. ms-to-tick-to-ms round-trip — verify timing accuracy', () => {
    const tempos = [
      {tick: 0, bpm: 120},
      {tick: 1920, bpm: 140},
    ];
    const resolution = 480;
    const timedTempos = buildTimedTempos(tempos, resolution);

    // Test a set of ms timestamps and convert them to ticks and back
    const testTimesMs = [0, 250, 500, 1000, 2000, 3000, 4000, 5000];

    for (const originalMs of testTimesMs) {
      const tick = msToTick(originalMs, timedTempos, resolution);

      // Now compute ms from the tick using the same formula scan-chart uses
      let tempoIndex = 0;
      for (let i = 1; i < timedTempos.length; i++) {
        if (timedTempos[i].tick <= tick) tempoIndex = i;
        else break;
      }
      const t = timedTempos[tempoIndex];
      const recoveredMs = t.msTime + ((tick - t.tick) * 60000) / (t.bpm * resolution);

      // Should be within 1ms of original (rounding to nearest tick)
      expect(Math.abs(recoveredMs - originalMs)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('chart-writer serialization format', () => {
  test('output uses \\r\\n line endings', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const text = serializeChart(doc);
    // Every line should end with \r\n
    const lines = text.split('\r\n');
    // The last split element should be empty (trailing \r\n)
    expect(lines[lines.length - 1]).toBe('');
    // No bare \n without \r
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
  });

  test('Song section contains expected metadata', () => {
    const doc = makeDoc({
      metadata: {
        name: 'My Song',
        artist: 'My Artist',
        album: 'My Album',
        genre: 'rock',
        year: '2024',
        charter: 'AutoChart',
        resolution: 480,
        musicStream: 'song.ogg',
        drumStream: 'drums.ogg',
      },
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const text = serializeChart(doc);
    expect(text).toContain('Name = "My Song"');
    expect(text).toContain('Artist = "My Artist"');
    expect(text).toContain('Album = "My Album"');
    expect(text).toContain('Genre = "rock"');
    expect(text).toContain('Year = ", 2024"');
    expect(text).toContain('Charter = "AutoChart"');
    expect(text).toContain('Resolution = 480');
    expect(text).toContain('MusicStream = "song.ogg"');
    expect(text).toContain('DrumStream = "drums.ogg"');
  });

  test('SyncTrack orders TS before B at same tick', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: 120}],
      timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const text = serializeChart(doc);
    const syncTrackMatch = text.match(/\[SyncTrack\]\r\n\{\r\n([\s\S]*?)\}/);
    expect(syncTrackMatch).not.toBeNull();
    const syncLines = syncTrackMatch![1].trim().split('\r\n');
    // TS should come before B
    const tsIndex = syncLines.findIndex(l => l.includes('= TS'));
    const bIndex = syncLines.findIndex(l => l.includes('= B'));
    expect(tsIndex).toBeLessThan(bIndex);
  });

  test('time signature denominator 4 omits exponent', () => {
    const doc = makeDoc({
      timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const text = serializeChart(doc);
    // Should be "0 = TS 4" without the exponent
    expect(text).toMatch(/0 = TS 4\r\n/);
    // Should NOT have "0 = TS 4 2"
    expect(text).not.toMatch(/0 = TS 4 2/);
  });

  test('time signature denominator 8 includes exponent 3', () => {
    const doc = makeDoc({
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 1920, numerator: 6, denominator: 8},
      ],
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const text = serializeChart(doc);
    expect(text).toContain('1920 = TS 6 3');
  });

  test('track events sorted: S before N, then by value', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack(
          [
            note(0, 'green', {cymbal: true}),
            note(0, 'kick'),
            note(0, 'red'),
          ],
          {
            starPower: [{tick: 0, length: 960}],
          },
        ),
      ],
    });

    const text = serializeChart(doc);
    const trackMatch = text.match(/\[ExpertDrums\]\r\n\{\r\n([\s\S]*?)\}/);
    expect(trackMatch).not.toBeNull();
    const trackLines = trackMatch![1].trim().split('\r\n').map(l => l.trim());

    // S should come before N at tick 0
    const sIndex = trackLines.findIndex(l => l.startsWith('0 = S'));
    const firstNIndex = trackLines.findIndex(l => l.startsWith('0 = N'));
    expect(sIndex).toBeLessThan(firstNIndex);

    // N values should be sorted ascending within the same tick
    const noteLines = trackLines.filter(l => l.startsWith('0 = N'));
    const noteValues = noteLines.map(l => {
      const parts = l.split(' ');
      return parseInt(parts[3], 10);
    });
    for (let i = 1; i < noteValues.length; i++) {
      expect(noteValues[i]).toBeGreaterThanOrEqual(noteValues[i - 1]);
    }
  });
});

describe('note-mapping', () => {
  test('drumNoteTypeToScanChartType maps all types correctly', () => {
    expect(drumNoteTypeToScanChartType('kick')).toBe(noteTypes.kick);
    expect(drumNoteTypeToScanChartType('red')).toBe(noteTypes.redDrum);
    expect(drumNoteTypeToScanChartType('yellow')).toBe(noteTypes.yellowDrum);
    expect(drumNoteTypeToScanChartType('blue')).toBe(noteTypes.blueDrum);
    expect(drumNoteTypeToScanChartType('green')).toBe(noteTypes.greenDrum);
  });
});

describe('timing', () => {
  test('buildTimedTempos computes correct ms times', () => {
    const tempos = [
      {tick: 0, bpm: 120},
      {tick: 480, bpm: 240},
    ];
    const resolution = 480;
    const timed = buildTimedTempos(tempos, resolution);

    expect(timed).toHaveLength(2);
    expect(timed[0].msTime).toBe(0);
    // At 120 BPM, 480 ticks (1 quarter note) = 500ms
    expect(timed[1].msTime).toBeCloseTo(500, 1);
  });

  test('msToTick is inverse of tick-to-ms', () => {
    const tempos = [{tick: 0, bpm: 120}];
    const resolution = 480;
    const timed = buildTimedTempos(tempos, resolution);

    // At 120 BPM, resolution 480: 1 quarter note = 500ms = 480 ticks
    expect(msToTick(0, timed, resolution)).toBe(0);
    expect(msToTick(500, timed, resolution)).toBe(480);
    expect(msToTick(1000, timed, resolution)).toBe(960);
    expect(msToTick(250, timed, resolution)).toBe(240);
  });

  test('msToTick handles tempo changes', () => {
    const tempos = [
      {tick: 0, bpm: 120},
      {tick: 960, bpm: 240},
    ];
    const resolution = 480;
    const timed = buildTimedTempos(tempos, resolution);

    // First 960 ticks at 120 BPM = 1000ms
    expect(timed[1].msTime).toBeCloseTo(1000, 1);

    // At ms=1000 we should be at tick 960 (start of tempo 2)
    expect(msToTick(1000, timed, resolution)).toBe(960);

    // At ms=1250 (250ms into tempo 2 at 240 BPM):
    // 250ms * 240 * 480 / 60000 = 480 ticks after tick 960 = tick 1440
    expect(msToTick(1250, timed, resolution)).toBe(1440);
  });

  test('snapToGrid snaps to nearest grid position', () => {
    const resolution = 480;

    // 16th note grid (gridDivision=4, gridSize=120)
    expect(snapToGrid(0, resolution, 4)).toBe(0);
    expect(snapToGrid(59, resolution, 4)).toBe(0);
    expect(snapToGrid(60, resolution, 4)).toBe(120);
    expect(snapToGrid(119, resolution, 4)).toBe(120);
    expect(snapToGrid(121, resolution, 4)).toBe(120);

    // 8th note grid (gridDivision=2, gridSize=240)
    expect(snapToGrid(119, resolution, 2)).toBe(0);
    expect(snapToGrid(121, resolution, 2)).toBe(240);

    // Quarter note grid (gridDivision=1, gridSize=480)
    expect(snapToGrid(239, resolution, 1)).toBe(0);
    expect(snapToGrid(241, resolution, 1)).toBe(480);
  });
});

describe('validation', () => {
  test('auto-inserts tempo at tick 0 when missing', () => {
    const doc = makeDoc({
      tempos: [{tick: 480, bpm: 140}],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const result = validateChart(doc);
    expect(result.warnings).toContain('No tempo at tick 0; inserted default 120 BPM');
    expect(result.document.tempos[0]).toMatchObject({tick: 0, bpm: 120});
    expect(result.document.tempos[1]).toMatchObject({tick: 480, bpm: 140});
  });

  test('auto-inserts time signature at tick 0 when missing', () => {
    const doc = makeDoc({
      timeSignatures: [{tick: 1920, numerator: 3, denominator: 4}],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const result = validateChart(doc);
    expect(result.warnings).toContain('No time signature at tick 0; inserted default 4/4');
    expect(result.document.timeSignatures[0]).toMatchObject({tick: 0, numerator: 4, denominator: 4});
  });

  test('throws on zero BPM', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: 0}],
    });
    expect(() => validateChart(doc)).toThrow('Zero or negative BPM');
  });

  test('throws on negative BPM', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: -100}],
    });
    expect(() => validateChart(doc)).toThrow('Zero or negative BPM');
  });

  test('throws on non-power-of-2 denominator', () => {
    const doc = makeDoc({
      timeSignatures: [{tick: 0, numerator: 4, denominator: 3}],
    });
    expect(() => validateChart(doc)).toThrow('Denominator must be a power of 2');
  });

  test('throws on invalid resolution', () => {
    const doc = makeDoc({resolution: 0});
    expect(() => validateChart(doc)).toThrow('Resolution must be a positive integer');
  });

  test('throws on negative tick in note', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(-1, 'kick')])],
    });
    expect(() => validateChart(doc)).toThrow('Negative tick');
  });

  test('deduplicates same-type notes at same tick', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(0, 'kick'),
          note(480, 'red'),
        ]),
      ],
    });

    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('Duplicate notes removed'))).toBe(true);
    expect(result.document.tracks[0].notes).toHaveLength(2);
  });

  test('auto-sorts unsorted notes', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(960, 'blue'),
          note(0, 'kick'),
          note(480, 'red'),
        ]),
      ],
    });

    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('auto-sorted'))).toBe(true);
    expect(result.document.tracks[0].notes[0].tick).toBe(0);
    expect(result.document.tracks[0].notes[1].tick).toBe(480);
    expect(result.document.tracks[0].notes[2].tick).toBe(960);
  });

  test('warns on no notes', () => {
    const doc = makeDoc({tracks: []});
    const result = validateChart(doc);
    expect(result.warnings).toContain('No notes in any track');
  });

  test('warns on default BPM', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('untempo-mapped'))).toBe(true);
  });

  test('warns on cymbal flag on red drum', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(0, 'red', {cymbal: true})])],
    });
    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('Cymbal flag on red drum'))).toBe(true);
  });

  test('warns on double kick on non-Expert difficulty', () => {
    const doc = makeDoc({
      tracks: [
        {
          instrument: 'drums' as const,
          difficulty: 'hard' as const,
          notes: [note(0, 'kick', {doubleKick: true})],
        },
      ],
    });
    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('Double kick on hard'))).toBe(true);
  });

  test('warns on very high BPM', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: 350}],
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const result = validateChart(doc);
    expect(result.warnings.some(w => w.includes('Very high BPM'))).toBe(true);
  });

  test('warns on no sections', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(0, 'kick')])],
    });
    const result = validateChart(doc);
    expect(result.warnings).toContain('No section markers in chart');
  });

  test('does not mutate the original document', () => {
    const doc = makeDoc({
      tempos: [{tick: 480, bpm: 140}],
      tracks: [
        expertTrack([
          note(960, 'blue'),
          note(0, 'kick'),
        ]),
      ],
    });

    const originalFirstNoteTick = doc.tracks[0].notes[0].tick;
    const originalTemposLength = doc.tempos.length;

    validateChart(doc);

    // Original should be unchanged
    expect(doc.tracks[0].notes[0].tick).toBe(originalFirstNoteTick);
    expect(doc.tempos.length).toBe(originalTemposLength);
  });
});

describe('end-to-end: validate then serialize then parse', () => {
  test('validated document round-trips correctly', () => {
    const doc = makeDoc({
      tempos: [{tick: 480, bpm: 140}], // missing tick 0
      timeSignatures: [{tick: 0, numerator: 3, denominator: 4}],
      sections: [{tick: 0, name: 'Intro'}],
      tracks: [
        expertTrack([
          note(960, 'kick'),
          note(0, 'yellow', {cymbal: true}),
          note(480, 'red'),
        ]),
      ],
    });

    // Validate (auto-fixes)
    const {document: fixed} = validateChart(doc);

    // Serialize
    const text = serializeChart(fixed);

    // Parse back
    const parsed = parseBack(text);

    // Verify auto-inserted tempo
    expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(120, 1);
    expect(parsed.tempos[0].tick).toBe(0);
    expect(parsed.tempos[1].beatsPerMinute).toBeCloseTo(140, 1);
    expect(parsed.tempos[1].tick).toBe(480);

    // Verify time signature
    expect(parsed.timeSignatures[0]).toMatchObject({tick: 0, numerator: 3, denominator: 4});

    // Verify section
    expect(parsed.sections[0]).toMatchObject({tick: 0, name: 'Intro'});

    // Verify notes are sorted (yellow at 0, red at 480, kick at 960)
    const groups = parsed.trackData[0].noteEventGroups;
    expect(groups).toHaveLength(3);
    expect(groups[0][0].tick).toBe(0);
    expect(groups[0][0].type).toBe(noteTypes.yellowDrum);
    expect(groups[1][0].tick).toBe(480);
    expect(groups[1][0].type).toBe(noteTypes.redDrum);
    expect(groups[2][0].tick).toBe(960);
    expect(groups[2][0].type).toBe(noteTypes.kick);
  });
});
