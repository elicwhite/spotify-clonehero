/**
 * Regression gate: the KS-warp stage must never truncate a long song.
 *
 * `warpGridWindowed` rebuilds the entire synctrack out of `anchoredBeats`'s
 * beat array, so any bound on that enumeration becomes a bound on the tempo
 * map the app installs. The Python reference's fixed 240000 ms budget did
 * exactly that: on a song longer than four minutes, an admitted warp returned
 * a grid whose last tempo event sat at 4:00 and the rest of the song had no
 * tempo markers at all (bug report 2026-08-05, a 288 s song whose diamonds
 * stopped near bar 113 — beat 452 of a 113 BPM song is 240 s).
 *
 * The invariant here is coverage, not a specific marker count: whatever the
 * gate decides, the grid that comes out reaches the end of the grid that went
 * in.
 */

import {
  anchoredBeats,
  warpGridWindowed,
  warpGridReach,
  ANCHORED_BEATS_MIN_MS,
} from '../ks-warp';
import {finalizeSynctrack} from '../finalize-synctrack';
import type {Synctrack} from '../types';

/** Comfortably past the reference's four-minute budget. */
const SONG_MS = 300_000;
const ORIGIN_MS = 500;
const TRUE_BPM = 132;
/** The incumbent runs marginally fast, so it drifts off the real beats — the
 *  drift KS-warp exists to correct. */
const INCUMBENT_BPM = 132.25;

function spanMs(sync: Synctrack): number {
  return Math.max(...sync.tempos.map(t => t.ms)) - sync.origin_ms;
}

/** A near-constant-tempo incumbent grid covering the whole song. */
function incumbentGrid(): Synctrack {
  const beatMs = 60_000 / INCUMBENT_BPM;
  const tempos = [];
  for (let ms = ORIGIN_MS; ms < SONG_MS; ms += beatMs * 16) {
    tempos.push({ms, bpm: INCUMBENT_BPM});
  }
  return {
    origin_ms: ORIGIN_MS,
    tempos,
    timeSignatures: [{ms: ORIGIN_MS, numerator: 4, denominator: 4}],
  };
}

/** Kick/snare onsets on the song's real beats, with sub-millisecond jitter so
 *  the comb fit is not degenerate. */
function trueBeatOnsetsMs(): number[] {
  const beatMs = 60_000 / TRUE_BPM;
  const onsets: number[] = [];
  for (let i = 0; ORIGIN_MS + i * beatMs < SONG_MS; i++) {
    onsets.push(ORIGIN_MS + i * beatMs + 0.4 * Math.sin(i * 1.7));
  }
  return onsets;
}

describe('KS-warp on a song longer than the reference beat budget', () => {
  const sync = incumbentGrid();

  test('the fixture really is longer than the old fixed budget', () => {
    expect(spanMs(sync)).toBeGreaterThan(ANCHORED_BEATS_MIN_MS);
  });

  test('anchoredBeats enumerates past the grid, not past a constant', () => {
    const {beats, origin} = anchoredBeats(sync);
    expect(beats[0]).toBeCloseTo(ORIGIN_MS, 6);
    expect(origin).toBe(ORIGIN_MS);
    expect(beats[beats.length - 1] - origin).toBeGreaterThanOrEqual(
      spanMs(sync),
    );
  });

  test('an admitted windowed warp returns a grid covering the whole song', () => {
    const {grid, diag} = warpGridWindowed(sync, trueBeatOnsetsMs());
    expect(diag.admitted).toBe(true);
    expect(grid).not.toBeNull();
    expect(spanMs(grid as Synctrack)).toBeGreaterThanOrEqual(
      spanMs(sync) - 60_000 / TRUE_BPM,
    );
  });

  test('warpGridReach covers the whole song when it admits', () => {
    const onsets = trueBeatOnsetsMs();
    const {grid} = warpGridReach(sync, onsets, onsets);
    if (grid !== null) {
      expect(spanMs(grid)).toBeGreaterThanOrEqual(
        spanMs(sync) - 60_000 / TRUE_BPM,
      );
    }
  });

  test('finalizeSynctrack never shortens the grid it was given', () => {
    const events = trueBeatOnsetsMs().map((ms, i) => ({
      timeSeconds: ms / 1000,
      drumClass: i % 2 === 0 ? 'BD' : 'SD',
    }));
    const out = finalizeSynctrack(sync, events);
    expect(spanMs(out)).toBeGreaterThanOrEqual(
      spanMs(sync) - 60_000 / TRUE_BPM,
    );
  });
});
