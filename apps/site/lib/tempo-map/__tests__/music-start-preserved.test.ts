/**
 * `musicStartMs` must survive every grid transform (plan 0124 §1).
 *
 * The field is where the music starts, and it is set once — in
 * `beatsToSynctrack`, the only place in the pipeline that still holds the
 * downbeats. Everything between there and `ReplaceTempoMapCommand` is a GRID
 * transform: the KS warp, the reach revert, the octave rescale. Each replaces
 * the origin, the tempos and the signatures and has no opinion about anything
 * else.
 *
 * Each of them used to rebuild the object with a literal. That satisfies
 * `Synctrack` — the three required fields are all there — so the compiler said
 * nothing, and the field simply vanished on whichever runs the warp admitted.
 * The song start was then never recorded, on a data-dependent branch, with no
 * error anywhere. `withGrid` makes the preservation structural.
 */

import fs from 'fs';
import path from 'path';
import {warpGrid, DEFAULT_KS_WARP_CONFIG} from '../ks-warp';
import {octaveRescaleSync} from '../structural-correction';
import {withGrid, type Synctrack} from '../types';

const MUSIC_START = 1148.31;

describe('withGrid', () => {
  const sync: Synctrack = {
    origin_ms: 51,
    tempos: [{ms: 0, bpm: 120}],
    timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
    musicStartMs: MUSIC_START,
  };

  it('replaces the grid and keeps everything else', () => {
    const out = withGrid(sync, {
      origin_ms: 900,
      tempos: [{ms: 900, bpm: 90}],
      timeSignatures: [{ms: 900, numerator: 3, denominator: 4}],
    });
    expect(out.origin_ms).toBe(900);
    expect(out.tempos).toEqual([{ms: 900, bpm: 90}]);
    expect(out.musicStartMs).toBe(MUSIC_START);
  });

  it('leaves an absent field absent rather than inventing one', () => {
    const {musicStartMs: _drop, ...bare} = sync;
    expect(withGrid(bare, bare).musicStartMs).toBeUndefined();
  });
});

describe('octaveRescaleSync', () => {
  it('carries the music start through a ×2 rescale', () => {
    const out = octaveRescaleSync(
      {
        origin_ms: 51,
        tempos: [{ms: 0, bpm: 75}],
        timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
        musicStartMs: MUSIC_START,
      },
      2,
    );
    expect(out.tempos[0].bpm).toBe(150);
    expect(out.musicStartMs).toBe(MUSIC_START);
  });
});

describe('warpGrid', () => {
  // The same fixtures the warp's own golden test uses; this asserts only the
  // field, so it stays valid whatever the warp decides.
  const dir = path.join(__dirname, 'fixtures', 'ks-warp');
  const index = JSON.parse(
    fs.readFileSync(path.join(dir, 'index.json'), 'utf8'),
  ) as Array<{file: string; admitted: boolean}>;

  const admitted = index.find(e => e.admitted);
  it('has a fixture where the warp admits', () => {
    expect(admitted).toBeDefined();
  });

  it('carries the music start through a warp that admits', () => {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(dir, admitted!.file), 'utf8'),
    );
    const {grid, diag} = warpGrid(
      {...fixture.incumbent_grid, musicStartMs: MUSIC_START},
      fixture.ks_onsets_ms,
      DEFAULT_KS_WARP_CONFIG,
    );
    expect(diag.admitted).toBe(true);
    expect(grid).not.toBeNull();
    // The grid moved; the music start did not.
    expect(grid!.musicStartMs).toBe(MUSIC_START);
  });
});
