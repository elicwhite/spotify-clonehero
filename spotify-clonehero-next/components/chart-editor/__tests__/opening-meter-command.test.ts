/**
 * SetOpeningMeterCommand (plan 0124 step 6): the recovery path for the 4/4
 * default, and the one place the "a meter edit must recompute the pad" rule
 * is enforced.
 */

import {AddLeadingSilenceCommand, SetOpeningMeterCommand} from '../commands';
import {
  getAudioAnchor,
  getLeadIn,
  planLeadIn,
  setOpening,
  setSongStart,
  type ChartDocument,
} from '@/lib/chart-edit';
import {makeFixtureDoc} from './fixtures';

/** The fixture, padded, with a known opening so the bar length is exact. */
function padded(bpm = 146.98, audioMs = 100): ChartDocument {
  const doc = setSongStart(
    setOpening(makeFixtureDoc(), {
      bpm,
      meter: {numerator: 4, denominator: 4},
    }),
    {audioMs},
  );
  const plan = planLeadIn(doc)!;
  return new AddLeadingSilenceCommand(plan).execute(doc);
}

const barMs = (bpm: number, num: number) => num * (60000 / bpm);

describe('SetOpeningMeterCommand', () => {
  it('writes the meter at tick 0, which no other command can do', () => {
    const after = new SetOpeningMeterCommand({
      numerator: 3,
      denominator: 4,
    }).execute(padded());
    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      tick: 0,
      numerator: 3,
      denominator: 4,
    });
  });

  it('resizes the pad, keeping the song start on a bar line', () => {
    // 4/4 at 146.98, X = 100, N = 2 -> P = 3165.75.
    const before = padded();
    expect(getAudioAnchor(before)!.ms).toBeCloseTo(
      2 * barMs(146.98, 4) - 100,
      0,
    );

    // 3/4 at the same bar count -> P = 2349.31, not the old pad.
    const after = new SetOpeningMeterCommand({
      numerator: 3,
      denominator: 4,
    }).execute(before);
    expect(getLeadIn(after)!.bars).toBe(2);
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(
      2 * barMs(146.98, 3) - 100,
      0,
    );
  });

  it('keeps the song start a whole number of bars from tick 0', () => {
    const after = new SetOpeningMeterCommand({
      numerator: 3,
      denominator: 4,
    }).execute(padded());
    const {resolution, tempos} = after.parsedChart;
    const msPerTick = 60000 / tempos[0].beatsPerMinute / resolution;
    const songStartMs = getAudioAnchor(after)!.ms + 100;
    const barTicks = 3 * resolution;
    const songStartTick = songStartMs / msPerTick;
    expect(songStartTick / barTicks).toBeCloseTo(2, 3);
  });

  it('does nothing when the meter is already what was asked for', () => {
    const before = padded();
    expect(
      new SetOpeningMeterCommand({numerator: 4, denominator: 4}).execute(
        before,
      ),
    ).toBe(before);
  });

  it('writes the meter with no lead-in to resize', () => {
    const doc = makeFixtureDoc();
    const after = new SetOpeningMeterCommand({
      numerator: 7,
      denominator: 8,
    }).execute(doc);
    expect(after.parsedChart.timeSignatures[0]).toMatchObject({
      numerator: 7,
      denominator: 8,
    });
    expect(getAudioAnchor(after)).toBeNull();
  });
});
