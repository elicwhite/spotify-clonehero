import {createEmptyChart} from '@eliwhite/scan-chart';
import type {ParsedChart} from '@eliwhite/scan-chart';
import {swapSynctrack} from '../swap-synctrack';
import {buildSegments, tickToMs} from '../synctrack-ticks';
import type {Synctrack} from '../types';

const RES = 480;

/** A chart at constant 100 BPM with a few drum notes and a section. */
function makeChart(): ParsedChart {
  const chart = createEmptyChart({format: 'chart', resolution: RES, bpm: 100});
  const msPerTick = 60000 / (100 * RES);
  const note = (tick: number, length = 0) => ({
    tick,
    msTime: tick * msPerTick,
    length,
    msLength: length * msPerTick,
    type: 0,
    flags: 0,
  });
  return {
    ...chart,
    sections: [{tick: 960, msTime: 960 * msPerTick, name: 'Verse 1'}],
    trackData: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        starPowerSections: [
          {tick: 480, msTime: 480 * msPerTick, length: 960, msLength: 960 * msPerTick},
        ],
        rejectedStarPowerSections: [],
        soloSections: [],
        flexLanes: [],
        drumFreestyleSections: [],
        textEvents: [],
        versusPhrases: [],
        animations: [],
        noteEventGroups: [[note(0)], [note(480)], [note(960, 240)]],
      },
    ],
  } as unknown as ParsedChart;
}

const sync: Synctrack = {
  origin_ms: 0,
  tempos: [
    {ms: 0, bpm: 120},
    {ms: 1000, bpm: 60},
  ],
  timeSignatures: [{ms: 0, numerator: 3, denominator: 4}],
};

describe('swapSynctrack', () => {
  test('installs predicted tempos and time signatures with tick-0 anchors', () => {
    const out = swapSynctrack(makeChart(), sync);
    expect(out.tempos[0].tick).toBe(0);
    expect(out.tempos[0].beatsPerMinute).toBe(120);
    expect(out.tempos.map(t => t.beatsPerMinute)).toEqual([120, 60]);
    expect(out.timeSignatures).toHaveLength(1);
    expect(out.timeSignatures[0].tick).toBe(0);
    expect(out.timeSignatures[0].numerator).toBe(3);
  });

  test('preserves note wall-clock times under the new synctrack', () => {
    const chart = makeChart();
    const out = swapSynctrack(chart, sync);
    const segs = buildSegments(sync, RES);
    const origNotes = chart.trackData[0].noteEventGroups.flat();
    const newNotes = out.trackData[0].noteEventGroups.flat();
    for (let i = 0; i < origNotes.length; i++) {
      const recomputedMs = tickToMs(newNotes[i].tick, segs, RES);
      // ±1 tick of rounding: at 60-120 BPM and res 480, ~1-2 ms
      expect(Math.abs(recomputedMs - origNotes[i].msTime)).toBeLessThan(3);
    }
  });

  test('re-ticks sections and star power lengths', () => {
    const chart = makeChart();
    const out = swapSynctrack(chart, sync);
    const segs = buildSegments(sync, RES);

    // Section at 960*msPerTick(100bpm) = 1200ms. Under the new map: first
    // 1000ms at 120bpm = 960 ticks, then 200ms at 60bpm = 96 ticks.
    expect(out.sections[0].tick).toBe(960 + 96);

    const sp = out.trackData[0].starPowerSections[0];
    const origSp = chart.trackData[0].starPowerSections[0];
    const startMs = tickToMs(sp.tick, segs, RES);
    const endMs = tickToMs(sp.tick + sp.length, segs, RES);
    expect(Math.abs(startMs - origSp.msTime)).toBeLessThan(3);
    expect(Math.abs(endMs - (origSp.msTime + origSp.msLength))).toBeLessThan(3);
  });

  test('collapses duplicate-BPM runs and no-op meter changes', () => {
    const noisy: Synctrack = {
      origin_ms: 0,
      tempos: [
        {ms: 0, bpm: 120},
        {ms: 500, bpm: 120},
        {ms: 1000, bpm: 120.00001},
        {ms: 1500, bpm: 90},
      ],
      timeSignatures: [
        {ms: 0, numerator: 4, denominator: 4},
        {ms: 1000, numerator: 4, denominator: 4},
      ],
    };
    const out = swapSynctrack(makeChart(), noisy);
    expect(out.tempos.map(t => Math.round(t.beatsPerMinute))).toEqual([120, 90]);
    expect(out.timeSignatures).toHaveLength(1);
  });

  test('clamps pre-origin events to tick 0', () => {
    const lateSync: Synctrack = {
      origin_ms: 5000,
      tempos: [{ms: 5000, bpm: 120}],
      timeSignatures: [{ms: 5000, numerator: 4, denominator: 4}],
    };
    const out = swapSynctrack(makeChart(), lateSync);
    for (const group of out.trackData[0].noteEventGroups) {
      for (const n of group) expect(n.tick).toBeGreaterThanOrEqual(0);
    }
  });
});
