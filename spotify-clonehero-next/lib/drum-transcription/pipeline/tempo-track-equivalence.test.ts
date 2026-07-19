/**
 * The no-drift guarantee behind the /tempo <-> /drum-transcription
 * unification: both features finalize a predicted Synctrack by calling the
 * SAME function (finalizeSynctrack, lib/tempo-map/finalize-synctrack.ts) on
 * the SAME (rawSynctrack, events) pair — /drum-transcription via
 * chart-builder.ts's buildChartDocument, /tempo via tempo-track.ts's
 * runTempoTrack(FromPcm). This test proves the two call sites are
 * byte-identical: for each ks-warp-reach fixture (real production onsets +
 * incumbent grids), buildChartDocument's installed tempos/timeSignatures
 * must equal swapSynctrack(emptyChart, finalizeSynctrack(raw, events)) —
 * exactly the tempo-only pipeline's output — called directly.
 *
 * If a future edit ever reintroduces a second, diverging warp call site
 * (e.g. someone inlines a "quick fix" into one of the two features instead
 * of editing finalizeSynctrack), this test fails.
 */

import {readFileSync} from 'fs';
import path from 'path';
import {createEmptyChart} from '@/lib/chart-edit';
import {swapSynctrack} from '@/lib/tempo-map/swap-synctrack';
import {finalizeSynctrack} from '@/lib/tempo-map/finalize-synctrack';
import type {Synctrack} from '@/lib/tempo-map/types';
import {buildChartDocument, RESOLUTION, DEFAULT_BPM} from './chart-builder';
import type {RawDrumEvent} from '../ml/types';

const FIXTURES_DIR = path.join(
  __dirname,
  '../../tempo-map/__tests__/fixtures/ks-warp-reach',
);

interface Fixture {
  song: string;
  admitted: boolean;
  incumbent_grid: Synctrack;
  ks_onsets_ms: number[];
  all_onsets_ms: number[];
  expected_grid: Synctrack | null;
}

function loadIndex(): Array<{song: string; slug: string; file: string}> {
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
  expect(index.length).toBeGreaterThanOrEqual(3);

  it.each(index)('$song', ({file}) => {
    const fixture = loadFixture(file);
    const events = eventsFromFixture(fixture);
    const durationSeconds = Math.max(0, ...fixture.all_onsets_ms) / 1000 + 5;

    // What /tempo's tempo-track.ts produces as its final `synctrack` (the
    // exact composition runTempoTrackFromPcm performs after CRNN + Beat
    // This!/DBA have already run).
    const tempoOnlySynctrack = finalizeSynctrack(
      fixture.incumbent_grid,
      events,
    );
    const tempoOnlyChart = swapSynctrack(emptyChart(), tempoOnlySynctrack);

    // What /drum-transcription's chart-builder.ts installs for the SAME
    // (rawSynctrack, events) pair.
    const fullPipelineChart = buildChartDocument(
      events,
      fixture.song,
      durationSeconds,
      fixture.incumbent_grid,
    ).parsedChart;

    expect(fullPipelineChart.tempos).toEqual(tempoOnlyChart.tempos);
    expect(fullPipelineChart.timeSignatures).toEqual(
      tempoOnlyChart.timeSignatures,
    );
  });
});
