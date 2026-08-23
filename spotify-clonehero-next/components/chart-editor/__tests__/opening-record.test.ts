/**
 * The opening record reaches the chart from every path that installs a
 * synctrack (plan 0124 step 1b).
 *
 * Without it, `resolveOpening` falls back to reading tick 0, which after the
 * writer has run is a stretched BPM, a partial bar, or a collapse marker. The
 * drum-transcription flow is the one that matters most: it reaches the editor
 * without passing through any editor command.
 */

import {ReplaceTempoMapCommand} from '../commands';
import {getOpening, resolveOpening, setSongStart} from '@/lib/chart-edit';
import type {Synctrack} from '@/lib/tempo-map/types';
import {makeFixtureDoc} from './fixtures';

const REAL: Synctrack = {
  origin_ms: 51,
  tempos: [{ms: 1623, bpm: 152.67}],
  timeSignatures: [{ms: 1623, numerator: 3, denominator: 4}],
};

describe('ReplaceTempoMapCommand', () => {
  it('records the incoming synctrack opening, not what lands at tick 0', () => {
    const after = new ReplaceTempoMapCommand(REAL).execute(makeFixtureDoc());
    expect(getOpening(after)).toEqual({
      bpm: 152.67,
      meter: {numerator: 3, denominator: 4},
    });
  });

  it('gives the pad the real tempo, and 4/4', () => {
    const after = new ReplaceTempoMapCommand(REAL).execute(
      setSongStart(makeFixtureDoc(), {audioMs: 0}),
    );
    expect(resolveOpening(after)).toEqual({
      bpm: 152.67,
      meter: {numerator: 4, denominator: 4},
    });
  });

  it('carries the song start and the lead-in across the swap', () => {
    const before = setSongStart(makeFixtureDoc(), {audioMs: 1234});
    const after = new ReplaceTempoMapCommand(REAL).execute(before);
    expect(resolveOpening(after).bpm).toBeCloseTo(152.67, 2);
    // The user's own statement about the song survives a regeneration: a new
    // map does not know where the music starts.
    expect((after as {songStart?: {audioMs: number} | null}).songStart).toEqual(
      {audioMs: 1234},
    );
  });
});
