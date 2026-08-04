/**
 * GenerateDifficultiesCommand / DeleteLowerDifficultiesCommand tests
 * (plan 0074 Design C/D, Phase 4).
 */

import {noteTypes} from '@eliwhite/scan-chart';
import {
  GenerateDifficultiesCommand,
  DeleteLowerDifficultiesCommand,
} from '../commands';
import type {
  DifficultyTierContent,
  DifficultyTierSet,
} from '@/lib/assist/difficulty-protocol';
import type {SupportedTrackInstrument} from '@/lib/chart-editor-core';
import {trackKeyId} from '@/lib/chart-editor-core/trackInventory';
import {
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
  ADD_LYRICS_CAPABILITIES,
} from '../capabilities';
import {isCommandAllowed} from '@/lib/chart-editor-core/capabilityGate';
import {
  computeTrackStamp,
  getAssistProvenance,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {selectDifficultyStale} from '@/lib/chart-editor-core/selectors';
import {computeAllTrackStamps} from '@/lib/chart-editor-core/content-stamps';
import type {ChartEditorState} from '@/lib/chart-editor-core/state';
import {makeFixtureDoc} from './fixtures';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import type {ChartDocument} from '@/lib/chart-edit';
import {addDrumNote} from '@/lib/chart-edit';

/** One tier as the task produces it: notes plus the (here empty) phrase-range
 *  lists every tier carries. */
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

/** The command as the UI builds it: the tiers plus the Expert stamp captured
 *  when the run's input was built (here, `doc`'s current Expert). */
function generateOn(
  doc: ChartDocument,
  instrument: SupportedTrackInstrument = 'drums',
  tierPayload: DifficultyTierSet = tiers(),
): GenerateDifficultiesCommand {
  const expert = doc.parsedChart.trackData.find(
    t => t.instrument === instrument && t.difficulty === 'expert',
  );
  return new GenerateDifficultiesCommand(
    instrument,
    tierPayload,
    expert ? computeTrackStamp(expert) : '',
  );
}

/** Notes for one lower-difficulty track (used for staleness tests). */
function notesOf(doc: ChartDocument, difficulty: 'hard' | 'medium' | 'easy') {
  return doc.parsedChart.trackData
    .find(t => t.instrument === 'drums' && t.difficulty === difficulty)!
    .noteEventGroups.flat();
}

/** The slice of editor state the staleness selector reads. */
function stateOf(doc: ChartDocument): ChartEditorState {
  return {
    chartDoc: doc,
    trackStamps: computeAllTrackStamps(doc),
  } as unknown as ChartEditorState;
}

describe('GenerateDifficultiesCommand', () => {
  it('installs all three lower-difficulty tracks from the tier payloads', () => {
    const before = makeFixtureDoc();
    const after = generateOn(before).execute(before);

    expect(after).not.toBe(before);
    for (const difficulty of ['hard', 'medium', 'easy'] as const) {
      const notes = notesOf(after, difficulty);
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe(noteTypes.kick);
    }
  });

  it('replaces an existing lower-difficulty track wholesale', () => {
    const before = makeFixtureDoc();
    const staleHard = emptyTrackData('drums', 'hard');
    addDrumNote(staleHard, {tick: 999, type: noteTypes.redDrum});
    before.parsedChart.trackData.push(staleHard);

    const after = generateOn(before).execute(before);
    const hardNotes = notesOf(after, 'hard');
    expect(hardNotes).toHaveLength(1);
    expect(hardNotes[0].tick).toBe(0);
    expect(hardNotes[0].type).toBe(noteTypes.kick);
    // Source doc's stale track is untouched (no mutation).
    expect(notesOf(before, 'hard').some(n => n.tick === 999)).toBe(true);
  });

  it('writes assistProvenance.difficulties[instrument] with the Expert content stamp', () => {
    const before = makeFixtureDoc();
    const expertStamp = computeTrackStamp(before.parsedChart.trackData[0]);

    const after = generateOn(before).execute(before);

    expect(getAssistProvenance(after)!.difficulties!.drums!.sourceStamp).toBe(
      expertStamp,
    );
  });

  it('declares the three lower difficulty tracks in affectedTracks, and note as entityKinds', () => {
    const cmd = generateOn(makeFixtureDoc());
    expect(cmd.affectedTracks).toEqual(
      new Set([
        trackKeyId({instrument: 'drums', difficulty: 'hard'}),
        trackKeyId({instrument: 'drums', difficulty: 'medium'}),
        trackKeyId({instrument: 'drums', difficulty: 'easy'}),
      ]),
    );
    expect(cmd.entityKinds).toEqual(new Set(['note']));
  });

  it('leaves the Expert track untouched', () => {
    const before = makeFixtureDoc();
    const beforeExpert = before.parsedChart.trackData[0];
    const after = generateOn(before).execute(before);
    const afterExpert = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(afterExpert).toBe(beforeExpert);
  });

  it('keeps unrelated provenance entries (e.g. a drum-transcription record)', () => {
    const before = withAssistProvenance(makeFixtureDoc(), {
      tempoDerived: {'drum-transcription': {tempoStamp: 'xyz'}},
    });
    const after = generateOn(before).execute(before);
    expect(
      getAssistProvenance(after)!.tempoDerived!['drum-transcription'],
    ).toEqual({
      tempoStamp: 'xyz',
    });
  });

  it('is a no-op when the instrument has no Expert track', () => {
    const before = makeFixtureDoc(); // only has a drums track
    const cmd = generateOn(before, 'guitar');
    const after = cmd.execute(before);
    expect(after).toBe(before);
  });

  it('is allowed under DRUM_EDIT_CAPABILITIES, blocked under PREVIEW_CAPABILITIES/ADD_LYRICS_CAPABILITIES', () => {
    const cmd = generateOn(makeFixtureDoc());
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
    expect(isCommandAllowed(cmd, ADD_LYRICS_CAPABILITIES)).toBe(false);
  });

  it('leaves the pre-command doc intact, so an undo snapshot restore has no generated tracks or provenance', () => {
    // Undo reinstalls the pre-command doc (the `undoEntries` contract), so
    // what undo restores is exactly what `execute` must not have touched.
    const before = makeFixtureDoc();
    generateOn(before).execute(before);

    expect(
      before.parsedChart.trackData.some(t => t.difficulty === 'hard'),
    ).toBe(false);
    expect(getAssistProvenance(before)).toBeUndefined();
  });

  it('redo (re-execute against the restored doc) reinstalls the same tracks and provenance', () => {
    const before = makeFixtureDoc();
    const cmd = generateOn(before);
    const afterExecute = cmd.execute(before);

    const afterRedo = cmd.execute(before);
    expect(notesOf(afterRedo, 'hard')).toEqual(notesOf(afterExecute, 'hard'));
    expect(getAssistProvenance(afterRedo)).toEqual(
      getAssistProvenance(afterExecute),
    );
  });

  it('installs the tiers star power, solo and flex-lane ranges, timed off the target doc', () => {
    const before = makeFixtureDoc();
    const withRanges: DifficultyTierSet = {
      hard: {
        ...tier(),
        starPowerSections: [{tick: 480, length: 480}],
        rejectedStarPowerSections: [{tick: 1440, length: 240}],
        soloSections: [{tick: 0, length: 960}],
        flexLanes: [{tick: 960, length: 480, isDouble: true}],
      },
      medium: tier(),
      easy: tier(),
    };
    const after = generateOn(before, 'drums', withRanges).execute(before);
    const hard = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'hard',
    )!;

    // 480 ticks at 120 BPM with resolution 480 is one 500ms beat.
    expect(hard.starPowerSections).toEqual([
      {tick: 480, length: 480, msTime: 500, msLength: 500},
    ]);
    expect(hard.rejectedStarPowerSections).toEqual([
      {tick: 1440, length: 240, msTime: 1500, msLength: 250},
    ]);
    expect(hard.soloSections).toEqual([
      {tick: 0, length: 960, msTime: 0, msLength: 1000},
    ]);
    expect(hard.flexLanes).toEqual([
      {tick: 960, length: 480, isDouble: true, msTime: 1000, msLength: 500},
    ]);
    // A tier that authored none installs empty lists, never the replaced
    // track's.
    const medium = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'medium',
    )!;
    expect(medium.starPowerSections).toEqual([]);
    expect(medium.flexLanes).toEqual([]);
  });

  it('records the stamp captured when the run started, so an Expert edit during the run lands stale', () => {
    // The run's input is built from this Expert...
    const atRunStart = makeFixtureDoc();
    const cmd = generateOn(atRunStart);

    // ...and Expert is edited (Expert stays unlocked) before the result
    // applies.
    const edited: ChartDocument = structuredClone(atRunStart);
    addDrumNote(
      edited.parsedChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      )!,
      {tick: 5000, type: noteTypes.kick},
    );
    const after = cmd.execute(edited);

    expect(getAssistProvenance(after)!.difficulties!.drums!.sourceStamp).toBe(
      computeTrackStamp(atRunStart.parsedChart.trackData[0]),
    );
    expect(
      selectDifficultyStale(
        stateOf(after),
        'drums',
        trackKeyId({instrument: 'drums', difficulty: 'expert'}),
      ),
    ).toBe(true);
  });
});

describe('DeleteLowerDifficultiesCommand', () => {
  function docWithGenerated(): ChartDocument {
    const doc = makeFixtureDoc();
    return generateOn(doc).execute(doc);
  }

  it('removes all three lower tracks and the provenance entry as one unit', () => {
    const before = docWithGenerated();
    const after = new DeleteLowerDifficultiesCommand('drums').execute(before);

    for (const difficulty of ['hard', 'medium', 'easy'] as const) {
      expect(
        after.parsedChart.trackData.some(
          t => t.instrument === 'drums' && t.difficulty === difficulty,
        ),
      ).toBe(false);
    }
    expect(getAssistProvenance(after)!.difficulties?.drums).toBeUndefined();
  });

  it('declares the three lower difficulty tracks in affectedTracks, and note/delete', () => {
    const cmd = new DeleteLowerDifficultiesCommand('drums');
    expect(cmd.affectedTracks).toEqual(
      new Set([
        trackKeyId({instrument: 'drums', difficulty: 'hard'}),
        trackKeyId({instrument: 'drums', difficulty: 'medium'}),
        trackKeyId({instrument: 'drums', difficulty: 'easy'}),
      ]),
    );
    expect(cmd.entityKinds).toEqual(new Set(['note']));
    expect(cmd.operations).toEqual(new Set(['delete']));
  });

  it('leaves the Expert track untouched', () => {
    const before = docWithGenerated();
    const beforeExpert = before.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const after = new DeleteLowerDifficultiesCommand('drums').execute(before);
    const afterExpert = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    expect(afterExpert).toBe(beforeExpert);
  });

  it('keeps unrelated provenance entries (other instruments, drum transcription, acks)', () => {
    const before = withAssistProvenance(docWithGenerated(), {
      ...getAssistProvenance(docWithGenerated()),
      difficulties: {
        drums: {sourceStamp: 'irrelevant-will-be-overwritten'},
        guitar: {sourceStamp: 'guitar-stamp'},
      },
      tempoDerived: {'drum-transcription': {tempoStamp: 'tempo-stamp'}},
      acks: {'difficulty:drums': {ackStamp: 'ack-stamp'}},
    });
    const after = new DeleteLowerDifficultiesCommand('drums').execute(before);
    const provenance = getAssistProvenance(after)!;
    expect(provenance.difficulties).toEqual({
      guitar: {sourceStamp: 'guitar-stamp'},
    });
    expect(provenance.tempoDerived?.['drum-transcription']).toEqual({
      tempoStamp: 'tempo-stamp',
    });
    expect(provenance.acks).toEqual({
      'difficulty:drums': {ackStamp: 'ack-stamp'},
    });
  });

  it('is a no-op when there are no lower tracks and no provenance record', () => {
    const before = makeFixtureDoc();
    const after = new DeleteLowerDifficultiesCommand('drums').execute(before);
    expect(after).toBe(before);
  });

  it('is allowed under DRUM_EDIT_CAPABILITIES, blocked under PREVIEW_CAPABILITIES', () => {
    const cmd = new DeleteLowerDifficultiesCommand('drums');
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
  });

  it('leaves the pre-command doc intact, so an undo snapshot restore still has the set and its provenance', () => {
    const before = docWithGenerated();
    new DeleteLowerDifficultiesCommand('drums').execute(before);

    expect(
      before.parsedChart.trackData.some(t => t.difficulty === 'hard'),
    ).toBe(true);
    expect(getAssistProvenance(before)!.difficulties!.drums).toBeDefined();
  });

  it('redo (re-execute against the restored doc) removes the set and its provenance again', () => {
    const before = docWithGenerated();
    const cmd = new DeleteLowerDifficultiesCommand('drums');
    cmd.execute(before);

    const afterRedo = cmd.execute(before);
    expect(
      afterRedo.parsedChart.trackData.some(t => t.difficulty === 'hard'),
    ).toBe(false);
    expect(getAssistProvenance(afterRedo)!.difficulties?.drums).toBeUndefined();
  });
});

describe('difficulty staleness selector (plan 0074 Design C)', () => {
  const expertKeyId = trackKeyId({instrument: 'drums', difficulty: 'expert'});

  it('is not stale immediately after generation', () => {
    const doc = makeFixtureDoc();
    const generated = generateOn(doc).execute(doc);
    expect(
      selectDifficultyStale(stateOf(generated), 'drums', expertKeyId),
    ).toBe(false);
  });

  it('flips stale when Expert is edited after generation, and is not stale again once the edit is undone', () => {
    const doc = makeFixtureDoc();
    const generated = generateOn(doc).execute(doc);
    // `generated` stands in for the doc an `undoEntries` snapshot would
    // restore, so the note edit below must not mutate it: deep-clone
    // before mutating, exactly like a real note-edit command clones before
    // touching a track (`cloneDocWithTracks`).
    const edited: ChartDocument = structuredClone(generated);
    const expertTrack = edited.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    )!;
    addDrumNote(expertTrack, {tick: 5000, type: noteTypes.kick});

    expect(selectDifficultyStale(stateOf(edited), 'drums', expertKeyId)).toBe(
      true,
    );

    // Undo the note edit: reinstall the (untouched) post-generation doc.
    expect(
      selectDifficultyStale(stateOf(generated), 'drums', expertKeyId),
    ).toBe(false);
  });
});
