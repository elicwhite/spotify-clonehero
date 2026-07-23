/**
 * Unit tests for the reducer-output -> renderable-Track converter.
 *
 * Covers the pure `reducedNotesToTrack` (tick grouping, ms mapping, lane ->
 * type/flags, dedup) and an end-to-end pass of both reducers through a real
 * fixture so the HOPCAT tom/cymbal resolution and Onyx lane pass-through are
 * exercised against actual data.
 */

import {describe, test, expect} from '@jest/globals';
import {readFileSync, existsSync} from 'fs';
import path from 'path';

import {noteFlags, noteTypes} from '@eliwhite/scan-chart';
import type {ParsedChart} from '../../preview/chorus-chart-processing';
import type {Track} from '../../preview/highway/types';
import {readChart} from '../../chart-edit';
import {parsedChartToRawDrums, toOnyxInput} from '../adapter';
import {parseRawMidiForHopcat} from '../adapter/hopcatRawMidi';
import {
  oursNotesToTrack,
  reduceHopcatToNotes,
  reduceOnyxToNotes,
  reducedNotesToTrack,
  type ReducedNote,
} from '../toRenderableTrack';
import type {OursOutNote} from '../ours/reduce';

function fakeChart(): ParsedChart {
  // 120 BPM, 480 res -> 1 quarter note = 500 ms, 1 tick = 500/480 ms.
  return {
    resolution: 480,
    tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
  } as unknown as ParsedChart;
}

describe('reducedNotesToTrack', () => {
  test('groups same-tick notes into chords and maps lanes to type/flags', () => {
    const reduced: ReducedNote[] = [
      {tick480: 0, lane: 'kick'},
      {tick480: 0, lane: 'snare'},
      {tick480: 480, lane: 'hihat'},
      {tick480: 960, lane: 'high-tom'},
    ];
    const track = reducedNotesToTrack(reduced, fakeChart(), 'hard');

    expect(track.instrument).toBe('drums');
    expect(track.difficulty).toBe('hard');
    expect(track.noteEventGroups).toHaveLength(3);

    const [g0, g1, g2] = track.noteEventGroups;
    expect(g0.map(n => n.type).sort()).toEqual(
      [noteTypes.kick, noteTypes.redDrum].sort(),
    );
    expect(g0[0].msTime).toBe(0);

    // One beat later (tick 480) at 120 BPM = 500 ms; hihat = yellow + cymbal.
    expect(g1).toHaveLength(1);
    expect(g1[0].type).toBe(noteTypes.yellowDrum);
    expect(g1[0].flags & noteFlags.cymbal).toBe(noteFlags.cymbal);
    expect(g1[0].msTime).toBeCloseTo(500, 5);

    // high-tom = yellow + tom flag, not cymbal.
    expect(g2[0].type).toBe(noteTypes.yellowDrum);
    expect(g2[0].flags & noteFlags.tom).toBe(noteFlags.tom);
    expect(g2[0].flags & noteFlags.cymbal).toBe(0);
    expect(g2[0].msTime).toBeCloseTo(1000, 5);
  });

  test('dedupes identical lanes within one tick', () => {
    const reduced: ReducedNote[] = [
      {tick480: 240, lane: 'snare'},
      {tick480: 240, lane: 'snare'},
      {tick480: 240, lane: 'ride'},
    ];
    const track = reducedNotesToTrack(reduced, fakeChart(), 'medium');
    expect(track.noteEventGroups).toHaveLength(1);
    expect(track.noteEventGroups[0]).toHaveLength(2);
  });

  test('emits groups sorted ascending by tick', () => {
    const reduced: ReducedNote[] = [
      {tick480: 960, lane: 'kick'},
      {tick480: 0, lane: 'kick'},
      {tick480: 480, lane: 'kick'},
    ];
    const track = reducedNotesToTrack(reduced, fakeChart(), 'easy');
    const times = track.noteEventGroups.map(g => g[0].msTime);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  test('scales ticks for a non-480 resolution chart', () => {
    // 192-resolution .chart: reducer tick 480 (one quarter) -> source 192 ->
    // 500 ms at 120 BPM (msPerTick = 60000/120/192).
    const chart192 = {
      resolution: 192,
      tempos: [{tick: 0, beatsPerMinute: 120, msTime: 0}],
    } as unknown as ParsedChart;
    const track = reducedNotesToTrack(
      [{tick480: 480, lane: 'kick'}],
      chart192,
      'hard',
    );
    expect(track.noteEventGroups[0][0].tick).toBe(192);
    expect(track.noteEventGroups[0][0].msTime).toBeCloseTo(500, 5);
  });
});

describe('oursNotesToTrack', () => {
  function note(over: Partial<OursOutNote>): OursOutNote {
    return {
      tick: 0,
      msTime: 0,
      lane: 'snare',
      originalLane: 'snare',
      family: 'fixed',
      relaned: false,
      confidence: 1,
      ...over,
    };
  }

  test("carries the note's own tick/msTime through with no rescale", () => {
    // Ours never re-times: a 192-res source tick and its ms are emitted as-is,
    // regardless of the note's tick value (no 480-domain conversion).
    const track = oursNotesToTrack(
      [note({tick: 192, msTime: 500, lane: 'kick'})],
      'hard',
    );
    expect(track.instrument).toBe('drums');
    expect(track.noteEventGroups).toHaveLength(1);
    expect(track.noteEventGroups[0][0].tick).toBe(192);
    expect(track.noteEventGroups[0][0].msTime).toBe(500);
    expect(track.noteEventGroups[0][0].type).toBe(noteTypes.kick);
  });

  test('groups same-tick notes into a chord and dedupes identical lanes', () => {
    const track = oursNotesToTrack(
      [
        note({tick: 240, msTime: 250, lane: 'snare'}),
        note({tick: 240, msTime: 250, lane: 'snare'}),
        note({tick: 240, msTime: 250, lane: 'ride', family: 'cymbal'}),
      ],
      'medium',
    );
    expect(track.noteEventGroups).toHaveLength(1);
    expect(track.noteEventGroups[0]).toHaveLength(2);
  });

  test('maps open-hat (a relaned lane beyond the 8 shared) to yellow cymbal', () => {
    const track = oursNotesToTrack(
      [note({tick: 0, msTime: 0, lane: 'open-hat', family: 'cymbal'})],
      'easy',
    );
    const ev = track.noteEventGroups[0][0];
    expect(ev.type).toBe(noteTypes.yellowDrum);
    expect(ev.flags & noteFlags.cymbal).toBe(noteFlags.cymbal);
  });

  test('emits groups sorted ascending by tick', () => {
    const track = oursNotesToTrack(
      [
        note({tick: 960, msTime: 1000}),
        note({tick: 0, msTime: 0}),
        note({tick: 480, msTime: 500}),
      ],
      'hard',
    );
    const ticks = track.noteEventGroups.map(g => g[0].tick);
    expect(ticks).toEqual([0, 480, 960]);
  });

  test('drops a note whose lane maps to nothing, without an empty group', () => {
    const track = oursNotesToTrack(
      [note({tick: 0, msTime: 0, lane: 'other', family: 'fixed'})],
      'hard',
    );
    expect(track.noteEventGroups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: real fixture through both reducers -> Track
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(__dirname, '..', '__fixtures__');
const FIXTURE = 'reduction-01';

const hasFixture = existsSync(path.join(FIXTURES_DIR, FIXTURE, 'notes.mid'));

const VALID_DRUM_TYPES = new Set<number>([
  noteTypes.kick,
  noteTypes.redDrum,
  noteTypes.yellowDrum,
  noteTypes.blueDrum,
  noteTypes.greenDrum,
]);

function loadFixtureChart() {
  const dir = path.join(FIXTURES_DIR, FIXTURE);
  const files = [
    {
      fileName: 'notes.mid',
      data: new Uint8Array(readFileSync(path.join(dir, 'notes.mid'))),
    },
    {
      fileName: 'song.ini',
      data: new Uint8Array(readFileSync(path.join(dir, 'song.ini'))),
    },
  ];
  const doc = readChart(files as never, {pro_drums: true});
  return doc.parsedChart;
}

function assertRenderableDrumTrack(track: Track): void {
  expect(track.instrument).toBe('drums');
  let prev = -Infinity;
  for (const group of track.noteEventGroups) {
    expect(group.length).toBeGreaterThan(0);
    // msTime is monotonic non-decreasing across groups.
    expect(group[0].msTime).toBeGreaterThanOrEqual(prev);
    prev = group[0].msTime;
    for (const note of group) {
      expect(VALID_DRUM_TYPES.has(note.type)).toBe(true);
      // Red/kick never carry a cymbal flag.
      if (note.type === noteTypes.kick || note.type === noteTypes.redDrum) {
        expect(note.flags & noteFlags.cymbal).toBe(0);
      }
    }
  }
}

(hasFixture ? describe : describe.skip)('end-to-end reducer -> Track', () => {
  test('HOPCAT tiers build renderable drum tracks', () => {
    const chart = loadFixtureChart();
    const adapted = parsedChartToRawDrums(chart);
    if (!adapted.ok) throw new Error(`adapter rejected: ${adapted.reason}`);
    const midBytes = new Uint8Array(
      readFileSync(path.join(FIXTURES_DIR, FIXTURE, 'notes.mid')),
    );
    const input = parseRawMidiForHopcat(midBytes);
    const tiers = reduceHopcatToNotes(input, adapted.chart);

    for (const tier of ['hard', 'medium', 'easy'] as const) {
      const track = reducedNotesToTrack(
        tiers[tier],
        chart as unknown as ParsedChart,
        tier,
      );
      assertRenderableDrumTrack(track);
    }
    // Reductions get progressively sparser: Easy <= Medium <= Hard note count.
    const count = (t: 'hard' | 'medium' | 'easy') => tiers[t].length;
    expect(count('easy')).toBeLessThanOrEqual(count('hard'));
  });

  test('Onyx tiers build renderable drum tracks', () => {
    const chart = loadFixtureChart();
    const adapted = parsedChartToRawDrums(chart);
    if (!adapted.ok) throw new Error(`adapter rejected: ${adapted.reason}`);
    const tiers = reduceOnyxToNotes(toOnyxInput(adapted.chart));

    for (const tier of ['hard', 'medium', 'easy'] as const) {
      const track = reducedNotesToTrack(
        tiers[tier],
        chart as unknown as ParsedChart,
        tier,
      );
      assertRenderableDrumTrack(track);
    }
  });
});
