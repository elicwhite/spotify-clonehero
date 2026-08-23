/**
 * Leading-silence padding tests (plan 0064 + editor-button addendum).
 */

import type {ChartDocument} from '../types';
import {
  createEmptyChart,
  addDrumNote,
  makeChartTiming,
  retimeChart,
  synctrackFromChart,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  planLeadIn,
  applyLeadIn,
  getAudioAnchor,
  setAudioAnchor,
  setSongStart,
  refreshAnchorKeepMs,
  refreshAnchorKeepTick,
} from '../leading-silence';
import {buildSyncLayout} from '@/lib/tempo-map/synctrack-ticks';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {noteTypes} from '@eliwhite/scan-chart';

function makeDoc(resolution: number, bpm = 120): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution});
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  return doc;
}

function addNoteAtTick(doc: ChartDocument, tick: number) {
  const timing = makeChartTiming(doc.parsedChart);
  addDrumNote(
    doc.parsedChart.trackData[0],
    {tick, type: noteTypes.redDrum},
    timing,
  );
  retimeChart(doc.parsedChart);
}

/** Deterministic pseudo-random source, so a failing case is reproducible. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Round trip: whatever the opening was, the emitted one survives the writer
//
// The model tests (bar counts, the absolute pad, the emitted opening) live in
// `lead-in-pad.test.ts`. What is left here is the property this feature rests
// on — `buildSyncLayout` must infer nothing — plus the anchor helpers.
// ---------------------------------------------------------------------------

describe('property: the writer adds no lead-in of its own', () => {
  const rand = makeLcg(20260719);
  const RES = 480;
  const tsChoices: Array<[number, number]> = [
    [4, 4],
    [3, 4],
    [6, 8],
  ];

  for (let i = 0; i < 12; i++) {
    test(`case ${i}`, () => {
      const bpm = 60 + rand() * 160;
      const songStartMs = rand() * 3000;
      const [numerator, denominator] =
        tsChoices[Math.floor(rand() * tsChoices.length)];

      const base = makeDoc(RES, bpm);
      base.parsedChart.timeSignatures = [
        {tick: 0, numerator, denominator, msTime: 0, msLength: 0},
      ];
      retimeChart(base.parsedChart);
      addNoteAtTick(base, RES * 8);

      // No opening record: the chart's own tick-0 values stand, which is the
      // hard case — the emitted meter is the chart's, not a forced 4/4.
      const doc = setSongStart(base, {audioMs: songStartMs});
      const plan = planLeadIn(doc);
      expect(plan).not.toBeNull();
      const applied = applyLeadIn(doc, plan!);

      const sync = synctrackFromChart(applied.parsedChart);
      const {segs, leadInTs} = buildSyncLayout(sync, RES);
      expect(leadInTs).toBeNull();
      expect(segs[0].tick).toBe(0);
      expect(segs[0].ms).toBe(0);
      // Sample quantization leaves an implied stretch of ~1e-5, so compare
      // the tick-0 BPM to the opening in relative terms.
      expect(Math.abs(segs[0].bpm / bpm - 1)).toBeLessThan(1e-4);

      // And the song start is a whole number of bars in.
      const barTicks = ((numerator * 4) / denominator) * RES;
      expect(Number.isInteger(barTicks)).toBe(true);
      const timed = buildTimedTempos(
        applied.parsedChart.tempos,
        applied.parsedChart.resolution,
      );
      const songStartTick = plan!.bars * barTicks;
      expect(tickToMs(songStartTick, timed, RES)).toBeCloseTo(
        plan!.padMs + songStartMs,
        0,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Anchor refresh helpers
// ---------------------------------------------------------------------------

describe('refreshAnchorKeepMs / refreshAnchorKeepTick', () => {
  test('keep-tick recomputes ms after a bpm change; keep-ms recomputes tick', () => {
    const RES = 480;
    const doc = makeDoc(RES, 120);
    // Anchor at tick 480 (1 beat @ 120bpm = 500ms).
    let withAnchor = setAudioAnchor(doc, {tick: 480, ms: 500});
    expect(getAudioAnchor(withAnchor)!.ms).toBe(500);

    // Change bpm to 60 and retime.
    withAnchor.parsedChart.tempos = [{tick: 0, beatsPerMinute: 60, msTime: 0}];
    retimeChart(withAnchor.parsedChart);

    // KEEP-TICKS: anchor.tick stays 480, ms recomputes to 1 beat @60bpm=1000ms.
    const keptTick = refreshAnchorKeepTick(withAnchor);
    expect(getAudioAnchor(keptTick)!.tick).toBe(480);
    expect(getAudioAnchor(keptTick)!.ms).toBeCloseTo(1000, 6);

    // KEEP-MS: anchor.ms stays 500, tick recomputes to 0.5 beat @60bpm=240 ticks.
    const keptMs = refreshAnchorKeepMs(withAnchor);
    expect(getAudioAnchor(keptMs)!.ms).toBe(500);
    expect(getAudioAnchor(keptMs)!.tick).toBeCloseTo(240, 6);
  });

  test('no-ops when there is no anchor', () => {
    const doc = makeDoc(480, 120);
    expect(refreshAnchorKeepMs(doc)).toBe(doc);
    expect(refreshAnchorKeepTick(doc)).toBe(doc);
  });
});

// ---------------------------------------------------------------------------
// 8. getAudioAnchor / setAudioAnchor
// ---------------------------------------------------------------------------

describe('getAudioAnchor / setAudioAnchor', () => {
  test('round-trips and survives a spread clone', () => {
    const doc = makeDoc(480, 120);
    expect(getAudioAnchor(doc)).toBeNull();

    const withAnchor = setAudioAnchor(doc, {tick: 100, ms: 50});
    expect(getAudioAnchor(withAnchor)).toEqual({tick: 100, ms: 50});
    expect(getAudioAnchor(doc)).toBeNull(); // original untouched

    const spread = {...withAnchor};
    expect(getAudioAnchor(spread)).toEqual({tick: 100, ms: 50});

    const cleared = setAudioAnchor(withAnchor, null);
    expect(getAudioAnchor(cleared)).toBeNull();
  });
});
