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
  getSongStartTick,
  leadInBars,
  planLeadIn,
  type ChartDocument,
} from '@/lib/chart-edit';
// The raw setter is module-private on purpose: production code must go
// through `recordSongStart`, which snaps. Tests want the unsnapped value.
import {setSongStartTick} from '@/lib/chart-edit/leading-silence';
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
  musicStartMs: 0,
};

/** The fixture with a song start at 0 and a two-bar lead-in applied. */
function paddedDoc(): ChartDocument {
  const doc = applyDocSidecars(makeFixtureDoc(), {songStartTick: 0});
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

  it('keeps the pad exactly as it was: a new map is not a re-pad', () => {
    const before = paddedDoc();
    const padBefore = getAudioAnchor(before)!.ms;
    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    // Nothing recomputes on its own (plan 0124). The lead-in may stop being
    // whole bars, and the card reports that rather than the editor moving
    // the chart underneath the user.
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(padBefore, 6);
    expect(leadInBars(after)).toBeCloseTo(2, 6);
  });

  it('records where the new map says the music starts', () => {
    const before = paddedDoc();
    const pad = getAudioAnchor(before)!.ms;
    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    // `musicStartMs` is 0 in the ORIGINAL audio, so in the padded chart the
    // music starts at the pad — which is two bars of 120 BPM 4/4 in.
    const chart = after.parsedChart;
    expect(getSongStartTick(after)).toBe(2 * 4 * chart.resolution);
    expect(pad).toBeCloseTo(4000, 0);
  });

  it('leaves an unpadded chart alone', () => {
    const before = setSongStartTick(makeFixtureDoc(), 0);
    const after = new ReplaceTempoMapCommand(FRESH).execute(before);
    expect(getAudioAnchor(after)).toBeNull();
    expect(getSongStartTick(after)).toBe(0);
  });
});
