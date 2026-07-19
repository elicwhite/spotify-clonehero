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
          {
            tick: 480,
            msTime: 480 * msPerTick,
            length: 960,
            msLength: 960 * msPerTick,
          },
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

/** Game-style integration: compute ms(tick) from the written tempo events
 * exactly the way a chart parser does (tick 0 = time 0, piecewise BPM). */
function gameMsAtTick(
  tempos: Array<{tick: number; beatsPerMinute: number}>,
  tick: number,
  resolution: number,
): number {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  let ms = 0;
  for (let i = 0; i < sorted.length; i++) {
    const segStart = sorted[i].tick;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1].tick : Infinity;
    if (tick <= segStart) break;
    const span = Math.min(tick, segEnd) - segStart;
    ms += (span / resolution) * (60000 / sorted[i].beatsPerMinute);
    if (tick <= segEnd) break;
  }
  return ms;
}

describe('swapSynctrack audio alignment', () => {
  // The written chart must play every note at its original audio time:
  // integrating the WRITTEN tempo events (the only thing the game sees)
  // over each note's new tick must reproduce the note's original msTime.
  for (const originMs of [0, 65.2, 1500, -200]) {
    test(`origin ${originMs}ms: notes keep their audio times in the written chart`, () => {
      const beat = 60000 / 176;
      const tempos = [];
      for (let i = 0; i < 600; i++) {
        tempos.push({ms: originMs + i * beat, bpm: 176 + (i % 3)});
      }
      const syncAtOrigin: Synctrack = {
        origin_ms: originMs,
        tempos,
        timeSignatures: [{ms: originMs, numerator: 4, denominator: 4}],
      };
      const chart = makeChart();
      // Notes across the song, mostly aligned with predicted beats but not exactly.
      const noteMs = Array.from({length: 60}, (_, i) => 2000 + i * 2000.37);
      (chart.trackData[0].noteEventGroups as any) = noteMs.map(ms => [
        {tick: 0, msTime: ms, length: 0, msLength: 0, type: 0, flags: 0},
      ]);

      const out = swapSynctrack(chart, syncAtOrigin);
      const notes = out.trackData[0].noteEventGroups.flat();
      for (let i = 0; i < notes.length; i++) {
        const playedMs = gameMsAtTick(out.tempos, notes[i].tick, RES);
        expect(Math.abs(playedMs - noteMs[i])).toBeLessThan(3);
      }
    });
  }
});

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
    expect(out.tempos.map(t => Math.round(t.beatsPerMinute))).toEqual([
      120, 90,
    ]);
    expect(out.timeSignatures).toHaveLength(1);
  });

  test('quantizeNotes snaps notes to 16ths or triplets', () => {
    const steady: Synctrack = {
      origin_ms: 0,
      tempos: [{ms: 0, bpm: 120}],
      timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
    };
    const chart = makeChart();
    // At 120 BPM / res 480, 1 tick = 1.0416̅ ms.
    // 507 ms → fractional tick 486.7: near the beat (480).
    // 590 ms → fractional tick 566.4: near a 16th-triplet position (560).
    const note = (ms: number) => ({
      tick: 0,
      msTime: ms,
      length: 0,
      msLength: 0,
      type: 0,
      flags: 0,
    });
    (chart.trackData[0].noteEventGroups as any).push([note(507)], [note(590)]);

    const exact = swapSynctrack(chart, steady);
    const exactTicks = exact.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick);
    expect(exactTicks).toContain(487);

    const snapped = swapSynctrack(chart, steady, {quantizeNotes: true});
    const STRAIGHT = 480 / 4; // 16ths
    const TRIPLET = 480 / 6; // 16th triplets
    const ticks = snapped.trackData[0].noteEventGroups.flat().map(n => n.tick);
    for (const t of ticks) {
      expect(t % STRAIGHT === 0 || t % TRIPLET === 0).toBe(true);
    }
    expect(ticks).toContain(480); // 486.7 → beat
    expect(ticks).toContain(560); // 566.4 → 16th triplet

    // Non-note events keep their exact (unquantized) re-tick.
    const segs = buildSegments(steady, RES);
    const section = snapped.sections[0];
    expect(
      Math.abs(tickToMs(section.tick, segs, RES) - chart.sections[0].msTime),
    ).toBeLessThan(3);
  });

  test('writes the partial lead-in bar TS and re-ticks a pickup note sanely', () => {
    // Origin 1000ms at 120 BPM = 2 beats → 2/4 partial first bar.
    const trickSync: Synctrack = {
      origin_ms: 1000,
      tempos: [{ms: 1000, bpm: 120}],
      timeSignatures: [{ms: 1000, numerator: 4, denominator: 4}],
    };
    const chart = makeChart();
    // A pickup note before the origin (at 500ms) plus one on the origin.
    (chart.trackData[0].noteEventGroups as any) = [
      [{tick: 0, msTime: 500, length: 0, msLength: 0, type: 0, flags: 0}],
      [{tick: 0, msTime: 1000, length: 0, msLength: 0, type: 0, flags: 0}],
    ];
    const out = swapSynctrack(chart, trickSync);
    // TS: 2/4 at tick 0, real 4/4 where the partial bar ends (tick 960).
    expect(out.timeSignatures.map(t => [t.tick, t.numerator])).toEqual([
      [0, 2],
      [960, 4],
    ]);
    // Lead tempo is the REAL tempo (no compressed bridge), so the pickup at
    // 500ms lands on the beat at tick 480; the origin note on the bar line.
    expect(out.tempos[0].tick).toBe(0);
    expect(out.tempos[0].beatsPerMinute).toBeCloseTo(120, 6);
    const ticks = out.trackData[0].noteEventGroups.flat().map(n => n.tick);
    expect(ticks).toEqual([480, 960]);
  });

  test('sectionPolicy defaults to preserve — byte-identical to no option', () => {
    const chart = makeChart();
    const withDefault = swapSynctrack(chart, sync);
    const withPreserve = swapSynctrack(chart, sync, {
      sectionPolicy: 'preserve',
    });
    expect(withPreserve.sections).toEqual(withDefault.sections);
  });

  test('sectionPolicy snap-whole-note snaps sections to resolution*4 gridlines', () => {
    const chart = makeChart();
    // Section at 960*msPerTick(100bpm) = 1200ms; preserve re-ticks it exactly.
    const preserved = swapSynctrack(chart, sync).sections[0].tick;
    expect(preserved).toBe(1056); // 960 + 96 (from the existing re-tick test)

    const snapped = swapSynctrack(chart, sync, {
      sectionPolicy: 'snap-whole-note',
    }).sections[0];
    const wholeNote = RES * 4; // 1920
    expect(snapped.tick % wholeNote).toBe(0);
    // 1056 rounds to the nearest whole note (1920) — 1056 is closer to 1920
    // than to 0 only if >= 960; 1056 > 960 so it snaps up to 1920.
    expect(snapped.tick).toBe(1920);
  });

  test('sectionPolicy does not affect notes or other events', () => {
    const chart = makeChart();
    const preserve = swapSynctrack(chart, sync, {sectionPolicy: 'preserve'});
    const snap = swapSynctrack(chart, sync, {sectionPolicy: 'snap-whole-note'});
    expect(snap.trackData[0].noteEventGroups).toEqual(
      preserve.trackData[0].noteEventGroups,
    );
    expect(snap.trackData[0].starPowerSections).toEqual(
      preserve.trackData[0].starPowerSections,
    );
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
