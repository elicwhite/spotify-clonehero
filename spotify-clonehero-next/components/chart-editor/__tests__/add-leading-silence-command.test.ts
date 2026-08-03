/**
 * AddLeadingSilenceCommand tests (plan 0064 editor-button addendum §5,
 * shared by the Chart Assist "Add leading silence" card).
 */

import {AddLeadingSilenceCommand} from '../commands';
import {
  TEMPO_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
} from '../capabilities';
import {isCommandAllowed} from '@/lib/chart-editor-core/capabilityGate';
import {
  computeTempoStamp,
  getAssistProvenance,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {planLeadingSilence, type ChartDocument} from '@/lib/chart-edit';
import {makeFixtureDoc} from './fixtures';

const SAMPLE_RATE = 44100;

function planFor(doc: ChartDocument) {
  const plan = planLeadingSilence(doc, SAMPLE_RATE);
  if (!plan) throw new Error('fixture should need leading silence');
  return plan;
}

describe('AddLeadingSilenceCommand', () => {
  it('shifts the chart into the padded ms domain', () => {
    const before = makeFixtureDoc();
    const plan = planFor(before);
    const after = new AddLeadingSilenceCommand(plan).execute(before);

    const firstNoteBefore =
      before.parsedChart.trackData[0].noteEventGroups[0][0];
    const firstNoteAfter = after.parsedChart.trackData[0].noteEventGroups[0][0];
    expect(firstNoteAfter.msTime).toBeGreaterThan(firstNoteBefore.msTime);
    // Input doc untouched, so redo can re-execute the same plan.
    expect(before.parsedChart.trackData[0].noteEventGroups[0][0].msTime).toBe(
      firstNoteBefore.msTime,
    );
  });

  it('is a grid edit: allowed on /tempo, which grants no note edits', () => {
    const cmd = new AddLeadingSilenceCommand(planFor(makeFixtureDoc()));
    // The pad moves the SYNC TRACK; notes keep their ticks and follow. That
    // makes it the same shape of edit as a tempo-marker move, so the surface
    // whose whole purpose is the grid must be able to run it.
    expect(cmd.entityKinds).toEqual(new Set(['tempo', 'timesig']));
    expect(isCommandAllowed(cmd, TEMPO_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
  });

  it('re-stamps drum-transcription provenance instead of flagging it stale', () => {
    const base = makeFixtureDoc();
    const before = withAssistProvenance(base, {
      drumTranscription: {tempoStamp: computeTempoStamp(base)},
    });
    const after = new AddLeadingSilenceCommand(planFor(before)).execute(before);

    // The grid moved, but the drums moved with it by the same fixed pad, so
    // nothing landed on a different beat.
    expect(getAssistProvenance(after)!.drumTranscription!.tempoStamp).toBe(
      computeTempoStamp(after),
    );
  });

  it('leaves a doc with no transcription provenance alone', () => {
    const before = makeFixtureDoc();
    const after = new AddLeadingSilenceCommand(planFor(before)).execute(before);
    expect(getAssistProvenance(after)).toBeUndefined();
  });
});
