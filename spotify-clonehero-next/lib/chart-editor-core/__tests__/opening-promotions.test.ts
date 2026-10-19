/**
 * Promoting the opening tempo and the opening meter (plan 0124 step 6).
 *
 * These are promotions, not deletions: `deriveTimeSignatures` always emits an
 * event at tick 0, so "no signature at tick 0" is not expressible, and every
 * other marker delete extends the PRECEDING segment forward while this
 * extends the successor backward. They get their own commands, and the five
 * tick-0 guards stay where they are.
 */

import {
  AddLeadingSilenceCommand,
  PromoteOpeningMeterCommand,
  PromoteOpeningTempoCommand,
} from '../commands';
import {
  addDrumNote,
  addTempo,
  addTimeSignature,
  createEmptyChart,
  makeChartTiming,
  applyDocSidecars,
  getAudioAnchor,
  leadInBars,
  planLeadIn,
  retimeChart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {makeFixtureDoc} from './fixtures';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {noteTypes} from '@eliwhite/scan-chart';

/** Note ticks, which a tempo promotion must not move. */
function ticks(doc: ChartDocument): number[] {
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => n.tick)
    .sort((a, b) => a - b);
}

/** A note's position in the ORIGINAL audio: chart ms minus the pad. */
function audioPositions(doc: ChartDocument): number[] {
  const pad = getAudioAnchor(doc)?.ms ?? 0;
  return doc.parsedChart.trackData[0].noteEventGroups
    .flat()
    .map(n => n.msTime - pad)
    .sort((a, b) => a - b);
}

const RES = 192;

/** A chart with exactly two tempo markers: a synthetic A at tick 0 and the
 *  real B at the bar the song start lands on, with a lead-in already
 *  applied. Built from scratch rather than from the shared fixture, which
 *  carries a tempo change of its own. */
function withSyntheticOpening(A: number, B: number, bars: number) {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: A,
    resolution: RES,
  });
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  for (const tick of [bars * 4 * RES, bars * 4 * RES + RES * 4]) {
    addDrumNote(
      parsedChart.trackData[0],
      {tick, type: noteTypes.redDrum},
      makeChartTiming(parsedChart),
    );
  }
  retimeChart(parsedChart);

  const base = applyDocSidecars(doc, {songStartTick: 0});
  const padded = new AddLeadingSilenceCommand(planLeadIn(base, bars)!).execute(
    base,
  );
  addTempo(padded, bars * 4 * RES, B);
  retimeChart(padded.parsedChart);
  return padded;
}

describe('PromoteOpeningTempoCommand', () => {
  it('makes the next marker govern from the start', () => {
    const before = withSyntheticOpening(90, 120, 2);
    const after = new PromoteOpeningTempoCommand().execute(before);
    expect(after.parsedChart.tempos[0].beatsPerMinute).toBeCloseTo(120, 3);
    // One tempo now, not two: the promoted value governs the whole opening.
    expect(
      after.parsedChart.tempos.filter(t => t.beatsPerMinute !== 120),
    ).toHaveLength(0);
  });

  it('keeps every beat where it was', () => {
    const before = withSyntheticOpening(90, 120, 2);
    expect(ticks(new PromoteOpeningTempoCommand().execute(before))).toEqual(
      ticks(before),
    );
  });

  it('absorbs the time shift in the pad, so the music stays on its audio', () => {
    // The promoted marker IS the song start's, so the pad recompute equals
    // the shift exactly: delta = N * (barMs_new - barMs_old) = P_new - P_old.
    const before = withSyntheticOpening(90, 120, 2);
    const after = new PromoteOpeningTempoCommand().execute(before);
    const beforePositions = audioPositions(before);
    audioPositions(after).forEach((ms, i) =>
      expect(Math.abs(ms - beforePositions[i])).toBeLessThan(2),
    );
    expect(leadInBars(after)).toBeCloseTo(2, 6);
  });

  it('does nothing when there is no later marker to promote', () => {
    const doc = makeFixtureDoc();
    doc.parsedChart.tempos = [doc.parsedChart.tempos[0]];
    expect(new PromoteOpeningTempoCommand().execute(doc)).toBe(doc);
  });
});

describe('PromoteOpeningMeterCommand', () => {
  function withLaterMeter(numerator: number) {
    const doc = applyDocSidecars(makeFixtureDoc(), {songStartTick: 0});
    addTimeSignature(doc, doc.parsedChart.resolution * 8, numerator, 4);
    retimeChart(doc.parsedChart);
    return doc;
  }

  it('puts the promoted meter at tick 0 and writes no short measure', () => {
    const after = new PromoteOpeningMeterCommand().execute(withLaterMeter(5));
    expect(after.parsedChart.timeSignatures.map(ts => ts.tick)).toEqual([0]);
    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      numerator: 5,
      denominator: 4,
    });
  });

  it('retimes no note: a meter carries no timing', () => {
    const before = withLaterMeter(5);
    const after = new PromoteOpeningMeterCommand().execute(before);
    expect(ticks(after)).toEqual(ticks(before));
    expect(audioPositions(after)).toEqual(audioPositions(before));
  });

  it('does nothing when there is no later signature to promote', () => {
    const doc = makeFixtureDoc();
    expect(new PromoteOpeningMeterCommand().execute(doc)).toBe(doc);
  });
});
