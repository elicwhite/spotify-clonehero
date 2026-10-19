/**
 * Parity gate for the SHIPPED reach-extension lever (ks-warp.ts's warpGridReach /
 * warpGridWindowed / postsnapNoteMedian / partialOriginRevert) against the Python
 * reference (drum-to-chart analysis/product_pipeline/levers/kick_snare_warp_reach.py),
 * fixtures dumped by analysis/product_pipeline/export_kswarp_reach_fixtures.py.
 *
 * Each fixture carries: the pre-warp incumbent grid, the kick+snare onset times (ms)
 * used as warp targets, ALL decoded onset times (ms, any lane — what the post-snap
 * note_ms guard scores), and the expected output: either a warped grid
 * (gate-admitted AND guard-accepted songs — some of which additionally exercise the
 * 2026-07-18 partial-origin-revert amendment, see `diag.origin_reverted_beats`) or
 * `null` (gate-never-fired OR gate-fired-but-guard-rejected songs, where the shipped
 * reach+pr sidecar's entry is byte-identical to the incumbent — the export script
 * asserts this at generation time). See index.json for which case each fixture covers.
 *
 * Tolerance: 1e-6 ms/bpm (toBeCloseTo digits=6) — same convention as ks-warp.test.ts's
 * d5 parity gate (numpy float64 vs JS float64, differing summation order across a
 * comb-fit/warp/snap/phase-align pipeline; 1e-6 comfortably clears that noise floor
 * without losing sensitivity to a real algorithmic mismatch).
 *
 * ONE DELIBERATE DIVERGENCE. The Python reference's `rigid_collapse.anchored_beats`
 * stops enumerating beats at a fixed 240000 ms, so on a song longer than four
 * minutes it analysed (and rebuilt the grid over) only the first 4:00 and dropped
 * the rest. `anchoredBeats` here runs to the grid's own end instead — see its
 * docstring and ks-warp-long-song.test.ts. Fixtures whose incumbent grid ends past
 * ANCHORED_BEATS_MIN_MS therefore cannot match the reference dump byte-for-byte;
 * they assert full-song coverage instead, and are named in LONG_SONG_FIXTURES.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {
  warpGridReach,
  DEFAULT_KS_WARP_CONFIG,
  ANCHORED_BEATS_MIN_MS,
} from '../ks-warp';
import type {Synctrack} from '../types';

void DEFAULT_KS_WARP_CONFIG; // re-exported for readers cross-checking the shipped config

interface Fixture {
  song: string;
  admitted: boolean;
  incumbent_grid: Synctrack;
  ks_onsets_ms: number[];
  all_onsets_ms: number[];
  diag: Record<string, unknown>;
  expected_grid: Synctrack | null;
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'ks-warp-reach');

function loadIndex(): Array<{
  song: string;
  slug: string;
  admitted: boolean;
  file: string;
}> {
  return JSON.parse(
    readFileSync(path.join(FIXTURES_DIR, 'index.json'), 'utf8'),
  );
}

function loadFixture(file: string): Fixture {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));
}

function expectExactSynctrack(sync: Synctrack, expected: Synctrack) {
  expect(sync.origin_ms).toBeCloseTo(expected.origin_ms, 6);
  expect(sync.tempos.length).toBe(expected.tempos.length);
  for (let i = 0; i < expected.tempos.length; i++) {
    expect(sync.tempos[i].ms).toBeCloseTo(expected.tempos[i].ms, 6);
    expect(sync.tempos[i].bpm).toBeCloseTo(expected.tempos[i].bpm, 6);
  }
  expect(sync.timeSignatures.length).toBe(expected.timeSignatures.length);
  for (let i = 0; i < expected.timeSignatures.length; i++) {
    expect(sync.timeSignatures[i].ms).toBeCloseTo(
      expected.timeSignatures[i].ms,
      6,
    );
    expect(sync.timeSignatures[i].numerator).toBe(
      expected.timeSignatures[i].numerator,
    );
    expect(sync.timeSignatures[i].denominator).toBe(
      expected.timeSignatures[i].denominator,
    );
  }
}

/** ms past `origin_ms` the fixture's incumbent grid still carries tempos. */
function incumbentSpanMs(fixture: Fixture): number {
  const {tempos, origin_ms} = fixture.incumbent_grid;
  return Math.max(...tempos.map(t => t.ms)) - origin_ms;
}

describe('warpGridReach vs Python kick_snare_warp_reach.warp_grid_reach reference fixtures', () => {
  const index = loadIndex();
  expect(index.length).toBeGreaterThanOrEqual(3);
  expect(index.some(f => f.admitted)).toBe(true);
  expect(index.some(f => !f.admitted)).toBe(true);

  for (const entry of index) {
    test(`${entry.song} (admitted=${entry.admitted})`, () => {
      const fixture = loadFixture(entry.file);
      const {grid, diag} = warpGridReach(
        fixture.incumbent_grid,
        fixture.ks_onsets_ms,
        fixture.all_onsets_ms,
      );

      if (incumbentSpanMs(fixture) > ANCHORED_BEATS_MIN_MS) {
        // Reference-truncated song: the dump only ever covered the first 4:00,
        // so byte parity is not available. What must hold is that the grid the
        // app installs reaches the end of the song rather than stopping at the
        // reference's cap. (`reach-05` additionally flips to admitted here: the
        // one steady, drifted window in this song sits in the stretch the
        // reference never enumerated.)
        expect(grid).not.toBeNull();
        const warped = grid as Synctrack;
        const lastTempoMs = warped.tempos[warped.tempos.length - 1].ms;
        expect(lastTempoMs - warped.origin_ms).toBeGreaterThanOrEqual(
          incumbentSpanMs(fixture) - 1000,
        );
        return;
      }

      if (fixture.admitted) {
        expect(diag.admitted).toBe(true);
        expect(grid).not.toBeNull();
        expect(fixture.expected_grid).not.toBeNull();
        expectExactSynctrack(
          grid as Synctrack,
          fixture.expected_grid as Synctrack,
        );
        // partial-origin-revert (#113): the fixture's diag.origin_reverted_beats
        // (from the Python reference's warp_grid_reach) must match exactly —
        // 0 for songs the revert never touches, >0 for the 3 discriminating
        // reverted cases (reach-08 / reach-06 / reach-10).
        if (typeof fixture.diag['origin_reverted_beats'] === 'number') {
          expect(diag.originRevertedBeats).toBe(
            fixture.diag['origin_reverted_beats'],
          );
        }
      } else {
        expect(diag.admitted).toBe(false);
        expect(grid).toBeNull();
        expect(fixture.expected_grid).toBeNull();
      }
    });
  }
});
