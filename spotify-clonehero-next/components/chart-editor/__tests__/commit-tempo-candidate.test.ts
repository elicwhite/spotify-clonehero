/**
 * Half/double + tap-tempo preview flow (plan 0061 §7).
 *
 * The interactive class-(b) control runs RE-PREDICT once, previews the full
 * candidate through `pendingTempoCandidate`, and lets the user accept or reject
 * — accept-or-reject IS the guard (no automated note-ms guard on this path).
 * These tests pin the two hard guarantees:
 *  - preview-accept commits EXACTLY the previewed candidate (no re-run, no
 *    drift — same object identity from preview through commit);
 *  - preview-reject leaves the committed doc byte-identical;
 * plus the batch/guarded path staying feature-flagged OFF.
 */

import {createEmptyChart, addDrumNote, makeChartTiming} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {Synctrack} from '@/lib/tempo-map/types';
import {octaveRescaleSync} from '@/lib/tempo-map/structural-correction';
import {synctrackFromChart} from '@/lib/chart-edit';
import type {DecodedOnsetsFile} from '@/lib/drum-transcription/ml/types';
import {
  repredictTempo,
  guardedBatchRepredict,
  BATCH_REPREDICT_ENABLED,
} from '@/lib/drum-transcription/pipeline/repredict';
import {CommitTempoCandidateCommand} from '../commands';
import {
  chartEditorReducer,
  initialState,
  type ChartEditorState,
} from '@/lib/chart-editor-core';
import {noteTypes} from '@eliwhite/scan-chart';

const RES = 480;

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
  addDrumNote(track, {tick: 100, type: noteTypes.kick}, timing);
  addDrumNote(track, {tick: 620, type: noteTypes.kick}, timing);
  return doc;
}

const ONSETS: DecodedOnsetsFile = {
  version: 1,
  flow: 'audio',
  onsets: [0.5, 1.0, 1.5].map(t => ({
    timeSeconds: t,
    drumClass: 'BD' as const,
    midiPitch: 36,
    confidence: 0.9,
  })),
};

/** Build a RE-PREDICT candidate the way the panel does: octave-rescale the
 *  chart's own synctrack, then run the class-(b) op once. */
function buildCandidate(base: ChartDocument): ChartDocument {
  const corrected: Synctrack = octaveRescaleSync(
    synctrackFromChart(base.parsedChart),
    2,
  );
  return repredictTempo(base, corrected, ONSETS).doc;
}

describe('CommitTempoCandidateCommand', () => {
  test('execute returns the captured candidate verbatim, ignoring the live doc', () => {
    const base = makeDoc();
    const candidate = buildCandidate(base);
    const cmd = new CommitTempoCandidateCommand(candidate);
    // Same object identity — not a re-run of the op.
    expect(cmd.execute(base)).toBe(candidate);
    // Even if handed a different doc, it still commits the captured candidate.
    expect(cmd.execute(makeDoc())).toBe(candidate);
  });
});

describe('preview → accept (plan 0061 §7)', () => {
  test('accept commits exactly the previewed candidate and clears the preview', () => {
    const base = makeDoc();
    const candidate = buildCandidate(base);

    // Preview: the candidate is staged on pendingTempoCandidate; chartDoc is
    // untouched, both views render from the candidate.
    let state: ChartEditorState = {
      ...initialState,
      chartDoc: base,
    };
    state = chartEditorReducer(state, {
      type: 'SET_PENDING_TEMPO_CANDIDATE',
      candidate: {op: 're-predict', doc: candidate},
    });
    expect(state.chartDoc).toBe(base);
    expect(state.pendingTempoCandidate?.doc).toBe(candidate);

    // Accept: the executeCommand hook computes command.execute(chartDoc) — the
    // candidate verbatim — and dispatches EXECUTE_COMMAND with it.
    const command = new CommitTempoCandidateCommand(candidate);
    const committed = command.execute(state.chartDoc!);
    expect(committed).toBe(candidate); // no drift between preview and commit

    state = chartEditorReducer(state, {
      type: 'EXECUTE_COMMAND',
      command,
      chartDoc: committed,
    });
    expect(state.chartDoc).toBe(candidate);
    // The commit clears the preview channel (invalidation rule).
    expect(state.pendingTempoCandidate).toBeNull();
    // One undo entry restores the pre-commit doc.
    expect(state.undoDocStack[state.undoDocStack.length - 1]).toBe(base);
  });
});

describe('preview → reject (plan 0061 §7)', () => {
  test('reject clears the candidate and leaves the committed doc byte-identical', () => {
    const base = makeDoc();
    const candidate = buildCandidate(base);

    let state: ChartEditorState = {
      ...initialState,
      chartDoc: base,
    };
    state = chartEditorReducer(state, {
      type: 'SET_PENDING_TEMPO_CANDIDATE',
      candidate: {op: 're-predict', doc: candidate},
    });
    // Reject just nulls the pending candidate.
    state = chartEditorReducer(state, {
      type: 'SET_PENDING_TEMPO_CANDIDATE',
      candidate: null,
    });
    expect(state.pendingTempoCandidate).toBeNull();
    // The committed doc never changed — same object, no snapshot pushed.
    expect(state.chartDoc).toBe(base);
    expect(state.undoStack).toHaveLength(0);
    expect(state.dirty).toBe(false);
  });
});

describe('batch/guarded path stays flag-gated (plan 0061 §3a/§7)', () => {
  test('the flag is OFF and the guarded batch op throws while gated', () => {
    expect(BATCH_REPREDICT_ENABLED).toBe(false);
    const base = makeDoc();
    const corrected = octaveRescaleSync(
      synctrackFromChart(base.parsedChart),
      2,
    );
    expect(() => guardedBatchRepredict(base, corrected, ONSETS)).toThrow();
  });
});
