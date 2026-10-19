/**
 * The lead-in pad (plan 0124 steps 2 and 3).
 *
 *   P = N * barMs - X,  sample-quantized, ABSOLUTE.
 *
 * X is the song start in original-audio ms; N is the bar count. Every figure
 * below was computed, not written by hand.
 */

import type {ChartDocument} from '../types';
import {
  addDrumNote,
  addTempo,
  createEmptyChart,
  makeChartTiming,
  retimeChart,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  LEAD_MIN_MS,
  applyLeadIn,
  getAudioAnchor,
  getSongStartTick,
  leadInBars,
  songStartAudioMs,
  planLeadIn,
  setSongStartTick,
} from '../leading-silence';
import {buildTimedTempos, msToTick} from '@/lib/drum-transcription/timing';
import {noteTypes} from '@eliwhite/scan-chart';

const RES = 192;

function makeDoc(bpm: number, meter: [number, number] = [4, 4]): ChartDocument {
  const parsedChart = createEmptyChart({format: 'chart', bpm, resolution: RES});
  parsedChart.timeSignatures[0] = {
    ...parsedChart.timeSignatures[0],
    numerator: meter[0],
    denominator: meter[1],
  };
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  return doc;
}

/** A doc whose song start sits `audioMs` into the (as yet unpadded) audio.
 *  The record is a TICK, so `audioMs` is quantized on the way in. */
function ready(
  bpm: number,
  audioMs: number,
  meter: [number, number] = [4, 4],
): ChartDocument {
  const doc = makeDoc(bpm, meter);
  const chart = doc.parsedChart;
  const timed = buildTimedTempos(chart.tempos, chart.resolution);
  return setSongStartTick(doc, msToTick(audioMs, timed, chart.resolution));
}

function addNote(doc: ChartDocument, tick: number) {
  addDrumNote(
    doc.parsedChart.trackData[0],
    {tick, type: noteTypes.redDrum},
    makeChartTiming(doc.parsedChart),
  );
  retimeChart(doc.parsedChart);
}

function noteMs(doc: ChartDocument): number[] {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => n.msTime)
    .sort((a, b) => a - b);
}

const barMs = (bpm: number, num = 4, den = 4) =>
  ((num * 4) / den) * (60000 / bpm);

// ---------------------------------------------------------------------------
// Choosing N
// ---------------------------------------------------------------------------

describe('choosing N', () => {
  it('meets the two-second floor on a chart with no notes', () => {
    // 146.98 BPM 4/4 -> barMs 1632.875; ceil(2000 / 1632.875) = 2.
    const plan = planLeadIn(ready(146.98, 0))!;
    expect(plan.bars).toBe(2);
    expect(plan.padMs).toBeCloseTo(2 * barMs(146.98), 1);
  });

  it('tops an already-silent song up to the next bar line, not a new lead-in', () => {
    // X ~= 8000 -> ceil(8000 / 1632.875) = 5 bars; P = 5 bars - X. X is
    // tick-quantized by the record, so it is read back rather than assumed.
    const doc = ready(146.98, 8000);
    const plan = planLeadIn(doc)!;
    expect(plan.bars).toBe(5);
    expect(plan.padMs).toBeCloseTo(
      5 * barMs(146.98) - songStartAudioMs(doc)!,
      6,
    );
  });

  it('keeps every event at or after tick 0', () => {
    // A pickup 500 ms before the song start: P must reach 500 ms at least.
    const doc = ready(120, 500);
    addNote(doc, 0);
    const plan = planLeadIn(doc)!;
    expect(plan.padMs).toBeGreaterThanOrEqual(500);
  });

  it('is a ceil, never a nearest', () => {
    // X just over one bar must give two bars, not one.
    const plan = planLeadIn(ready(120, 2010))!;
    expect(plan.bars).toBe(2);
  });

  it('7/8 and 5/4 bars are whole bars of that meter', () => {
    for (const [num, den] of [
      [7, 8],
      [5, 4],
    ] as const) {
      const doc = ready(120, 0, [num, den]);
      const plan = planLeadIn(doc)!;
      expect(plan.padMs).toBeCloseTo(plan.bars * barMs(120, num, den), 0);
      expect(plan.padMs).toBeGreaterThanOrEqual(LEAD_MIN_MS);
    }
  });

  it('still adds whole bars with no song start, and never trims', () => {
    // Nothing has said where the music is, so `X` is taken as 0: the pad can
    // only grow. Trimming the front of a recording whose music we cannot
    // locate is the one thing this must not do.
    const plan = planLeadIn(makeDoc(120))!;
    expect(plan.bars).toBe(1);
    expect(plan.padMs).toBeCloseTo(barMs(120), 1);
    expect(plan.padMs).toBeGreaterThan(0);
  });

  it('trims when an explicit count asks for less than the silence there', () => {
    // 8 s of silence in front, and the user asks for one bar. The anchor is
    // signed, so the answer is a negative pad — 4.7 s comes off the front —
    // not a refusal. The music is still a whole bar into the padded audio.
    const doc = ready(146.98, 8000);
    const X = songStartAudioMs(doc)!;
    const plan = planLeadIn(doc, 1)!;
    expect(plan.bars).toBe(1);
    expect(plan.padMs).toBeLessThan(0);
    expect(plan.padMs).toBeCloseTo(barMs(146.98) - X, 6);
    expect(plan.padMs + X).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The pad is absolute
// ---------------------------------------------------------------------------

describe('the pad is absolute, and the bar count accumulates', () => {
  it('a second press adds exactly one bar, not another whole pad', () => {
    const first = planLeadIn(ready(120, 0))!;
    const padded = applyLeadIn(ready(120, 0), first);
    expect(leadInBars(padded)).toBeCloseTo(first.bars, 6);
    expect(getSongStartTick(padded)).toBe(first.bars * 4 * RES);

    const second = planLeadIn(padded, first.bars + 1)!;
    // Absolute: the second plan's pad is the whole silence, one bar more
    // than the first. The chart shift is derived at apply time from the doc.
    expect(second.padMs - first.padMs).toBeCloseTo(barMs(120), 1);
    expect(second.padMs).toBeCloseTo((first.bars + 1) * barMs(120), 1);
  });

  it('re-planning at the same bar count is a no-op', () => {
    const doc = ready(120, 0);
    const plan = planLeadIn(doc)!;
    const padded = applyLeadIn(doc, plan);
    expect(planLeadIn(padded, plan.bars)).toBeNull();
  });

  it('shrinks the pad when the bar count goes down', () => {
    const doc = ready(120, 0);
    const two = planLeadIn(doc, 2)!;
    const padded = applyLeadIn(doc, two);
    const one = planLeadIn(padded, 1)!;
    expect(one.padMs).toBeLessThan(two.padMs);
    expect(two.padMs - one.padMs).toBeCloseTo(barMs(120), 1);
  });

  it('the anchor is set to the pad, never added to it', () => {
    const doc = ready(120, 0);
    const first = applyLeadIn(doc, planLeadIn(doc)!);
    const second = applyLeadIn(first, planLeadIn(first, 3)!);
    expect(getAudioAnchor(second)!.ms).toBeCloseTo(3 * barMs(120), 1);
  });
});

// ---------------------------------------------------------------------------
// The audio position of the music never moves
// ---------------------------------------------------------------------------

describe('the audio-position invariant', () => {
  /** A note's position in the ORIGINAL audio: chart ms minus the pad. */
  const audioPositions = (doc: ChartDocument) => {
    const pad = getAudioAnchor(doc)?.ms ?? 0;
    return noteMs(doc).map(ms => ms - pad);
  };

  it('holds across a press, a second press and a shrink', () => {
    const doc = ready(120, 0);
    addNote(doc, RES * 4);
    addNote(doc, RES * 8);
    const before = audioPositions(doc);

    const bars1 = Math.round(leadInBars(applyLeadIn(doc, planLeadIn(doc)!))!);
    const one = applyLeadIn(doc, planLeadIn(doc)!);
    const two = applyLeadIn(one, planLeadIn(one, bars1 + 1)!);
    const back = applyLeadIn(two, planLeadIn(two, bars1)!);

    // One tick of tolerance: every apply re-ticks and retimes from the
    // rounded tick, so the equality is a tick equality, not an ms one.
    const tickMs = 60000 / 120 / RES;
    for (const after of [one, two, back]) {
      const now = audioPositions(after);
      expect(now).toHaveLength(before.length);
      now.forEach((ms, i) =>
        expect(Math.abs(ms - before[i])).toBeLessThan(tickMs),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The emitted opening
// ---------------------------------------------------------------------------

describe('the emitted opening', () => {
  it('puts one real tempo and the opening meter at tick 0', () => {
    const doc = ready(146.98, 100);
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    const chart = after.parsedChart;
    expect(chart.tempos[0].tick).toBe(0);
    expect(chart.tempos[0].beatsPerMinute).toBeCloseTo(146.98, 2);
    expect(chart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
  });

  it('lands the song start exactly on a bar line', () => {
    for (const [bpm, X] of [
      [146.98, 100],
      [120, 0],
      [93.5, 3120],
    ] as const) {
      const doc = ready(bpm, X);
      const plan = planLeadIn(doc)!;
      const after = applyLeadIn(doc, plan);
      const barTicks = 4 * RES;
      const songStartTick = plan.bars * barTicks;
      // The song start's chart ms is the pad plus X, and it must tick to a
      // whole number of bars under the emitted grid.
      const chart = after.parsedChart;
      const msPerTick = 60000 / chart.tempos[0].beatsPerMinute / RES;
      expect(songStartTick * msPerTick).toBeCloseTo(
        plan.padMs + songStartAudioMs(doc)!,
        0,
      );
    }
  });

  it('drops the writer construct in front of the song start', () => {
    // A collapse marker at tick 0 and the real tempo just after it.
    const doc = makeDoc(20000);
    addTempo(doc, 1, 146.98);
    retimeChart(doc.parsedChart);
    // The song start is the real tempo's own tick, so the opening is read
    // there and not off the collapse marker at tick 0.
    const withStart = setSongStartTick(doc, 1);
    const plan = planLeadIn(withStart)!;
    expect(plan.newSync.tempos[0].bpm).toBeCloseTo(146.98, 2);
    const after = applyLeadIn(withStart, plan);
    expect(after.parsedChart.tempos.every(t => t.beatsPerMinute < 5000)).toBe(
      true,
    );
    expect(plan.droppedTempos).toBeGreaterThan(0);
  });

  it('never drops a note', () => {
    const doc = ready(120, 1000);
    addNote(doc, 0);
    addNote(doc, RES * 4);
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    expect(after.parsedChart.trackData[0].noteEventGroups.flat()).toHaveLength(
      2,
    );
  });
});
