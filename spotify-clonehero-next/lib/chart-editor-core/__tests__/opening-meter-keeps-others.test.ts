/**
 * Editing the opening meter leaves other signatures alone (plan 0124 step 6).
 *
 * Reported 2026-08-24: with a 4/4 added at the song-start flag, setting the
 * tick-0 meter to 3/4 deleted the signature at the flag and left tick 0 on
 * 4/4 — the edit was silently reverted and a marker was destroyed.
 *
 * Cause: the meter edit re-emitted the opening, which keeps only what is
 * strictly AFTER the song start and rewrites tick 0 from the meter in force
 * there. A meter carries no timing, so it has no business re-emitting
 * anything.
 */

import {AddTimeSignatureCommand} from '../commands';
import {
  addTimeSignature,
  applyDocSidecars,
  createEmptyChart,
  getAudioAnchor,
  retimeChart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';

const RES = 192;
const BAR = RES * 4;

/** 4/4 at tick 0, a song start two bars in with its own 4/4, and a lead-in. */
function chartWithMeterAtFlag(withLeadIn: boolean): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 120,
    resolution: RES,
  });
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  addTimeSignature(doc, BAR * 2, 4, 4);
  retimeChart(parsedChart);

  const songStartMs = 2 * 4 * (60000 / 120);
  return applyDocSidecars(doc, {
    songStart: {audioMs: songStartMs},
    ...(withLeadIn ? {leadIn: {bars: 2}} : {}),
  });
}

/** The flag a little AHEAD of the signature at that bar — the few-pixel gap
 *  a drag can leave. This is the shape that let the emit eat the signature:
 *  it sat before the song start, so "keep only what is strictly after" threw
 *  it away, and tick 0 was rewritten from the meter in force there. */
function chartWithFlagPastTheMeter(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 120,
    resolution: RES,
  });
  parsedChart.trackData.push(emptyTrackData('drums', 'expert'));
  const doc: ChartDocument = {parsedChart, assets: []};
  retimeChart(parsedChart);
  addTimeSignature(doc, BAR * 2, 4, 4);
  retimeChart(parsedChart);

  const meterMs = 2 * 4 * (60000 / 120);
  return applyDocSidecars(doc, {
    audioAnchor: {tick: 0, ms: 1000},
    // 40 ms past the signature, and 1000 ms of that is pad.
    songStart: {audioMs: meterMs + 40 - 1000},
    leadIn: {bars: 2},
  });
}

describe('AddTimeSignatureCommand at tick 0 with the song start just past the signature', () => {
  it('keeps the signature and the edit', () => {
    const before = chartWithFlagPastTheMeter();
    const after = new AddTimeSignatureCommand(0, 3, 4).execute(before);

    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 3,
      denominator: 4,
    });
    expect(
      after.parsedChart.timeSignatures.find(ts => ts.tick === BAR * 2),
    ).toMatchObject({numerator: 4, denominator: 4});
    expect(getAudioAnchor(after)!.ms).toBe(1000);
  });
});

describe.each([
  ['with a lead-in', true],
  ['without one', false],
])('AddTimeSignatureCommand at tick 0 %s', (_label, withLeadIn) => {
  it('writes the meter the user asked for', () => {
    const after = new AddTimeSignatureCommand(0, 3, 4).execute(
      chartWithMeterAtFlag(withLeadIn),
    );
    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 3,
      denominator: 4,
    });
  });

  it('leaves the signature at the song start where it is', () => {
    const after = new AddTimeSignatureCommand(0, 3, 4).execute(
      chartWithMeterAtFlag(withLeadIn),
    );
    expect(
      after.parsedChart.timeSignatures.find(ts => ts.tick === BAR * 2),
    ).toMatchObject({numerator: 4, denominator: 4});
  });

  it('moves nothing: a meter carries no timing', () => {
    const before = chartWithMeterAtFlag(withLeadIn);
    const after = new AddTimeSignatureCommand(0, 3, 4).execute(before);
    expect(getAudioAnchor(after)?.ms ?? 0).toBe(
      getAudioAnchor(before)?.ms ?? 0,
    );
  });
});
