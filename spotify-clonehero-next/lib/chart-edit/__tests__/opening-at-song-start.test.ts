/**
 * The opening is the tempo and meter AT THE SONG START (plan 0124).
 *
 * Regression for a chart shaped like the one in the 2026-08-23 report:
 *
 *     tick 0   3/4  168.4   <- the writer's / predictor's opening
 *     bar 4    4/4  150.5   <- where the music actually starts
 *     bar 9         149.2
 *
 * Reading the opening at tick 0 instead of at the song start deleted the
 * 4/4 and the 150.5 — the emit keeps only what is strictly after the song
 * start, and re-emitted 3/4 at 168.4 over the top — so the whole song played
 * on the intro's grid.
 */

import type {ChartDocument} from '../types';
import {
  addTempo,
  addTimeSignature,
  createEmptyChart,
  retimeChart,
} from '../index';
import {emptyTrackData} from './test-utils';
import {
  applyDocSidecars,
  applyLeadIn,
  planLeadIn,
  resolveOpening,
} from '../leading-silence';

const RES = 192;
const BAR3_4 = RES * 3;

/** The reported chart: an intro in 3/4 at 168.4, the song in 4/4 at 150.5. */
function reportedChart(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 168.4,
    resolution: RES,
  });
  parsedChart.timeSignatures[0] = {
    ...parsedChart.timeSignatures[0],
    numerator: 3,
    denominator: 4,
  };
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);

  const songStartTick = BAR3_4 * 3; // bar 4
  addTimeSignature(doc, songStartTick, 4, 4);
  addTempo(doc, songStartTick, 150.5);
  addTempo(doc, songStartTick + RES * 4 * 5, 149.2);
  retimeChart(parsedChart);

  const songStartMs = parsedChart.tempos.find(
    t => t.tick === songStartTick,
  )!.msTime;
  return applyDocSidecars(doc, {songStart: {audioMs: songStartMs}});
}

describe('resolveOpening with a song start', () => {
  it('reads the tempo and meter at the song start, not at tick 0', () => {
    expect(resolveOpening(reportedChart())).toEqual({
      bpm: 150.5,
      meter: {numerator: 4, denominator: 4},
    });
  });
});

describe('the emitted opening for that chart', () => {
  it('carries the song start’s own tempo and meter to tick 0', () => {
    const doc = reportedChart();
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    expect(after.parsedChart.tempos[0].beatsPerMinute).toBeCloseTo(150.5, 1);
    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
  });

  it('keeps the later tempo change', () => {
    const doc = reportedChart();
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    expect(
      after.parsedChart.tempos.some(
        t => Math.abs(t.beatsPerMinute - 149.2) < 0.05,
      ),
    ).toBe(true);
  });

  it('does not leave the intro’s tempo governing the song', () => {
    const doc = reportedChart();
    const after = applyLeadIn(doc, planLeadIn(doc)!);
    expect(
      after.parsedChart.tempos.some(
        t => Math.abs(t.beatsPerMinute - 168.4) < 0.05,
      ),
    ).toBe(false);
  });
});
