/**
 * Class-(b) RE-PREDICT tempo-remap tests (plan 0061 §3 / §3a / §5 / §7).
 *
 * Covers:
 *  - Op classification: a structural correction re-predicts from decoded
 *    onsets when they exist, and falls back to bounded RESNAP (with the
 *    disclosure flag set) when they don't.
 *  - Decoded-onset retention integration: re-predict re-derives notes from the
 *    retained onset TIMES, not from the notes' stored msTime (a doc whose
 *    existing notes sit on garbage ticks ends up with onset-derived ticks).
 *  - Steps 3-6 of the class-(a) sequence run either way (sections snap to
 *    whole-note gridlines).
 *  - The op-disagreement and guarded-batch paths are dead code behind
 *    feature flags that are OFF.
 */

import {
  createEmptyChart,
  addDrumNote,
  addSection,
  getDrumNotes,
  makeChartTiming,
  findTrackInParsedChart,
} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {Synctrack} from '@/lib/tempo-map/types';
import type {DecodedOnsetsFile} from '../ml/types';
import {
  repredictTempo,
  computeOpDisagreement,
  opsMateriallyDisagree,
  noteMsGuardPicksKeepMs,
  guardedBatchRepredict,
  medianNoteOnsetDistanceMs,
  OP_DISAGREEMENT_CHECK_ENABLED,
  BATCH_REPREDICT_ENABLED,
} from './repredict';

const RES = 480;

/** 120-BPM Synctrack (500 ms/beat, 480 ticks/beat). */
const SYNC_120: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 120}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

/**
 * A 120-BPM chart whose two existing kick notes sit on GARBAGE ticks
 * (100, 620) — as if placed under a wrong lattice — with internally-consistent
 * msTime, plus a section at a whole note. Re-predict must ignore these note
 * positions and re-derive from onsets.
 */
function makeDoc(): ChartDocument {
  const parsedChart = createEmptyChart({
    format: 'chart',
    bpm: 120,
    resolution: RES,
  });
  const track = emptyTrackData('drums', 'expert');
  parsedChart.trackData.push(track);
  const doc: ChartDocument = {parsedChart, assets: []};

  const timing = makeChartTiming(parsedChart);
  addDrumNote(track, {tick: 100, type: 'kick'}, timing);
  addDrumNote(track, {tick: 620, type: 'kick'}, timing);
  addSection(doc, 1920, 'Verse');
  return doc;
}

/** Three BD (kick) onsets at 0.5/1.0/1.5 s — clean quarter positions under
 * 120 BPM (ticks 480/960/1440). */
function onsetsFile(flow: 'audio' | 'chart' = 'audio'): DecodedOnsetsFile {
  return {
    version: 1,
    flow,
    onsets: [0.5, 1.0, 1.5].map(t => ({
      timeSeconds: t,
      drumClass: 'BD' as const,
      midiPitch: 36,
      confidence: 0.9,
    })),
  };
}

function kickTicks(doc: ChartDocument): number[] {
  const track = findTrackInParsedChart(doc.parsedChart, {
    instrument: 'drums',
    difficulty: 'expert',
  });
  return getDrumNotes(track!.track)
    .filter(n => n.type === 'kick')
    .map(n => n.tick)
    .sort((a, b) => a - b);
}

describe('repredictTempo — op classification', () => {
  test('decoded onsets present → RE-PREDICT (no fallback, warp diag present)', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, onsetsFile());
    expect(result.op).toBe('re-predict');
    expect(result.usedResnapFallback).toBe(false);
    expect(result.warpDiag).not.toBeNull();
  });

  test('no decoded onsets → RESNAP fallback with disclosure flag', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, null);
    expect(result.op).toBe('resnap');
    expect(result.usedResnapFallback).toBe(true);
    expect(result.warpDiag).toBeNull();
  });

  test('empty onset list is treated as no onsets → RESNAP fallback', () => {
    const empty: DecodedOnsetsFile = {version: 1, flow: 'audio', onsets: []};
    const result = repredictTempo(makeDoc(), SYNC_120, empty);
    expect(result.op).toBe('resnap');
    expect(result.usedResnapFallback).toBe(true);
  });
});

describe('repredictTempo — re-derives from onsets, not stored msTime', () => {
  test('RE-PREDICT replaces garbage-tick notes with onset-derived ticks', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, onsetsFile());
    // The two existing notes (ticks 100, 620) are discarded; the three decoded
    // onsets snap onto the 120-BPM quarter grid.
    expect(kickTicks(result.doc)).toEqual([480, 960, 1440]);
  });

  test('RESNAP keeps the existing note SET (re-quantized), does not re-derive', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, null);
    // Still two notes (the originals re-ticked to the grid) — NOT the three
    // onset-derived notes. This is what distinguishes the two ops.
    expect(kickTicks(result.doc)).toHaveLength(2);
  });

  test('input doc is not mutated', () => {
    const doc = makeDoc();
    repredictTempo(doc, SYNC_120, onsetsFile());
    expect(kickTicks(doc)).toEqual([100, 620]);
  });
});

describe('repredictTempo — class-(a) steps 3-6 run either way', () => {
  test('section snaps to a whole-note gridline (RE-PREDICT)', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, onsetsFile());
    const section = result.doc.parsedChart.sections[0];
    expect(section.tick % (RES * 4)).toBe(0);
  });

  test('every event has a real (retimed) msTime — no placeholders', () => {
    const result = repredictTempo(makeDoc(), SYNC_120, onsetsFile());
    const notes = kickTicks(result.doc);
    expect(notes).toHaveLength(3);
    const track = findTrackInParsedChart(result.doc.parsedChart, {
      instrument: 'drums',
      difficulty: 'expert',
    });
    // 480 ticks @ 120 BPM = 500 ms.
    const msTimes = track!.track.noteEventGroups
      .flat()
      .map(n => n.msTime)
      .sort((a, b) => a - b);
    expect(msTimes[0]).toBeCloseTo(500, 3);
    expect(msTimes[1]).toBeCloseTo(1000, 3);
    expect(msTimes[2]).toBeCloseTo(1500, 3);
  });
});

describe('op-disagreement plumbing — DEAD CODE, flagged off', () => {
  test('feature flag is off', () => {
    expect(OP_DISAGREEMENT_CHECK_ENABLED).toBe(false);
  });

  test('computeOpDisagreement pairs notes and aggregates |Δms|', () => {
    const keepMs = repredictTempo(makeDoc(), SYNC_120, null).doc; // resnap = 2 notes
    const repredict = repredictTempo(makeDoc(), SYNC_120, onsetsFile()).doc; // 3 notes
    const d = computeOpDisagreement(keepMs, repredict);
    // Paired over the shorter (2-note) list.
    expect(d.perNoteDeltaMs).toHaveLength(2);
    expect(d.medianMs).toBeGreaterThanOrEqual(0);
    expect(d.p90Ms).toBeGreaterThanOrEqual(d.medianMs);
  });

  test('opsMateriallyDisagree compares median against the threshold', () => {
    const d = {perNoteDeltaMs: [0, 10, 20], medianMs: 10, p90Ms: 18};
    expect(opsMateriallyDisagree(d, 5)).toBe(true);
    expect(opsMateriallyDisagree(d, 15)).toBe(false);
  });
});

describe('guarded batch path — DEAD CODE, flagged off', () => {
  test('feature flag is off', () => {
    expect(BATCH_REPREDICT_ENABLED).toBe(false);
  });

  test('guardedBatchRepredict throws while the flag gates it off', () => {
    expect(() =>
      guardedBatchRepredict(makeDoc(), SYNC_120, onsetsFile()),
    ).toThrow(/certification-pending|feature-flagged off/);
  });

  test('noteMsGuardPicksKeepMs reverts on worsening, keeps on improving', () => {
    // Worse by more than tol → pick keep-ms.
    expect(noteMsGuardPicksKeepMs(5, 1, 0.5)).toBe(true);
    // Better → keep re-predict.
    expect(noteMsGuardPicksKeepMs(1, 5, 0.5)).toBe(false);
    // Worse but within tol → keep re-predict.
    expect(noteMsGuardPicksKeepMs(1.3, 1, 0.5)).toBe(false);
  });

  test('medianNoteOnsetDistanceMs measures note-to-nearest-onset fit', () => {
    // Re-predicted doc's notes land exactly on the onsets → ~0 distance.
    const repredict = repredictTempo(makeDoc(), SYNC_120, onsetsFile()).doc;
    const fit = medianNoteOnsetDistanceMs(repredict, onsetsFile().onsets);
    expect(fit).toBeLessThan(10);
  });
});
