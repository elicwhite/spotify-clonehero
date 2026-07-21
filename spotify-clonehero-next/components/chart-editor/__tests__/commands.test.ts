/**
 * Command execute + snapshot-restore tests.
 *
 * Undo is snapshot replay, not command inversion (`ChartEditorContext.tsx`
 * pushes the pre-command doc onto `undoDocStack` and `useUndoRedo`
 * reinstalls it directly — commands have no `undo()` method). So each test
 * here asserts two things: `execute()` produces the expected structural
 * change, and `execute()` never mutates its input doc — which is exactly
 * what makes that input doc a valid snapshot to restore to. Equality is
 * structural (via `expectDocsEqual`) — `msTime` / `msLength` and File-blob
 * assets are stripped before compare since they don't survive the
 * writer/parser round-trip exactly bit-for-bit.
 */

import {
  AddBPMCommand,
  AddNoteCommand,
  toSchemaNote,
  translateSchemaNote,
  AddSectionCommand,
  AddTimeSignatureCommand,
  BatchCommand,
  DeleteNotesCommand,
  DeleteSectionCommand,
  MoveEntitiesCommand,
  RenameSectionCommand,
  ToggleFlagCommand,
  noteId,
} from '../commands';
import {
  expectDocsEqual,
  makeFixtureDoc,
  makeMultiPartVocalsDoc,
} from './fixtures';
import {emptyTrackData} from '@/lib/chart-edit/__tests__/test-utils';
import {
  getDrumNotes,
  drums4LaneSchema,
  guitarSchema,
  listNotes,
  addNote,
} from '@/lib/chart-edit';
import type {ChartDocument, TrackKey} from '@/lib/chart-edit';
import {noteTypes, noteFlags} from '@eliwhite/scan-chart';

const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};

/**
 * Asserts `execute()` leaves `before` structurally identical to a pristine
 * doc built the same way — i.e. `before` is still a valid pre-edit snapshot
 * for the reducer's `undoDocStack` to restore.
 */
function expectInputUntouched(
  before: ChartDocument,
  pristine: ChartDocument,
): void {
  expectDocsEqual(before, pristine);
}

describe('command execute + snapshot-restore', () => {
  describe('AddNoteCommand', () => {
    it('adds the note and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new AddNoteCommand(
        toSchemaNote({
          tick: 240,
          type: noteTypes.redDrum,
          length: 0,
          flags: 0,
        }),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      expect(after).not.toBe(before);
      expect(
        getDrumNotes(after.parsedChart.trackData[0]).some(
          n => n.tick === 240 && n.type === noteTypes.redDrum,
        ),
      ).toBe(true);
      expectInputUntouched(before, pristine);
    });

    // Regression: a note added at a non-zero tick must carry a tempo-map
    // msTime. When it stayed 0 the highway (which windows/positions by
    // msTime) rendered the note at song start — off-window — so it appeared
    // in the piano roll (positions by tick) but never on the highway.
    it('computes the new note msTime from the tempo map (push model §2)', () => {
      const before = makeFixtureDoc();
      // 720 ticks at 120 BPM / res 480 = 750ms; the tick is empty in the
      // fixture so the added event is unambiguous.
      const cmd = new AddNoteCommand(
        toSchemaNote({tick: 720, type: noteTypes.redDrum, length: 0, flags: 0}),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      const drums = after.parsedChart.trackData.find(
        t => t.instrument === 'drums',
      )!;
      const added = drums.noteEventGroups.flat().find(n => n.tick === 720)!;
      expect(added).toBeDefined();
      expect(added.msTime).toBeCloseTo(750, 5);
    });
  });

  describe('DeleteNotesCommand', () => {
    it('removes the notes and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new DeleteNotesCommand(
        new Set([
          noteId({tick: 480, type: noteTypes.redDrum}),
          noteId({tick: 1440, type: noteTypes.blueDrum}),
        ]),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      const remaining = getDrumNotes(after.parsedChart.trackData[0]);
      expect(remaining.some(n => n.tick === 480)).toBe(false);
      expect(remaining.some(n => n.tick === 1440)).toBe(false);
      expectInputUntouched(before, pristine);
    });

    it('deleting a non-existent note is a no-op (round-trip safe)', () => {
      const before = makeFixtureDoc();
      const cmd = new DeleteNotesCommand(
        new Set([noteId({tick: 99999, type: noteTypes.kick})]),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      expectDocsEqual(after, before);
    });
  });

  describe('ToggleFlagCommand', () => {
    it('toggles cymbal on and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const yellowId = noteId({tick: 960, type: noteTypes.yellowDrum});
      const cmd = new ToggleFlagCommand([yellowId], 'cymbal', DRUMS_KEY);
      const after = cmd.execute(before);
      const yellow = getDrumNotes(after.parsedChart.trackData[0]).find(
        n => n.tick === 960,
      )!;
      expect(!!(yellow.flags & noteFlags.cymbal)).toBe(false);
      expectInputUntouched(before, pristine);
    });

    it('toggling accent on from no-flag state', () => {
      const before = makeFixtureDoc();
      const redId = noteId({tick: 480, type: noteTypes.redDrum});
      const cmd = new ToggleFlagCommand([redId], 'accent', DRUMS_KEY);
      const after = cmd.execute(before);
      const red = getDrumNotes(after.parsedChart.trackData[0]).find(
        n => n.tick === 480,
      )!;
      expect(!!(red.flags & noteFlags.accent)).toBe(true);
    });

    // Plan 0067 §5: ToggleFlagCommand takes the schema explicitly, so
    // non-drum flags (HOPO/tap/strum) work when a guitar schema is passed.
    it('toggles HOPO on a guitar note when passed guitarSchema', () => {
      const GUITAR_KEY: TrackKey = {instrument: 'guitar', difficulty: 'expert'};
      const before = makeFixtureDoc();
      before.parsedChart.trackData.push(emptyTrackData('guitar', 'expert'));
      const guitar = before.parsedChart.trackData[1];
      addNote(guitar, {tick: 240, type: noteTypes.green}, guitarSchema);

      const greenId = noteId({tick: 240, type: noteTypes.green});
      const cmd = new ToggleFlagCommand(
        [greenId],
        'hopo',
        GUITAR_KEY,
        guitarSchema,
      );
      const after = cmd.execute(before);
      const guitarAfter = after.parsedChart.trackData[1];
      const green = listNotes(guitarAfter, guitarSchema).find(
        n => n.tick === 240,
      )!;
      expect(!!(green.flags & noteFlags.hopo)).toBe(true);
    });
  });

  describe('MoveEntitiesCommand (notes)', () => {
    it('moves tick + lane and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand(
        'note',
        [noteId({tick: 480, type: noteTypes.redDrum})],
        240,
        1,
        {trackKey: DRUMS_KEY},
      );
      const after = cmd.execute(before);
      expect(
        getDrumNotes(after.parsedChart.trackData[0]).some(
          n => n.tick === 480 && n.type === noteTypes.redDrum,
        ),
      ).toBe(false);
      expectInputUntouched(before, pristine);
    });

    it('moving multiple notes by the same delta', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand(
        'note',
        [
          noteId({tick: 0, type: noteTypes.kick}),
          noteId({tick: 480, type: noteTypes.redDrum}),
        ],
        240,
        0,
        {trackKey: DRUMS_KEY},
      );
      const after = cmd.execute(before);
      const notes = getDrumNotes(after.parsedChart.trackData[0]);
      expect(notes.some(n => n.tick === 240 && n.type === noteTypes.kick)).toBe(
        true,
      );
      expect(
        notes.some(n => n.tick === 720 && n.type === noteTypes.redDrum),
      ).toBe(true);
    });
  });

  describe('MoveEntitiesCommand (sections)', () => {
    it('moves the section and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand('section', ['1920'], -480, 0);
      const after = cmd.execute(before);
      expect(after.parsedChart.sections.some(s => s.tick === 1440)).toBe(true);
      expectInputUntouched(before, pristine);
    });
  });

  describe('MoveEntitiesCommand (lyrics in vocals scope)', () => {
    it('moves a lyric within the active vocal part', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand('lyric', ['vocals:240'], 120, 0, {
        partName: 'vocals',
      });
      const after = cmd.execute(before);
      const lyrics = after.parsedChart
        .vocalTracks!.parts['vocals'].notePhrases.flatMap(p => p.lyrics)
        .map(l => l.tick);
      expect(lyrics).toContain(360);
    });

    it('moves a lyric in harm1 without disturbing vocals', () => {
      const before = makeMultiPartVocalsDoc();
      const cmd = new MoveEntitiesCommand('lyric', ['harm1:120'], 60, 0, {
        partName: 'harm1',
      });
      const after = cmd.execute(before);
      const harm1Lyrics = after.parsedChart
        .vocalTracks!.parts['harm1'].notePhrases.flatMap(p => p.lyrics)
        .map(l => l.tick);
      expect(harm1Lyrics).toContain(180);
      const vocalsLyrics = after.parsedChart
        .vocalTracks!.parts['vocals'].notePhrases.flatMap(p => p.lyrics)
        .map(l => l.tick);
      expect(vocalsLyrics).toEqual([240]);
    });
  });

  describe('MoveEntitiesCommand (phrase-start)', () => {
    it('moves a phrase-start', () => {
      const before = makeFixtureDoc();
      // The fixture phrase starts at 0; bump to 60.
      const cmd = new MoveEntitiesCommand('phrase-start', ['vocals:0'], 60, 0, {
        partName: 'vocals',
      });
      const after = cmd.execute(before);
      const starts = after.parsedChart
        .vocalTracks!.parts[
          'vocals'
        ].notePhrases.filter(p => p.lyrics.length > 0)
        .map(p => p.tick);
      expect(starts).toContain(60);
    });
  });

  describe('AddBPMCommand', () => {
    it('adds/replaces a BPM marker and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new AddBPMCommand(960, 100, 'grid');
      const after = cmd.execute(before);
      expect(
        after.parsedChart.tempos.some(
          t => t.tick === 960 && t.beatsPerMinute === 100,
        ),
      ).toBe(true);
      expectInputUntouched(before, pristine);
    });

    it('replaces the tick-0 seed tempo', () => {
      const before = makeFixtureDoc();
      const cmd = new AddBPMCommand(0, 200, 'grid');
      const after = cmd.execute(before);
      expect(
        after.parsedChart.tempos.some(
          t => t.tick === 0 && t.beatsPerMinute === 200,
        ),
      ).toBe(true);
    });
  });

  describe('AddTimeSignatureCommand', () => {
    it('adds the time signature and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new AddTimeSignatureCommand(960, 3, 4);
      const after = cmd.execute(before);
      expect(
        after.parsedChart.timeSignatures.some(
          ts => ts.tick === 960 && ts.numerator === 3 && ts.denominator === 4,
        ),
      ).toBe(true);
      expectInputUntouched(before, pristine);
    });
  });

  describe('AddSectionCommand', () => {
    it('adds the section and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new AddSectionCommand(2880, 'Chorus');
      const after = cmd.execute(before);
      expect(
        after.parsedChart.sections.some(
          s => s.tick === 2880 && s.name === 'Chorus',
        ),
      ).toBe(true);
      expectInputUntouched(before, pristine);
    });
  });

  describe('DeleteSectionCommand', () => {
    it('removes the section and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new DeleteSectionCommand(1920, 'Verse');
      const after = cmd.execute(before);
      expect(after.parsedChart.sections.some(s => s.tick === 1920)).toBe(false);
      expectInputUntouched(before, pristine);
    });
  });

  describe('RenameSectionCommand', () => {
    it('renames the section and leaves the input doc untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const cmd = new RenameSectionCommand(0, 'Intro', 'Opening');
      const after = cmd.execute(before);
      expect(after.parsedChart.sections.find(s => s.tick === 0)?.name).toBe(
        'Opening',
      );
      expectInputUntouched(before, pristine);
    });
  });

  describe('BatchCommand', () => {
    it('runs sub-commands in order on execute', () => {
      const before = makeFixtureDoc();
      const order: string[] = [];
      const wrap = (label: string, inner: () => void) => ({
        description: label,
        entityKinds: new Set<never>(),
        operations: new Set<never>(),
        execute: (doc: typeof before) => {
          order.push(`${label}:execute`);
          inner();
          return doc;
        },
      });
      const batch = new BatchCommand([
        wrap('A', () => {}),
        wrap('B', () => {}),
        wrap('C', () => {}),
      ]);
      batch.execute(before);
      expect(order).toEqual(['A:execute', 'B:execute', 'C:execute']);
    });

    it('round-trips a real edit batch (add three notes), input untouched', () => {
      const pristine = makeFixtureDoc();
      const before = makeFixtureDoc();
      const batch = new BatchCommand([
        new AddNoteCommand(
          toSchemaNote({tick: 60, type: noteTypes.kick, length: 0, flags: 0}),
          DRUMS_KEY,
        ),
        new AddNoteCommand(
          toSchemaNote({
            tick: 120,
            type: noteTypes.redDrum,
            length: 0,
            flags: 0,
          }),
          DRUMS_KEY,
        ),
        new AddNoteCommand(
          toSchemaNote({
            tick: 180,
            type: noteTypes.yellowDrum,
            length: 0,
            flags: 0,
          }),
          DRUMS_KEY,
        ),
      ]);
      const after = batch.execute(before);
      const notes = getDrumNotes(after.parsedChart.trackData[0]);
      expect(notes.some(n => n.tick === 60 && n.type === noteTypes.kick)).toBe(
        true,
      );
      expect(
        notes.some(n => n.tick === 120 && n.type === noteTypes.redDrum),
      ).toBe(true);
      expect(
        notes.some(n => n.tick === 180 && n.type === noteTypes.yellowDrum),
      ).toBe(true);
      expectInputUntouched(before, pristine);
    });
  });

  // Plan 0037 Task 6: scope-aware, schema-typed clipboard — notes are
  // translated lane-by-lane between the copy source's and paste target's
  // `InstrumentSchema` rather than assuming they match.
  describe('translateSchemaNote', () => {
    it('passes the note through unchanged when source and target schemas match', () => {
      const note = toSchemaNote({
        tick: 240,
        type: noteTypes.redDrum,
        length: 0,
        flags: noteFlags.accent,
      });
      expect(
        translateSchemaNote(note, drums4LaneSchema, drums4LaneSchema),
      ).toEqual(note);
    });

    it('remaps by lane index across differently-shaped schemas', () => {
      // drums4LaneSchema lane 0 = red; guitarSchema lane 0 = open.
      const note = toSchemaNote({
        tick: 240,
        type: noteTypes.redDrum,
        length: 0,
        flags: 0,
      });
      const translated = translateSchemaNote(
        note,
        drums4LaneSchema,
        guitarSchema,
      );
      expect(translated).toEqual({...note, type: noteTypes.open});
    });

    it('drops a note whose source lane has no counterpart in the target schema', () => {
      // guitarSchema lane 5 = orange; drums4LaneSchema only has 5 lanes
      // (indices 0-4), so nothing occupies lane 5.
      const note = toSchemaNote({
        tick: 240,
        type: noteTypes.orange,
        length: 0,
        flags: 0,
      });
      expect(
        translateSchemaNote(note, guitarSchema, drums4LaneSchema),
      ).toBeNull();
    });
  });

  describe('cross-difficulty paste (AddNoteCommand with a translated note)', () => {
    it('lands the pasted note in the target track, leaving the source track untouched', () => {
      const HARD_KEY: TrackKey = {instrument: 'drums', difficulty: 'hard'};
      const before = makeFixtureDoc();
      before.parsedChart.trackData.push(emptyTrackData('drums', 'hard'));

      const sourceNote = getDrumNotes(before.parsedChart.trackData[0]).find(
        n => n.tick === 0 && n.type === noteTypes.kick,
      )!;
      expect(sourceNote).toBeDefined();

      // Same-schema translate (drums expert -> drums hard) is a passthrough;
      // paste dispatches AddNoteCommand against the target track's key.
      const pasted = translateSchemaNote(
        toSchemaNote(sourceNote),
        drums4LaneSchema,
        drums4LaneSchema,
      )!;
      const cmd = new AddNoteCommand(pasted, HARD_KEY);
      const after = cmd.execute(before);

      const hardTrack = after.parsedChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'hard',
      )!;
      expect(
        getDrumNotes(hardTrack).some(
          n => n.tick === 0 && n.type === noteTypes.kick,
        ),
      ).toBe(true);

      // The expert (source) track keeps exactly its original notes — the
      // paste only added to hard.
      const expertBefore = getDrumNotes(before.parsedChart.trackData[0]);
      const expertAfter = getDrumNotes(after.parsedChart.trackData[0]);
      expect(expertAfter).toEqual(expertBefore);
    });
  });
});
