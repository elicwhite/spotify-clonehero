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
  LEAD_MIN_MS,
  planLeadingSilence,
  applyLeadingSilence,
  getAudioAnchor,
  setAudioAnchor,
  refreshAnchorKeepMs,
  refreshAnchorKeepTick,
} from '../leading-silence';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {buildSyncLayout} from '@/lib/tempo-map/synctrack-ticks';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import type {Synctrack} from '@/lib/tempo-map/types';
import {noteTypes} from '@eliwhite/scan-chart';

const SR = 44100;

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

function firstNoteMs(doc: ChartDocument): number {
  return doc.parsedChart.trackData[0].noteEventGroups.flat()[0].msTime;
}

// ---------------------------------------------------------------------------
// 1. Worked example: tier (c) collapse-marker opening
// ---------------------------------------------------------------------------

describe('planLeadingSilence / applyLeadingSilence — worked example', () => {
  const RES = 192;
  const BPM0 = 146.98;

  /** Build the tier-(c) opening buildSyncLayout emits for a sub-beat origin
   * (a tick-0 collapse marker followed by the real tempo), by actually
   * running buildSyncLayout + swapSynctrack — not hand-forged numbers. */
  function makeCollapseDoc(): {doc: ChartDocument; originMsPrePad: number} {
    // Pick an originMs that lands in tier (c) (sub-beat lead-in): with
    // BPM0=146.98 a beat is 408.3ms, so a origin a few ms after ms=0 is
    // sub-beat and can't fit even a partial-bar trick.
    const originMs = 26.9;
    const sync: Synctrack = {
      origin_ms: originMs,
      tempos: [{ms: originMs, bpm: BPM0}],
      timeSignatures: [{ms: originMs, numerator: 4, denominator: 4}],
    };
    const {leadInTs} = buildSyncLayout(sync, RES);
    expect(leadInTs).toBeNull(); // confirms tier (c), not the partial-bar trick

    const doc = makeDoc(RES, 120);
    doc.parsedChart = swapSynctrack(doc.parsedChart, sync, {
      quantizeNotes: false,
      sectionPolicy: 'preserve',
    });
    // Confirm the collapse marker landed as expected.
    expect(doc.parsedChart.tempos.length).toBeGreaterThanOrEqual(2);
    expect(doc.parsedChart.tempos[0].tick).toBe(0);
    expect(doc.parsedChart.tempos[0].beatsPerMinute).toBeGreaterThan(5000);
    expect(doc.parsedChart.tempos[1].beatsPerMinute).toBeCloseTo(BPM0, 6);

    // Note at the origin (the first real downbeat, pre-pad).
    const timedFull = buildTimedTempos(doc.parsedChart.tempos, RES);
    const barTicks = 4 * RES;
    const originTick = barTicks; // tier (c): origin = one full bar in
    addNoteAtTick(doc, originTick);
    const originMsPrePad = tickToMs(originTick, timedFull, RES);

    return {doc, originMsPrePad};
  }

  test('plan: N=2, padMs ~= 3238.9ms', () => {
    const {doc, originMsPrePad} = makeCollapseDoc();
    // The plan doc's 26.9ms is the pre-quantization synctrack origin; the
    // chart-writer rounds the collapse-marker's tick to an integer (752 vs
    // 755.35 here), which perturbs the *written* origin by a a sub-2ms
    // amount — expected, and irrelevant to the padding math since
    // planLeadingSilence reads the origin back off the actual chart.
    expect(originMsPrePad).toBeGreaterThan(20);
    expect(originMsPrePad).toBeLessThan(35);

    const plan = planLeadingSilence(doc, SR);
    expect(plan).not.toBeNull();
    expect(plan!.bars).toBe(2);
    expect(plan!.bpm0).toBeCloseTo(BPM0, 3);
    expect(plan!.numerator).toBe(4);
    expect(plan!.denominator).toBe(4);

    const barMs = (4 * 60000) / BPM0;
    const expectedPadMs = 2 * barMs - originMsPrePad;
    expect(plan!.padMs).toBeCloseTo(expectedPadMs, 1);
    // Matches the plan doc's worked example (3238.9ms) within the tick-
    // rounding tolerance above.
    expect(plan!.padMs).toBeGreaterThan(3225);
    expect(plan!.padMs).toBeLessThan(3245);
  });

  test('apply: single tempo marker at tick 0, 146.98 bpm, 4/4, no leadInTs; first downbeat note at tick 2*4*192', () => {
    const {doc} = makeCollapseDoc();
    const plan = planLeadingSilence(doc, SR)!;
    const applied = applyLeadingSilence(doc, plan);
    const chart = applied.parsedChart;

    // Re-derive the layout from the applied chart's own tempo grid: it
    // should collapse to a single tick-0 marker at the real tempo, no
    // partial-bar trick.
    const sync = synctrackFromChart(chart);
    const {segs, leadInTs} = buildSyncLayout(sync, RES);
    expect(leadInTs).toBeNull();
    expect(segs).toHaveLength(1);
    expect(segs[0].tick).toBe(0);
    expect(segs[0].bpm).toBeCloseTo(BPM0, 3);

    expect(chart.timeSignatures[0].tick).toBe(0);
    expect(chart.timeSignatures[0].numerator).toBe(4);
    expect(chart.timeSignatures[0].denominator).toBe(4);

    const note = chart.trackData[0].noteEventGroups.flat()[0];
    expect(note.tick).toBe(2 * 4 * RES);

    expect(getAudioAnchor(applied)!.ms).toBeCloseTo(plan.padMs, 6);
  });
});

// ---------------------------------------------------------------------------
// 2. Clean chart, first note early
// ---------------------------------------------------------------------------

describe('clean chart, first note early', () => {
  test('120 bpm 4/4, first note at 500ms -> N=1, padMs=2000', () => {
    const RES = 480;
    const doc = makeDoc(RES, 120);
    // 500ms at 120bpm = 1 beat = 480 ticks.
    addNoteAtTick(doc, 480);
    expect(firstNoteMs(doc)).toBeCloseTo(500, 6);

    const plan = planLeadingSilence(doc, SR)!;
    expect(plan).not.toBeNull();
    expect(plan.bars).toBe(1);
    expect(plan.padMs).toBeCloseTo(2000, 0);

    const beforeTick =
      doc.parsedChart.trackData[0].noteEventGroups.flat()[0].tick;
    const applied = applyLeadingSilence(doc, plan);
    const afterTick =
      applied.parsedChart.trackData[0].noteEventGroups.flat()[0].tick;
    // Shifts by exactly one bar of ticks (4 beats @ res 480 = 1920).
    expect(afterTick - beforeTick).toBe(4 * RES);

    // Tempo/TS values unchanged (still 120bpm 4/4), just later in the map.
    expect(applied.parsedChart.tempos[0].beatsPerMinute).toBe(120);
    expect(applied.parsedChart.timeSignatures[0].numerator).toBe(4);
    expect(applied.parsedChart.timeSignatures[0].denominator).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Already-padded chart (explicit-button contract)
// ---------------------------------------------------------------------------

describe('already-padded chart', () => {
  test('clean opening, first note at 5000ms: pMin=0 but the button still pads to bar alignment (N=1)', () => {
    // Contract chosen for this module: planLeadingSilence always tops up to
    // the next whole-bar alignment even when pMin=0 already (LEAD_MIN_MS is
    // clamped from below, not treated as "already satisfied -> no-op"). A
    // clean tick-0 chart's originMs is already 0 == a bar boundary (0*barMs),
    // so N = max(1, ceil((0+0)/barMs - eps)) = 1 (the `max(1, ...)` floor):
    // pressing the button always adds at least one bar, which is the
    // documented "explicit button" behavior (0064 addendum: repeat presses
    // accumulate, they never no-op just because the song already has room).
    const RES = 480;
    const doc = makeDoc(RES, 120);
    addNoteAtTick(doc, 4800); // 4800 ticks @120bpm/480 = 10 beats = 5000ms
    expect(firstNoteMs(doc)).toBeCloseTo(5000, 6);

    const plan = planLeadingSilence(doc, SR)!;
    expect(plan).not.toBeNull();
    expect(plan.bars).toBe(1);
    expect(plan.padMs).toBeCloseTo(2000, 0); // one bar @120bpm 4/4 = 2000ms
  });
});

// ---------------------------------------------------------------------------
// 4. 7/8 time signature
// ---------------------------------------------------------------------------

describe('7/8 time signature', () => {
  test('barBeats = 3.5 handling', () => {
    const RES = 480;
    const doc = makeDoc(RES, 140);
    doc.parsedChart.timeSignatures = [
      {tick: 0, numerator: 7, denominator: 8, msTime: 0, msLength: 0},
    ];
    retimeChart(doc.parsedChart);
    addNoteAtTick(doc, 0);

    const plan = planLeadingSilence(doc, SR)!;
    expect(plan).not.toBeNull();
    expect(plan.numerator).toBe(7);
    expect(plan.denominator).toBe(8);
    const barBeats = (7 * 4) / 8; // 3.5
    const barMs = (barBeats * 60000) / 140; // 1500ms/bar
    // pMin = 2000 - 0 = 2000ms; one 1500ms bar isn't enough (needs 2).
    expect(plan.bars).toBe(2);
    expect(plan.padMs).toBeCloseTo(2 * barMs, 0);

    const applied = applyLeadingSilence(doc, plan);
    expect(applied.parsedChart.timeSignatures[0].numerator).toBe(7);
    expect(applied.parsedChart.timeSignatures[0].denominator).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// 5. Second press accumulates
// ---------------------------------------------------------------------------

describe('second press accumulates', () => {
  test('anchor.ms == pad1 + pad2', () => {
    const RES = 480;
    const doc = makeDoc(RES, 100);
    addNoteAtTick(doc, 0);

    const plan1 = planLeadingSilence(doc, SR)!;
    const once = applyLeadingSilence(doc, plan1);
    expect(getAudioAnchor(once)!.ms).toBeCloseTo(plan1.padMs, 6);

    const plan2 = planLeadingSilence(once, SR)!;
    const twice = applyLeadingSilence(once, plan2);
    expect(getAudioAnchor(twice)!.ms).toBeCloseTo(plan1.padMs + plan2.padMs, 3);
  });
});

// ---------------------------------------------------------------------------
// 6. Property-ish randomized cases (seeded LCG, deterministic)
// ---------------------------------------------------------------------------

function makeLcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

describe('property: random bpm0/first-note-ms/TS', () => {
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
      const firstMs = rand() * 3000;
      const [numerator, denominator] =
        tsChoices[Math.floor(rand() * tsChoices.length)];

      const doc = makeDoc(RES, bpm);
      doc.parsedChart.timeSignatures = [
        {tick: 0, numerator, denominator, msTime: 0, msLength: 0},
      ];
      retimeChart(doc.parsedChart);
      const beatUnitTicks = (RES * 4) / denominator;
      const tick = Math.max(
        0,
        Math.round((firstMs / 60000) * bpm * RES) -
          (Math.round((firstMs / 60000) * bpm * RES) % beatUnitTicks),
      );
      addNoteAtTick(doc, tick);

      const plan = planLeadingSilence(doc, SR);
      if (!plan) return; // padMs rounded below half a sample; nothing to check
      const applied = applyLeadingSilence(doc, plan);
      const sync = synctrackFromChart(applied.parsedChart);
      const {segs, leadInTs} = buildSyncLayout(sync, RES);
      expect(leadInTs).toBeNull();
      expect(segs[0].tick).toBe(0);
      // Sample quantization leaves an implied lead-in stretch of ~1e-5
      // (plan 0064's "six orders of magnitude under the 25% tier-(a)
      // threshold"); the resulting tick-0 BPM deviates from the real bpm by
      // that SAME relative amount, i.e. an absolute deviation that scales
      // with bpm (~0.002 BPM at bpm=200, not the plan doc's illustrative
      // "<0.001" — measured at a lower bpm). Assert the relative form.
      expect(Math.abs(segs[0].bpm / bpm - 1)).toBeLessThan(1e-4);
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
