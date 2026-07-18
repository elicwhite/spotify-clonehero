/**
 * Parity gate for the SHIPPED reach-extension lever (ks-warp.ts's warpGridReach /
 * warpGridWindowed / postsnapNoteMedian) against the Python reference
 * (drum-to-chart analysis/product_pipeline/levers/kick_snare_warp_reach.py), fixtures
 * dumped by analysis/product_pipeline/export_kswarp_reach_fixtures.py.
 *
 * Each fixture carries: the pre-warp incumbent grid, the kick+snare onset times (ms)
 * used as warp targets, ALL decoded onset times (ms, any lane — what the post-snap
 * note_ms guard scores), and the expected output: either a warped grid
 * (gate-admitted AND guard-accepted songs) or `null` (gate-never-fired OR
 * gate-fired-but-guard-rejected songs, where the shipped reach sidecar's entry is
 * byte-identical to the incumbent — the export script asserts this at generation
 * time). See index.json for which case each fixture covers.
 *
 * Tolerance: 1e-6 ms/bpm (toBeCloseTo digits=6) — same convention as ks-warp.test.ts's
 * d5 parity gate (numpy float64 vs JS float64, differing summation order across a
 * comb-fit/warp/snap/phase-align pipeline; 1e-6 comfortably clears that noise floor
 * without losing sensitivity to a real algorithmic mismatch).
 */

import {readFileSync} from 'fs';
import path from 'path';
import {warpGridReach, DEFAULT_KS_WARP_CONFIG} from '../ks-warp';
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
