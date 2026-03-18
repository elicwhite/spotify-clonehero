/**
 * Tests for the chart-io/reader data bridge.
 *
 * Verifies that chartDocumentToParsedChart() correctly converts a
 * ChartDocument to a ParsedChart via the serialize -> parse round-trip.
 */

import {describe, test, expect} from '@jest/globals';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

import {chartDocumentToParsedChart} from '../chart-io/reader';
import type {ChartDocument, DrumNote, DrumNoteType, TrackData} from '../chart-io/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function note(
  tick: number,
  type: DrumNoteType,
  flags: DrumNote['flags'] = {},
  length = 0,
): DrumNote {
  return {tick, type, length, flags};
}

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

describe('chartDocumentToParsedChart', () => {
  test('converts a minimal chart with a single kick note', () => {
    const doc = makeDoc({
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const parsed = chartDocumentToParsedChart(doc);

    expect(parsed.resolution).toBe(480);
    expect(parsed.trackData).toHaveLength(1);
    expect(parsed.trackData[0].instrument).toBe('drums');
    expect(parsed.trackData[0].difficulty).toBe('expert');
    expect(parsed.trackData[0].noteEventGroups).toHaveLength(1);
    expect(parsed.trackData[0].noteEventGroups[0][0].type).toBe(noteTypes.kick);
  });

  test('preserves tempo and time signature data', () => {
    const doc = makeDoc({
      tempos: [
        {tick: 0, bpm: 120},
        {tick: 1920, bpm: 140},
      ],
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4},
        {tick: 1920, numerator: 3, denominator: 4},
      ],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const parsed = chartDocumentToParsedChart(doc);

    expect(parsed.tempos).toHaveLength(2);
    expect(parsed.tempos[0].beatsPerMinute).toBeCloseTo(120, 1);
    expect(parsed.tempos[1].beatsPerMinute).toBeCloseTo(140, 1);
    expect(parsed.timeSignatures).toHaveLength(2);
    expect(parsed.timeSignatures[1].numerator).toBe(3);
  });

  test('preserves section markers', () => {
    const doc = makeDoc({
      sections: [
        {tick: 0, name: 'Intro'},
        {tick: 1920, name: 'Verse'},
      ],
      tracks: [expertTrack([note(0, 'kick')])],
    });

    const parsed = chartDocumentToParsedChart(doc);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].name).toBe('Intro');
    expect(parsed.sections[1].name).toBe('Verse');
  });

  test('converts pro drums with cymbal flags', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'yellow', {cymbal: true}),
          note(480, 'yellow'),
        ]),
      ],
    });

    const parsed = chartDocumentToParsedChart(doc);
    const groups = parsed.trackData[0].noteEventGroups;

    expect(groups).toHaveLength(2);
    // Yellow cymbal should have cymbal flag
    expect(groups[0][0].flags & noteFlags.cymbal).toBeTruthy();
    // Yellow tom should have tom flag, not cymbal
    expect(groups[1][0].flags & noteFlags.tom).toBeTruthy();
    expect(groups[1][0].flags & noteFlags.cymbal).toBeFalsy();
  });

  test('notes have computed msTime values', () => {
    const doc = makeDoc({
      tempos: [{tick: 0, bpm: 120}],
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(480, 'red'),
        ]),
      ],
    });

    const parsed = chartDocumentToParsedChart(doc);
    const groups = parsed.trackData[0].noteEventGroups;

    // At 120 BPM, resolution 480: 1 quarter note = 500ms
    expect(groups[0][0].msTime).toBeCloseTo(0, 0);
    expect(groups[1][0].msTime).toBeCloseTo(500, 0);
  });

  test('handles simultaneous notes (chords) correctly', () => {
    const doc = makeDoc({
      tracks: [
        expertTrack([
          note(0, 'kick'),
          note(0, 'yellow', {cymbal: true}),
          note(0, 'red'),
        ]),
      ],
    });

    const parsed = chartDocumentToParsedChart(doc);
    const groups = parsed.trackData[0].noteEventGroups;

    // All three notes at tick 0 should be in one group
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  test('works with a realistic chart (multiple note types, tempos, sections)', () => {
    const drumNotes: DrumNote[] = [];
    for (let beat = 0; beat < 16; beat++) {
      const tick = beat * 480;
      drumNotes.push(note(tick, 'yellow', {cymbal: true}));
      if (beat % 2 === 0) drumNotes.push(note(tick, 'kick'));
      if (beat % 2 === 1) drumNotes.push(note(tick, 'red'));
    }

    const doc = makeDoc({
      tempos: [
        {tick: 0, bpm: 120},
        {tick: 3840, bpm: 130},
      ],
      sections: [
        {tick: 0, name: 'Intro'},
        {tick: 3840, name: 'Verse'},
      ],
      tracks: [expertTrack(drumNotes)],
    });

    const parsed = chartDocumentToParsedChart(doc);

    expect(parsed.trackData).toHaveLength(1);
    expect(parsed.trackData[0].noteEventGroups.length).toBeGreaterThan(10);
    expect(parsed.tempos).toHaveLength(2);
    expect(parsed.sections).toHaveLength(2);
  });
});
