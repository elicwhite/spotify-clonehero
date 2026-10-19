/**
 * Parity gate for the KS-warp lever (ks-warp.ts) against the Python reference
 * (drum-to-chart analysis/product_pipeline/levers/kick_snare_warp.py), fixtures
 * dumped by analysis/product_pipeline/export_kswarp_fixtures.py.
 *
 * Each fixture carries: the pre-warp incumbent grid, the kick+snare onset times
 * (ms) independently decoded via the Python reference's own
 * `kick_snare_onsets`/`SF.decode("raw", ...)` (== the app's peak-picking.ts
 * contract — see ks-warp.ts's module docstring), and the expected output: either
 * a warped grid (gate-admitted songs) or `null` (gate-rejected songs, where the
 * shipped sidecar's entry is byte-identical to the incumbent — the export script
 * asserts this at generation time).
 *
 * Tolerance: 1e-6 ms/bpm (toBeCloseTo digits=6), matching the Python parity
 * gate's convention (parity_kick_snare_warp.py uses tol=1e-9 on float64
 * arithmetic entirely within numpy; this port additionally crosses a
 * numpy(float64)-vs-JS(float64) boundary through a different comb-fit/warp
 * code path — same IEEE-754 double precision, but summation order differs
 * (e.g. running sums for the linear-regression normal equations vs numpy's
 * pairwise-summation lstsq), so 1e-9 is tighter than the cross-implementation
 * float noise floor while 1e-6 comfortably clears it with no loss of
 * sensitivity to a real algorithmic mismatch.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {warpGrid, DEFAULT_KS_WARP_CONFIG} from '../ks-warp';
import type {Synctrack} from '../types';

interface Fixture {
  song: string;
  admitted: boolean;
  incumbent_grid: Synctrack;
  ks_onsets_ms: number[];
  diag: Record<string, unknown>;
  expected_grid: Synctrack | null;
}

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'ks-warp');

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

describe('warpGrid vs Python kick_snare_warp.warp_grid reference fixtures', () => {
  const index = loadIndex();
  expect(index.length).toBeGreaterThanOrEqual(3);
  expect(index.some(f => f.admitted)).toBe(true);
  expect(index.some(f => !f.admitted)).toBe(true);

  for (const entry of index) {
    test(`${entry.song} (admitted=${entry.admitted})`, () => {
      const fixture = loadFixture(entry.file);
      const {grid, diag} = warpGrid(
        fixture.incumbent_grid,
        fixture.ks_onsets_ms,
        DEFAULT_KS_WARP_CONFIG,
      );

      if (fixture.admitted) {
        expect(diag.admitted).toBe(true);
        expect(grid).not.toBeNull();
        expect(fixture.expected_grid).not.toBeNull();
        expectExactSynctrack(
          grid as Synctrack,
          fixture.expected_grid as Synctrack,
        );
      } else {
        expect(diag.admitted).toBe(false);
        expect(grid).toBeNull();
        expect(fixture.expected_grid).toBeNull();
      }
    });
  }
});
