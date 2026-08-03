/**
 * ReplaceTempoMapCommand tests (plan 0074 Design A `generate-tempo-map`
 * task / Design C staleness model).
 */

import {ReplaceTempoMapCommand} from '../commands';
import {
  TEMPO_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
} from '../capabilities';
import {isCommandAllowed} from '@/lib/chart-editor-core/capabilityGate';
import {
  computeTempoStamp,
  getAssistProvenance,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {
  chartEditorReducer,
  initialState,
  selectDrumTranscriptionStale,
  type ChartEditorState,
} from '@/lib/chart-editor-core';
import type {EditCommand} from '../commands';
import {getAudioAnchor, setAudioAnchor} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {Synctrack} from '@/lib/tempo-map/types';
import {makeFixtureDoc} from './fixtures';

/** A different, slower grid than the fixture's 120bpm@0 / 140bpm@1920-tick
 *  map — enough to force every note onto a new tick under KEEP-MS. */
const SLOW_SYNC: Synctrack = {
  origin_ms: 0,
  tempos: [{ms: 0, bpm: 90}],
  timeSignatures: [{ms: 0, numerator: 4, denominator: 4}],
};

function executeAction(command: EditCommand, prevDoc: ChartDocument) {
  const newDoc = command.execute(prevDoc);
  return {type: 'EXECUTE_COMMAND' as const, command, chartDoc: newDoc};
}

function loadDoc(doc: ChartDocument): ChartEditorState {
  return chartEditorReducer(initialState, {
    type: 'SET_CHART_DOC',
    chartDoc: doc,
  });
}

describe('ReplaceTempoMapCommand', () => {
  it('installs the new tempo map', () => {
    const before = makeFixtureDoc();
    const after = new ReplaceTempoMapCommand(SLOW_SYNC).execute(before);

    expect(after.parsedChart.tempos).toEqual([
      {tick: 0, beatsPerMinute: 90, msTime: 0},
    ]);
    // Input untouched (execute must leave a valid undo snapshot).
    expect(before.parsedChart.tempos[0].beatsPerMinute).toBe(120);
  });

  it('re-ticks existing notes under the new map (KEEP-MS RESNAP)', () => {
    const before = makeFixtureDoc();
    const beforeTicks = before.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick)
      .sort((a, b) => a - b);

    const after = new ReplaceTempoMapCommand(SLOW_SYNC).execute(before);
    const afterTicks = after.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => n.tick)
      .sort((a, b) => a - b);

    // Same note count, different ticks: each note kept its wall-clock time
    // and was re-quantized onto the slower grid.
    expect(afterTicks).toHaveLength(beforeTicks.length);
    expect(afterTicks).not.toEqual(beforeTicks);
    // Input untouched.
    expect(
      before.parsedChart.trackData[0].noteEventGroups
        .flat()
        .map(n => n.tick)
        .sort((a, b) => a - b),
    ).toEqual(beforeTicks);
  });

  it('preserves the leading-silence anchor across the swap', () => {
    const before = setAudioAnchor(makeFixtureDoc(), {tick: 480, ms: 500});
    const after = new ReplaceTempoMapCommand(SLOW_SYNC).execute(before);

    expect(getAudioAnchor(after)).not.toBeNull();
    expect(getAudioAnchor(after)!.ms).toBe(500);
    expect(getAudioAnchor(before)).toEqual({tick: 480, ms: 500});
  });

  it('undo/redo round-trips via whole-doc snapshot restore', () => {
    // Driven through the reducer, which is what actually performs the
    // restore: `execute` has no inverse, so undo reinstalls the pre-command
    // snapshot and redo reinstalls the post-command one.
    const before = makeFixtureDoc();
    const loaded = loadDoc(before);
    const cmd = new ReplaceTempoMapCommand(SLOW_SYNC);
    const executed = chartEditorReducer(
      loaded,
      executeAction(cmd, loaded.chartDoc!),
    );
    expect(executed.chartDoc!.parsedChart.tempos[0].beatsPerMinute).toBe(90);

    const undone = chartEditorReducer(executed, {
      type: 'UNDO',
      chartDoc: loaded.chartDoc!,
    });
    expect(undone.chartDoc!.parsedChart.tempos[0].beatsPerMinute).toBe(120);
    expect(undone.tempoStamp).toBe(loaded.tempoStamp);

    const redone = chartEditorReducer(undone, {
      type: 'REDO',
      chartDoc: executed.chartDoc!,
    });
    expect(redone.chartDoc!.parsedChart.tempos[0].beatsPerMinute).toBe(90);
    expect(redone.tempoStamp).toBe(executed.tempoStamp);
    // The input doc was never mutated in place along the way.
    expect(before.parsedChart.tempos[0].beatsPerMinute).toBe(120);
  });

  describe('drum-transcription provenance interaction (Design C)', () => {
    it('leaves a doc with no drum-transcription provenance untouched', () => {
      const before = makeFixtureDoc();
      const after = new ReplaceTempoMapCommand(SLOW_SYNC).execute(before);
      expect(getAssistProvenance(after)).toBeUndefined();
    });

    it('a standalone tempo regeneration leaves the recorded stamp untouched, making transcription stale', () => {
      const withProvenance = withAssistProvenance(makeFixtureDoc(), {
        drumTranscription: {tempoStamp: computeTempoStamp(makeFixtureDoc())},
      });
      const after = new ReplaceTempoMapCommand(SLOW_SYNC).execute(
        withProvenance,
      );
      const provenance = getAssistProvenance(after)!;
      // Recorded stamp carried over verbatim...
      expect(provenance.drumTranscription!.tempoStamp).toBe(
        getAssistProvenance(withProvenance)!.drumTranscription!.tempoStamp,
      );
      // ...which no longer matches the new map's stamp.
      expect(provenance.drumTranscription!.tempoStamp).not.toBe(
        computeTempoStamp(after),
      );
    });

    it('fromSameRunAsDrumTranscription re-stamps provenance to the new map, staying fresh', () => {
      const withProvenance = withAssistProvenance(makeFixtureDoc(), {
        drumTranscription: {tempoStamp: computeTempoStamp(makeFixtureDoc())},
      });
      const after = new ReplaceTempoMapCommand(SLOW_SYNC, {
        fromSameRunAsDrumTranscription: true,
      }).execute(withProvenance);

      const provenance = getAssistProvenance(after)!;
      expect(provenance.drumTranscription!.tempoStamp).toBe(
        computeTempoStamp(after),
      );
    });
  });

  describe('staleness selector (reducer-level)', () => {
    it('flips selectDrumTranscriptionStale after a standalone tempo regeneration', () => {
      const doc = withAssistProvenance(makeFixtureDoc(), {
        drumTranscription: {tempoStamp: computeTempoStamp(makeFixtureDoc())},
      });
      const loaded = loadDoc(doc);
      expect(selectDrumTranscriptionStale(loaded)).toBe(false);

      const regenerated = chartEditorReducer(
        loaded,
        executeAction(new ReplaceTempoMapCommand(SLOW_SYNC), loaded.chartDoc!),
      );
      expect(selectDrumTranscriptionStale(regenerated)).toBe(true);
    });

    it('does not flip staleness when generated in the same run as the drum transcription', () => {
      const doc = withAssistProvenance(makeFixtureDoc(), {
        drumTranscription: {tempoStamp: computeTempoStamp(makeFixtureDoc())},
      });
      const loaded = loadDoc(doc);

      const regenerated = chartEditorReducer(
        loaded,
        executeAction(
          new ReplaceTempoMapCommand(SLOW_SYNC, {
            fromSameRunAsDrumTranscription: true,
          }),
          loaded.chartDoc!,
        ),
      );
      expect(selectDrumTranscriptionStale(regenerated)).toBe(false);
    });
  });

  describe('capability gating', () => {
    it('declares tempo/timesig intent only (note re-tick is a side effect)', () => {
      const cmd = new ReplaceTempoMapCommand(SLOW_SYNC);
      expect(cmd.entityKinds).toEqual(new Set(['tempo', 'timesig']));
    });

    it('is allowed under TEMPO_CAPABILITIES', () => {
      const cmd = new ReplaceTempoMapCommand(SLOW_SYNC);
      expect(isCommandAllowed(cmd, TEMPO_CAPABILITIES)).toBe(true);
    });

    it('is allowed under DRUM_EDIT_CAPABILITIES', () => {
      const cmd = new ReplaceTempoMapCommand(SLOW_SYNC);
      expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    });

    it('is blocked under PREVIEW_CAPABILITIES', () => {
      const cmd = new ReplaceTempoMapCommand(SLOW_SYNC);
      expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
    });
  });
});
