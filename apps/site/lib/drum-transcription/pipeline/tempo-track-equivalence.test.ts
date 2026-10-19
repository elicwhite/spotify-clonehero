/**
 * The no-drift guarantee behind the /tempo <-> /drum-transcription
 * unification: both features finalize a predicted Synctrack by calling the
 * SAME function (finalizeSynctrack, lib/tempo-map/finalize-synctrack.ts) on
 * the SAME (rawSynctrack, events) pair — /drum-transcription via
 * chart-builder.ts's buildChartDocument, /tempo via tempo-track.ts's
 * runTempoTrack(FromPcm).
 *
 * finalizeSynctrack is wrapped in a pass-through mock, so each case asserts
 * two things about a single buildChartDocument call:
 *
 *   1. the shared function is the one that ran, exactly once, on the raw
 *      grid verbatim; and
 *   2. what buildChartDocument installs equals
 *      swapSynctrack(emptyChart, <what that call returned>) — exactly the
 *      composition tempo-track.ts performs.
 *
 * Together those catch a second, diverging warp call site (someone inlines a
 * "quick fix" into one of the two features instead of editing
 * finalizeSynctrack) — including the case where the inlined copy is
 * behaviorally identical today and would therefore still produce a matching
 * grid, which is where drift starts.
 *
 * This is a structural claim about how the two call sites compose, not a
 * numerical one, so it does not need the whole fixture corpus. Three real
 * ks-warp-reach fixtures cover both of finalizeSynctrack's outcomes — a
 * warp the gate admits (a rebuilt grid) and one it declines (the raw grid
 * returned unchanged). The numerical parity of the warp itself is gated by
 * lib/tempo-map/__tests__/ks-warp-reach.test.ts against the Python
 * reference.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {createEmptyChart} from '@/lib/chart-edit';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import type {Synctrack} from '@/lib/tempo-map/types';
import {buildChartDocument, RESOLUTION, DEFAULT_BPM} from './chart-builder';
import type {RawDrumEvent} from '../ml/types';

/** Every finalizeSynctrack call chart-builder made, with what it returned.
 *  `mock`-prefixed so jest's `jest.mock` hoisting allows the reference. */
const mockFinalizeCalls: Array<{raw: unknown; result: Synctrack}> = [];

// Pass-through: the real warp still runs (once, inside buildChartDocument),
// and this records the exact value chart-builder received back. The path is
// relative because jest.mock resolves at runtime and there is no `@/`
// moduleNameMapper — `@/` specifiers are rewritten by SWC at transform time.
jest.mock('../../tempo-map/finalize-synctrack', () => {
  const actual = jest.requireActual('../../tempo-map/finalize-synctrack');
  return {
    ...actual,
    finalizeSynctrack: (raw: Synctrack, events: readonly RawDrumEvent[]) => {
      const result = actual.finalizeSynctrack(raw, events);
      mockFinalizeCalls.push({raw, result});
      return result;
    },
  };
});

const FIXTURES_DIR = path.join(
  __dirname,
  '../../tempo-map/__tests__/fixtures/ks-warp-reach',
);

/** Fixtures covering both finalizeSynctrack outcomes: reach-09 / reach-07
 *  are gate-admitted (the warp rebuilds the grid), reach-03 is not (the raw
 *  grid comes back unchanged). Cheapest representatives of each — the warp
 *  cost scales with song length, and this test does not depend on which
 *  song it runs on. */
const SELECTED_FIXTURES = ['reach-09', 'reach-07', 'reach-03'];

interface Fixture {
  song: string;
  admitted: boolean;
  incumbent_grid: Synctrack;
  ks_onsets_ms: number[];
  all_onsets_ms: number[];
  expected_grid: Synctrack | null;
}

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

/** Reconstruct RawDrumEvent[] from a fixture's onset arrays: the kick+snare
 * onsets (the warp's anchors) as BD, every other decoded onset as HH — an
 * arbitrary non-BD/SD lane, since finalizeSynctrack only distinguishes
 * "BD/SD" from "everything else". */
function eventsFromFixture(fixture: Fixture): RawDrumEvent[] {
  const ksSet = new Set(fixture.ks_onsets_ms);
  const events: RawDrumEvent[] = fixture.ks_onsets_ms.map(ms => ({
    timeSeconds: ms / 1000,
    drumClass: 'BD',
    midiPitch: 36,
    confidence: 1,
  }));
  for (const ms of fixture.all_onsets_ms) {
    if (ksSet.has(ms)) continue; // already added as a BD anchor above
    events.push({
      timeSeconds: ms / 1000,
      drumClass: 'HH',
      midiPitch: 42,
      confidence: 1,
    });
  }
  return events;
}

function emptyChart() {
  return createEmptyChart({
    format: 'chart',
    resolution: RESOLUTION,
    bpm: DEFAULT_BPM,
    timeSignature: {numerator: 4, denominator: 4},
  });
}

describe('tempo-mode output === full-pipeline synctrack (no-drift guarantee)', () => {
  const index = loadIndex();
  const selected = SELECTED_FIXTURES.map(song => {
    const entry = index.find(e => e.song === song);
    if (!entry) {
      throw new Error(
        `ks-warp-reach fixture "${song}" is gone from index.json — pick a ` +
          'replacement that keeps both admitted and non-admitted covered.',
      );
    }
    return entry;
  });
  // Both branches of finalizeSynctrack must still be represented; if the
  // export script reclassifies a fixture, fail here rather than silently
  // testing one path twice.
  expect(selected.some(e => e.admitted)).toBe(true);
  expect(selected.some(e => !e.admitted)).toBe(true);

  beforeEach(() => {
    mockFinalizeCalls.length = 0;
  });

  it.each(selected)('$song', ({file}) => {
    const fixture = loadFixture(file);
    const events = eventsFromFixture(fixture);
    const durationSeconds = Math.max(0, ...fixture.all_onsets_ms) / 1000 + 5;

    const fullPipelineChart = buildChartDocument(
      events,
      fixture.song,
      durationSeconds,
      fixture.incumbent_grid,
    ).parsedChart;

    // /drum-transcription routed its warp through the shared function, on
    // the incumbent grid itself rather than a re-derived one.
    expect(mockFinalizeCalls).toHaveLength(1);
    expect(mockFinalizeCalls[0].raw).toBe(fixture.incumbent_grid);

    // ...and installed the result exactly the way tempo-track.ts does.
    const tempoOnlyChart = swapSynctrack(
      emptyChart(),
      mockFinalizeCalls[0].result,
    );
    expect(fullPipelineChart.tempos).toEqual(tempoOnlyChart.tempos);
    expect(fullPipelineChart.timeSignatures).toEqual(
      tempoOnlyChart.timeSignatures,
    );
  });
});
