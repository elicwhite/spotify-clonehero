/**
 * Regenerating a tempo map on a padded chart (plan 0124 step 7).
 *
 * The assist task measures the map on the ORIGINAL audio, while the chart
 * lives in the padded frame. Installing it unshifted puts every tempo change
 * one pad early — measured before this was fixed: on a doc padded 2000 ms, a
 * change the pipeline saw at 4000 ms landed at chart ms 4000, which is 2000
 * ms into the audio.
 */

import {AddLeadingSilenceCommand, ReplaceTempoMapCommand} from '../commands';
import {
  applyDocSidecars,
  getAudioAnchor,
  getLeadIn,
  getOpening,
  planLeadIn,
  setOpening,
  setSongStart,
  type ChartDocument,
} from '@/lib/chart-edit';
import type {Synctrack} from '@/lib/tempo-map/types';
import {makeFixtureDoc} from './fixtures';

/** A map as the pipeline measures it: original-audio time, no construct. */
const FRESH: Synctrack = {
  origin_ms: 0,
  tempos: [
    {ms: 0, bpm: 120},
    {ms: 4000, bpm: 60},
  ],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

/** The fixture with a song start at 0 and a two-bar lead-in applied. */
function paddedDoc(): ChartDocument {
  const doc = applyDocSidecars(makeFixtureDoc(), {
    songStart: {audioMs: 0},
    opening: {bpm: 120, meter: {numerator: 4, denominator: 4}},
  });
  const plan = planLeadIn(doc, 2)!;
  return new AddLeadingSilenceCommand(plan).execute(doc);
}

describe('ReplaceTempoMapCommand on a padded chart', () => {
  it('shifts the incoming map into the padded frame', () => {
    const before = paddedDoc();
    const pad = getAudioAnchor(before)!.ms;
    expect(pad).toBeGreaterThan(0);

    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    const changed = after.parsedChart.tempos.find(
      t => Math.abs(t.beatsPerMinute - 60) < 1e-6,
    );
    // The pipeline saw the change 4000 ms into the audio, so in the padded
    // chart it belongs at 4000 + pad.
    expect(changed).toBeDefined();
    expect(changed!.msTime).toBeCloseTo(4000 + getAudioAnchor(after)!.ms, 0);
  });

  it('emits the opening, so the writer manufactures no new lead-in', () => {
    const after = new ReplaceTempoMapCommand(FRESH).execute(paddedDoc());
    const chart = after.parsedChart;
    expect(chart.tempos[0].tick).toBe(0);
    expect(chart.tempos[0].msTime).toBe(0);
    expect(chart.timeSignatures[0].tick).toBe(0);
    // One tempo before the song start, and it is the real one.
    expect(chart.tempos[0].beatsPerMinute).toBeCloseTo(120, 3);
  });

  it('keeps the song start, the lead-in and the recomputed pad', () => {
    const before = paddedDoc();
    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    expect(getLeadIn(after)).toEqual({bars: 2});
    expect(getOpening(after)).toEqual({
      bpm: 120,
      meter: {numerator: 4, denominator: 4},
    });
    // The song start is the user's statement; a new map does not know it.
    expect((after as {songStart?: {audioMs: number} | null}).songStart).toEqual(
      {audioMs: 0},
    );
    // Two bars at the map's own opening tempo.
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(4000, 0);
  });

  it('leaves an unpadded chart alone', () => {
    const before = setSongStart(
      setOpening(makeFixtureDoc(), {
        bpm: 120,
        meter: {numerator: 4, denominator: 4},
      }),
      {audioMs: 0},
    );
    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    expect(getAudioAnchor(after)).toBeNull();
    expect(getLeadIn(after)).toBeNull();
  });
});
