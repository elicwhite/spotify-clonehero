/**
 * DeleteTrackCommand / DeleteInstrumentCommand tests (plan 0077 item 6,
 * OWNER OVERRIDE: per-difficulty deletion). Both are the new pieces the
 * Chart Matrix's right-click menu drives; `DeleteLowerDifficultiesCommand`
 * (the third menu action, "Delete all lower difficulties") already has
 * coverage in `generate-difficulties-command.test.ts`.
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {
  DeleteInstrumentCommand,
  DeleteTrackCommand,
  GenerateDifficultiesCommand,
} from '../commands';
import type {
  DifficultyTierContent,
  DifficultyTierSet,
} from '@/lib/assist/difficulty-protocol';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import {trackKeyId} from '@/lib/chart-editor-core/trackInventory';
import {
  computeTrackStamp,
  getAssistProvenance,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {DRUM_EDIT_CAPABILITIES, PREVIEW_CAPABILITIES} from '../capabilities';
import {isCommandAllowed} from '@/lib/chart-editor-core/capabilityGate';
import {makeFixtureDoc} from './fixtures';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote} from '@/lib/chart-edit';

function tier(
  overrides: Partial<DifficultyTierContent> = {},
): DifficultyTierContent {
  return {
    notes: [{tick: 0, type: noteTypes.kick, length: 0, flags: 0}],
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    ...overrides,
  };
}

function tiers(): DifficultyTierSet {
  return {hard: tier(), medium: tier(), easy: tier()};
}

/** `makeFixtureDoc()` plus a generated Hard/Medium/Easy set for drums (the
 *  Expert content stamp comes from the fixture's own drums Expert). */
function docWithGeneratedDrums(): ChartDocument {
  const doc = makeFixtureDoc();
  const expert = doc.parsedChart.trackData[0];
  const cmd = new GenerateDifficultiesCommand(
    'drums',
    tiers(),
    computeTrackStamp(expert),
  );
  return cmd.execute(doc);
}

function hasTrack(
  doc: ChartDocument,
  instrument: SupportedTrackInstrument,
  difficulty: string,
): boolean {
  return doc.parsedChart.trackData.some(
    t => t.instrument === instrument && t.difficulty === difficulty,
  );
}

describe('DeleteTrackCommand', () => {
  it('removes exactly the named track and leaves the rest untouched', () => {
    const before = docWithGeneratedDrums();
    const after = new DeleteTrackCommand({
      instrument: 'drums',
      difficulty: 'hard',
    }).execute(before);

    expect(hasTrack(after, 'drums', 'hard')).toBe(false);
    expect(hasTrack(after, 'drums', 'medium')).toBe(true);
    expect(hasTrack(after, 'drums', 'easy')).toBe(true);
    expect(hasTrack(after, 'drums', 'expert')).toBe(true);
  });

  it('is a no-op when the track does not exist', () => {
    const before = makeFixtureDoc();
    const after = new DeleteTrackCommand({
      instrument: 'guitar',
      difficulty: 'expert',
    }).execute(before);
    expect(after).toBe(before);
  });

  it('declares exactly the one track in affectedTracks, and note/delete', () => {
    const cmd = new DeleteTrackCommand({
      instrument: 'drums',
      difficulty: 'hard',
    });
    expect(cmd.affectedTracks).toEqual(
      new Set([trackKeyId({instrument: 'drums', difficulty: 'hard'})]),
    );
    expect(cmd.entityKinds).toEqual(new Set(['note']));
    expect(cmd.operations).toEqual(new Set(['delete']));
  });

  it('is allowed under DRUM_EDIT_CAPABILITIES, blocked under PREVIEW_CAPABILITIES', () => {
    const cmd = new DeleteTrackCommand({
      instrument: 'drums',
      difficulty: 'hard',
    });
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
  });

  describe('provenance (plan 0077 item 6\'s "decide honestly" call)', () => {
    it('drops the difficulties[instrument] record when deleting Expert, even though the generated lowers survive', () => {
      const before = docWithGeneratedDrums();
      expect(getAssistProvenance(before)!.difficulties!.drums).toBeDefined();

      const after = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'expert',
      }).execute(before);

      expect(hasTrack(after, 'drums', 'hard')).toBe(true);
      expect(hasTrack(after, 'drums', 'medium')).toBe(true);
      expect(hasTrack(after, 'drums', 'easy')).toBe(true);
      expect(getAssistProvenance(after)!.difficulties?.drums).toBeUndefined();
    });

    it('keeps the record when one of several surviving lower tiers is deleted', () => {
      const before = docWithGeneratedDrums();
      const after = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'hard',
      }).execute(before);

      expect(getAssistProvenance(after)!.difficulties!.drums).toEqual(
        getAssistProvenance(before)!.difficulties!.drums,
      );
    });

    it('drops the record when the last surviving lower tier is deleted', () => {
      let doc = docWithGeneratedDrums();
      doc = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'hard',
      }).execute(doc);
      doc = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'medium',
      }).execute(doc);
      expect(getAssistProvenance(doc)!.difficulties!.drums).toBeDefined();

      doc = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'easy',
      }).execute(doc);

      expect(hasTrack(doc, 'drums', 'hard')).toBe(false);
      expect(hasTrack(doc, 'drums', 'medium')).toBe(false);
      expect(hasTrack(doc, 'drums', 'easy')).toBe(false);
      expect(getAssistProvenance(doc)!.difficulties?.drums).toBeUndefined();
    });

    it('keeps unrelated provenance entries untouched', () => {
      const before = withAssistProvenance(docWithGeneratedDrums(), {
        ...getAssistProvenance(docWithGeneratedDrums()),
        tempoDerived: {'drum-transcription': {tempoStamp: 'tempo-stamp'}},
      });
      const after = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'expert',
      }).execute(before);
      expect(
        getAssistProvenance(after)!.tempoDerived?.['drum-transcription'],
      ).toEqual({tempoStamp: 'tempo-stamp'});
    });

    it('is a no-op on provenance for a track with no recorded generation', () => {
      const before = makeFixtureDoc();
      const after = new DeleteTrackCommand({
        instrument: 'drums',
        difficulty: 'expert',
      }).execute(before);
      expect(getAssistProvenance(after)).toBeUndefined();
    });
  });

  it('leaves the pre-command doc intact (undo snapshot restore)', () => {
    const before = docWithGeneratedDrums();
    new DeleteTrackCommand({instrument: 'drums', difficulty: 'expert'}).execute(
      before,
    );
    expect(hasTrack(before, 'drums', 'expert')).toBe(true);
    expect(getAssistProvenance(before)!.difficulties!.drums).toBeDefined();
  });
});

describe('DeleteInstrumentCommand', () => {
  it('removes every difficulty of the instrument', () => {
    const before = docWithGeneratedDrums();
    const after = new DeleteInstrumentCommand('drums').execute(before);

    for (const difficulty of ['expert', 'hard', 'medium', 'easy'] as const) {
      expect(hasTrack(after, 'drums', difficulty)).toBe(false);
    }
  });

  it('always drops the difficulties[instrument] provenance record', () => {
    const before = docWithGeneratedDrums();
    const after = new DeleteInstrumentCommand('drums').execute(before);
    expect(getAssistProvenance(after)!.difficulties?.drums).toBeUndefined();
  });

  it('keeps unrelated provenance entries (other instruments, drum transcription)', () => {
    const before = withAssistProvenance(docWithGeneratedDrums(), {
      ...getAssistProvenance(docWithGeneratedDrums()),
      difficulties: {
        drums: {sourceStamp: 'drums-stamp'},
        guitar: {sourceStamp: 'guitar-stamp'},
      },
      tempoDerived: {'drum-transcription': {tempoStamp: 'tempo-stamp'}},
    });
    const after = new DeleteInstrumentCommand('drums').execute(before);
    const provenance = getAssistProvenance(after)!;
    expect(provenance.difficulties).toEqual({
      guitar: {sourceStamp: 'guitar-stamp'},
    });
    expect(provenance.tempoDerived?.['drum-transcription']).toEqual({
      tempoStamp: 'tempo-stamp',
    });
  });

  it('is a no-op when the instrument has no tracks and no provenance record', () => {
    const before = makeFixtureDoc();
    const after = new DeleteInstrumentCommand('guitar').execute(before);
    expect(after).toBe(before);
  });

  it('declares every difficulty of the instrument in affectedTracks, and note/delete', () => {
    const cmd = new DeleteInstrumentCommand('drums');
    expect(cmd.affectedTracks).toEqual(
      new Set([
        trackKeyId({instrument: 'drums', difficulty: 'expert'}),
        trackKeyId({instrument: 'drums', difficulty: 'hard'}),
        trackKeyId({instrument: 'drums', difficulty: 'medium'}),
        trackKeyId({instrument: 'drums', difficulty: 'easy'}),
      ]),
    );
    expect(cmd.entityKinds).toEqual(new Set(['note']));
    expect(cmd.operations).toEqual(new Set(['delete']));
  });

  it('is allowed under DRUM_EDIT_CAPABILITIES, blocked under PREVIEW_CAPABILITIES', () => {
    const cmd = new DeleteInstrumentCommand('drums');
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
  });

  it('leaves the pre-command doc intact (undo snapshot restore)', () => {
    const before = docWithGeneratedDrums();
    new DeleteInstrumentCommand('drums').execute(before);
    expect(hasTrack(before, 'drums', 'expert')).toBe(true);
    expect(getAssistProvenance(before)!.difficulties!.drums).toBeDefined();
  });

  it('redo (re-execute against the restored doc) removes the instrument again', () => {
    const before = docWithGeneratedDrums();
    const cmd = new DeleteInstrumentCommand('drums');
    cmd.execute(before);
    const afterRedo = cmd.execute(before);
    for (const difficulty of ['expert', 'hard', 'medium', 'easy'] as const) {
      expect(hasTrack(afterRedo, 'drums', difficulty)).toBe(false);
    }
  });
});

describe('DeleteTrackCommand + DeleteInstrumentCommand — extra note events', () => {
  it('DeleteTrackCommand does not disturb sections/tempos/vocals on the doc', () => {
    const before = makeFixtureDoc();
    addDrumNote(before.parsedChart.trackData[0], {
      tick: 2400,
      type: noteTypes.kick,
    });
    const after = new DeleteTrackCommand({
      instrument: 'drums',
      difficulty: 'expert',
    }).execute(before);
    expect(after.parsedChart.sections).toEqual(before.parsedChart.sections);
    expect(after.parsedChart.tempos).toEqual(before.parsedChart.tempos);
    expect(after.parsedChart.vocalTracks).toBe(before.parsedChart.vocalTracks);
  });
});
