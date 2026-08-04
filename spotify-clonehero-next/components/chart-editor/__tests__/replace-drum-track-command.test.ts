/**
 * ReplaceDrumTrackCommand tests (plan 0074 Design A).
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {ReplaceDrumTrackCommand} from '../commands';
import type {ReplaceDrumTrackSync} from '../commands';
import {trackKeyId} from '@/lib/chart-editor-core/trackInventory';
import {
  ADD_LYRICS_CAPABILITIES,
  DRUM_EDIT_CAPABILITIES,
  PREVIEW_CAPABILITIES,
} from '../capabilities';
import {isCommandAllowed} from '@/lib/chart-editor-core/capabilityGate';
import {
  computeTempoStamp,
  getAssistProvenance,
  withAssistProvenance,
} from '@/lib/chart-editor-core/content-stamps';
import {makeFixtureDoc, makeEmptyDrumDoc} from './fixtures';
import {emptyTrackData, mkSection} from '@/lib/chart-edit/__tests__/test-utils';
import type {DrumNote} from '@/lib/chart-edit';
import {
  addSection,
  addTempo,
  getAudioAnchor,
  setAudioAnchor,
} from '@/lib/chart-edit';

function transcribedNotes(): DrumNote[] {
  return [
    {tick: 0, type: noteTypes.kick, length: 0, flags: 0},
    {tick: 240, type: noteTypes.redDrum, length: 0, flags: 0},
    {
      tick: 480,
      type: noteTypes.yellowDrum,
      length: 0,
      flags: noteFlags.cymbal,
    },
  ];
}

describe('ReplaceDrumTrackCommand', () => {
  it('replaces only the Drums Expert track notes', () => {
    const before = makeFixtureDoc();
    const newNotes = transcribedNotes();

    const cmd = new ReplaceDrumTrackCommand(newNotes);
    const after = cmd.execute(before);

    expect(after).not.toBe(before);
    const drumsTrack = after.parsedChart.trackData.find(
      t => t.instrument === 'drums' && t.difficulty === 'expert',
    );
    const notes = drumsTrack!.noteEventGroups
      .flat()
      .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
      .sort((a, b) => a.tick - b.tick);

    expect(notes).toEqual([
      {tick: 0, type: noteTypes.kick, flags: 0},
      {tick: 240, type: noteTypes.redDrum, flags: 0},
      {tick: 480, type: noteTypes.yellowDrum, flags: noteFlags.cymbal},
    ]);
  });

  it('declares the replaced drums track in affectedTracks', () => {
    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    expect(cmd.affectedTracks).toEqual(
      new Set([trackKeyId({instrument: 'drums', difficulty: 'expert'})]),
    );
  });

  it('still declares just the drums track under options.sync, even though entityKinds gains tempo/timesig', () => {
    const sync: ReplaceDrumTrackSync = {
      resolution: 480,
      tempos: [{tick: 0, beatsPerMinute: 140, msTime: 0}],
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4, msTime: 0, msLength: 2000},
      ],
    };
    const cmd = new ReplaceDrumTrackCommand(transcribedNotes(), {sync});
    expect(cmd.affectedTracks).toEqual(
      new Set([trackKeyId({instrument: 'drums', difficulty: 'expert'})]),
    );
    expect(cmd.entityKinds).toEqual(new Set(['note', 'tempo', 'timesig']));
  });

  it('clears phrases, lanes, and events on the replaced track that the run did not author', () => {
    const before = makeFixtureDoc();
    const drums = before.parsedChart.trackData[0];
    drums.starPowerSections = [mkSection({tick: 0, length: 1920})];
    drums.rejectedStarPowerSections = [mkSection({tick: 1920, length: 480})];
    drums.soloSections = [mkSection({tick: 480, length: 480})];
    drums.flexLanes = [mkSection({tick: 960, length: 480, isDouble: false})];
    drums.drumFreestyleSections = [
      mkSection({tick: 1440, length: 480, isCoda: false}),
    ];
    drums.textEvents = [mkSection({tick: 0, text: '[mix 3 drums1]'})];
    drums.versusPhrases = [mkSection({tick: 0, length: 480, isPlayer2: false})];
    drums.animations = [mkSection({tick: 0, length: 60, noteNumber: 41})];

    const after = new ReplaceDrumTrackCommand(transcribedNotes()).execute(
      before,
    );
    const track = after.parsedChart.trackData[0];

    expect(track.starPowerSections).toEqual([]);
    expect(track.rejectedStarPowerSections).toEqual([]);
    expect(track.soloSections).toEqual([]);
    expect(track.flexLanes).toEqual([]);
    expect(track.drumFreestyleSections).toEqual([]);
    expect(track.textEvents).toEqual([]);
    expect(track.versusPhrases).toEqual([]);
    expect(track.animations).toEqual([]);
    expect(track.unrecognizedMidiEvents).toEqual([]);
    // Track identity survives.
    expect(track.instrument).toBe('drums');
    expect(track.difficulty).toBe('expert');
    // The source doc keeps its own phrases (no mutation).
    expect(before.parsedChart.trackData[0].starPowerSections).toHaveLength(1);
  });

  it('leaves a non-target track untouched', () => {
    const before = makeFixtureDoc();
    const guitar = emptyTrackData('guitar', 'expert', {
      starPowerSections: [mkSection({tick: 0, length: 960})],
    });
    before.parsedChart.trackData.push(guitar);

    const after = new ReplaceDrumTrackCommand(transcribedNotes()).execute(
      before,
    );
    const afterGuitar = after.parsedChart.trackData.find(
      t => t.instrument === 'guitar',
    );

    expect(afterGuitar!.starPowerSections).toEqual([
      mkSection({tick: 0, length: 960}),
    ]);
  });

  it('leaves other tracks, tempo, sections, and lyrics untouched', () => {
    const before = makeFixtureDoc();
    const beforeSections = before.parsedChart.sections;
    const beforeTempos = before.parsedChart.tempos;
    const beforeVocals = before.parsedChart.vocalTracks;

    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    const after = cmd.execute(before);

    // Non-drums-track chart state is shared by reference, not just
    // structurally equal, matching AddNoteCommand's `cloneDocWithTracks`
    // scoping contract.
    expect(after.parsedChart.sections).toBe(beforeSections);
    expect(after.parsedChart.tempos).toBe(beforeTempos);
    expect(after.parsedChart.vocalTracks).toBe(beforeVocals);
  });

  it('does not mutate the input doc', () => {
    const before = makeFixtureDoc();
    const originalTrack = before.parsedChart.trackData[0];
    const originalGroups = originalTrack.noteEventGroups;

    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    cmd.execute(before);

    expect(before.parsedChart.trackData[0]).toBe(originalTrack);
    expect(before.parsedChart.trackData[0].noteEventGroups).toBe(
      originalGroups,
    );
  });

  it('is a no-op when the chart has no Drums Expert track', () => {
    const parsed = makeEmptyDrumDoc();
    parsed.parsedChart.trackData = [];
    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    const after = cmd.execute(parsed);
    expect(after).toBe(parsed);
  });

  it('undo/redo round-trips via whole-doc snapshot restore', () => {
    // Simulates the undo/redo contract commands rely on: execute produces a
    // new doc; restoring the pre-execute snapshot brings back the original
    // notes; re-executing against that restored doc reproduces the same
    // transcribed result.
    const before = makeFixtureDoc();
    addSection(before, 2400, 'Chorus');
    addTempo(before, 2400, 100);
    const originalNotes = before.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
      .sort((a, b) => a.tick - b.tick);

    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    const afterExecute = cmd.execute(before);

    // Undo: reinstall the pre-command doc (the `undoDocStack` contract).
    const afterUndo = before;
    const undoneNotes = afterUndo.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
      .sort((a, b) => a.tick - b.tick);
    expect(undoneNotes).toEqual(originalNotes);

    // Redo: re-execute the same command against the restored doc.
    const afterRedo = cmd.execute(afterUndo);
    const redoneNotes = afterRedo.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
      .sort((a, b) => a.tick - b.tick);
    const expectedNotes = afterExecute.parsedChart.trackData[0].noteEventGroups
      .flat()
      .map(n => ({tick: n.tick, type: n.type, flags: n.flags}))
      .sort((a, b) => a.tick - b.tick);
    expect(redoneNotes).toEqual(expectedNotes);
  });

  describe('with a regenerated SyncTrack', () => {
    const sync: ReplaceDrumTrackSync = {
      resolution: 192,
      tempos: [{tick: 0, beatsPerMinute: 132, msTime: 0}],
      timeSignatures: [
        {tick: 0, numerator: 3, denominator: 4, msTime: 0, msLength: 0},
      ],
    };

    it('adopts the resolution, tempos, and time signatures the notes were authored against', () => {
      const before = makeFixtureDoc();
      const after = new ReplaceDrumTrackCommand(transcribedNotes(), {
        sync,
      }).execute(before);

      expect(after.parsedChart.resolution).toBe(192);
      expect(after.parsedChart.tempos).toEqual(sync.tempos);
      expect(after.parsedChart.timeSignatures).toMatchObject(
        sync.timeSignatures,
      );
      // The source doc keeps its own grid (no mutation).
      expect(before.parsedChart.resolution).toBe(480);
      expect(before.parsedChart.tempos.length).toBe(2);
    });

    it('times the new notes under the adopted map, not the old one', () => {
      const after = new ReplaceDrumTrackCommand(transcribedNotes(), {
        sync,
      }).execute(makeFixtureDoc());

      const notes = after.parsedChart.trackData[0].noteEventGroups
        .flat()
        .sort((a, b) => a.tick - b.tick);
      // tick 480 at 132 BPM / 192 ticks per beat = 2.5 beats.
      expect(notes[2].msTime).toBeCloseTo((2.5 * 60000) / 132, 3);
    });

    it('retimes the rest of the doc under the adopted map', () => {
      const after = new ReplaceDrumTrackCommand(transcribedNotes(), {
        sync,
      }).execute(makeFixtureDoc());

      const verse = after.parsedChart.sections.find(s => s.tick === 1920);
      expect(verse!.msTime).toBeCloseTo((1920 / 192 / 132) * 60000, 3);
    });

    it('clears the leading-silence anchor when asked', () => {
      const before = setAudioAnchor(makeFixtureDoc(), {tick: 480, ms: 500});
      const after = new ReplaceDrumTrackCommand(transcribedNotes(), {
        sync,
        clearAudioAnchor: true,
      }).execute(before);

      expect(getAudioAnchor(after)).toBeNull();
      expect(getAudioAnchor(before)).toEqual({tick: 480, ms: 500});
    });

    it('declares tempo and time-signature intent so the capability gate sees it', () => {
      const cmd = new ReplaceDrumTrackCommand(transcribedNotes(), {sync});
      expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
      expect(isCommandAllowed(cmd, ADD_LYRICS_CAPABILITIES)).toBe(false);
    });
  });

  it('is allowed under DRUM_EDIT_CAPABILITIES, blocked under PREVIEW_CAPABILITIES', () => {
    const cmd = new ReplaceDrumTrackCommand(transcribedNotes());
    expect(isCommandAllowed(cmd, DRUM_EDIT_CAPABILITIES)).toBe(true);
    expect(isCommandAllowed(cmd, PREVIEW_CAPABILITIES)).toBe(false);
  });
});

describe('ReplaceDrumTrackCommand provenance (plan 0074 Design C)', () => {
  it('records the tempo stamp the notes were authored against', () => {
    const before = makeFixtureDoc();
    expect(getAssistProvenance(before)).toBeUndefined();

    const after = new ReplaceDrumTrackCommand(transcribedNotes()).execute(
      before,
    );
    // Written by the generating command itself, so undo removes the notes
    // and the record together — no separate bookkeeping command needed at
    // any call site.
    expect(
      getAssistProvenance(after)!.tempoDerived!['drum-transcription']!
        .tempoStamp,
    ).toBe(computeTempoStamp(after));
  });

  it('stamps against the adopted grid when the run brought its own', () => {
    const sync: ReplaceDrumTrackSync = {
      resolution: 480,
      tempos: [{tick: 0, beatsPerMinute: 140, msTime: 0}],
      timeSignatures: [
        {tick: 0, numerator: 4, denominator: 4, msTime: 0, msLength: 2000},
      ],
    };
    const after = new ReplaceDrumTrackCommand(transcribedNotes(), {
      sync,
    }).execute(makeFixtureDoc());
    expect(
      getAssistProvenance(after)!.tempoDerived!['drum-transcription']!
        .tempoStamp,
    ).toBe(computeTempoStamp(after));
  });

  it('keeps unrelated provenance entries (e.g. difficulty records)', () => {
    const before = withAssistProvenance(makeFixtureDoc(), {
      difficulties: {guitar: {sourceStamp: 'abc'}},
    });
    const after = new ReplaceDrumTrackCommand(transcribedNotes()).execute(
      before,
    );
    expect(getAssistProvenance(after)!.difficulties).toEqual({
      guitar: {sourceStamp: 'abc'},
    });
  });
});
