/**
 * Tests for parsedChartToDocument (0007a).
 *
 * Verifies that a ParsedChart (from scan-chart's parseChartFile) can be
 * converted to a ChartDocument, and that the result round-trips correctly
 * through serializeChart -> parseChartFile.
 */

import {parseChartFile} from '@eliwhite/scan-chart';
import {parsedChartToDocument} from '../chart-io/parsed-to-doc';
import {serializeChart} from '../chart-io/writer';
import type {ChartDocument} from '../chart-io/types';

const PRO_DRUMS_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
} as const;

/**
 * Minimal valid .chart text with expert drums.
 */
const MINIMAL_CHART = `[Song]
{
  Name = "Test Song"
  Artist = "Test Artist"
  Resolution = 480
  Offset = 0
  Player2 = bass
  Difficulty = 0
  PreviewStart = 0
  PreviewEnd = 0
  MediaType = "cd"
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
  960 = B 140000
}
[Events]
{
  0 = E "section Intro"
}
[ExpertDrums]
{
  0 = N 0 0
  480 = N 1 0
  480 = N 2 0
  480 = N 66 0
  960 = N 3 0
  960 = N 67 0
  960 = N 36 0
}
`;

describe('parsedChartToDocument', () => {
  it('converts tempos correctly', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    expect(doc.tempos).toHaveLength(2);
    expect(doc.tempos[0]).toEqual({tick: 0, bpm: 120});
    expect(doc.tempos[1]).toEqual({tick: 960, bpm: 140});
  });

  it('converts time signatures correctly', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    expect(doc.timeSignatures).toHaveLength(1);
    expect(doc.timeSignatures[0]).toEqual({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
  });

  it('converts sections correctly', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toEqual({tick: 0, name: 'Intro'});
  });

  it('converts drum notes with correct types', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    const expertTrack = doc.tracks.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(expertTrack).toBeDefined();
    const notes = expertTrack!.notes;

    // kick at tick 0
    expect(notes[0].tick).toBe(0);
    expect(notes[0].type).toBe('kick');

    // red at tick 480
    expect(notes[1].tick).toBe(480);
    expect(notes[1].type).toBe('red');

    // yellow cymbal at tick 480
    expect(notes[2].tick).toBe(480);
    expect(notes[2].type).toBe('yellow');
    expect(notes[2].flags.cymbal).toBe(true);
  });

  it('converts blue cymbal with accent', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    const expertTrack = doc.tracks.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const blueNote = expertTrack!.notes.find(
      n => n.tick === 960 && n.type === 'blue',
    );
    expect(blueNote).toBeDefined();
    expect(blueNote!.flags.cymbal).toBe(true);
    expect(blueNote!.flags.accent).toBe(true);
  });

  it('preserves resolution', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    expect(doc.resolution).toBe(480);
  });

  it('preserves metadata', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed);

    expect(doc.metadata.name).toBe('Test Song');
    expect(doc.metadata.artist).toBe('Test Artist');
  });

  it('round-trips through serialize -> parse', () => {
    const bytes = new TextEncoder().encode(MINIMAL_CHART);
    const parsed1 = parseChartFile(bytes, 'chart', PRO_DRUMS_MODIFIERS);
    const doc = parsedChartToDocument(parsed1);

    // Serialize back to .chart text and parse again
    const serialized = serializeChart(doc);
    const bytes2 = new TextEncoder().encode(serialized);
    const parsed2 = parseChartFile(bytes2, 'chart', PRO_DRUMS_MODIFIERS);

    // Tempos should match
    expect(parsed2.tempos).toHaveLength(parsed1.tempos.length);
    for (let i = 0; i < parsed1.tempos.length; i++) {
      expect(parsed2.tempos[i].tick).toBe(parsed1.tempos[i].tick);
      expect(parsed2.tempos[i].beatsPerMinute).toBe(
        parsed1.tempos[i].beatsPerMinute,
      );
    }

    // Note counts should match
    const track1 = parsed1.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const track2 = parsed2.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(track2!.noteEventGroups.length).toBe(track1!.noteEventGroups.length);
  });
});
