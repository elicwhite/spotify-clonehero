/**
 * Setting the song start on a project padded by the old model (plan 0124
 * step 8).
 *
 * Those projects have an anchor and no bar count. The count is back-derived
 * from the pad they already have, so the first gesture does not resize a
 * lead-in the user is happy with. The rounding still moves the pad, and the
 * amount is bounded rather than hidden.
 */

import {SetSongStartCommand} from '../commands';
import {
  applyDocSidecars,
  getAudioAnchor,
  getLeadIn,
  type ChartDocument,
} from '@/lib/chart-edit';
import {makeFixtureDoc} from './fixtures';

/** The fixture (120 BPM, 4/4 — a 2000 ms bar) with a pad and no bar count. */
function legacyPadded(padMs: number): ChartDocument {
  return applyDocSidecars(makeFixtureDoc(), {
    audioAnchor: {tick: 0, ms: padMs},
    opening: {bpm: 120, meter: {numerator: 4, denominator: 4}},
  });
}

describe('SetSongStartCommand on a project padded before this feature', () => {
  it('back-derives the bar count from the pad it already has', () => {
    // 4000 ms of pad at a 2000 ms bar is exactly two bars, so nothing moves.
    const after = new SetSongStartCommand(0).execute(legacyPadded(4000));
    expect(getLeadIn(after)).toEqual({bars: 2});
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(4000, 0);
  });

  it('rounds a pad that is not whole bars, and the move is bounded', () => {
    // 3000 ms rounds to 2 bars = 4000 ms: half a bar, the worst case when
    // the bounds already hold.
    const after = new SetSongStartCommand(0).execute(legacyPadded(3000));
    expect(getLeadIn(after)).toEqual({bars: 2});
    expect(getAudioAnchor(after)!.ms).toBeCloseTo(4000, 0);
  });

  it('clamps a pad that rounds to no bars at all', () => {
    // 500 ms rounds to 0 bars, which the model has no meaning for. The
    // bounds raise it, and the pad moves further than half a bar.
    const after = new SetSongStartCommand(0).execute(legacyPadded(500));
    expect(getLeadIn(after)!.bars).toBeGreaterThanOrEqual(1);
    expect(getAudioAnchor(after)!.ms).toBeGreaterThanOrEqual(2000);
  });

  it('adds no lead-in to a project that never had one', () => {
    const after = new SetSongStartCommand(1500).execute(makeFixtureDoc());
    expect(getLeadIn(after)).toBeNull();
    expect(getAudioAnchor(after)).toBeNull();
    expect((after as {songStart?: {audioMs: number} | null}).songStart).toEqual(
      {audioMs: 1500},
    );
  });
});
