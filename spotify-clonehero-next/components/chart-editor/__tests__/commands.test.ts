/**
 * Command inversion tests.
 *
 * Asserts every command's `execute(doc) → undo(executedDoc)` recovers
 * the input doc. Equality is structural (via `expectDocsEqual`) —
 * `msTime` / `msLength` and File-blob assets are stripped before compare
 * since they don't survive the writer/parser round-trip exactly
 * bit-for-bit.
 */

import {
  AddBPMCommand,
  AddNoteCommand,
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
import type {TrackKey} from '@/lib/chart-edit';

const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};

describe('command inversion', () => {
  describe('AddNoteCommand', () => {
    it('execute then undo restores the original doc', () => {
      const before = makeFixtureDoc();
      const cmd = new AddNoteCommand(
        {
          tick: 240,
          type: 'redDrum',
          length: 0,
          flags: {},
        },
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      expect(after).not.toBe(before);
      expectDocsEqual(cmd.undo(after), before);
    });

    it('does not mutate the input doc', () => {
      const before = makeFixtureDoc();
      const cmd = new AddNoteCommand(
        {
          tick: 240,
          type: 'kick',
          length: 0,
          flags: {},
        },
        DRUMS_KEY,
      );
      const snap = JSON.parse(
        JSON.stringify(
          before.parsedChart.trackData[0].noteEventGroups.flat().map(n => ({
            tick: n.tick,
            type: n.type,
          })),
        ),
      );
      cmd.execute(before);
      const post = before.parsedChart.trackData[0].noteEventGroups
        .flat()
        .map(n => ({tick: n.tick, type: n.type}));
      expect(post).toEqual(snap);
    });
  });

  describe('DeleteNotesCommand', () => {
    it('execute then undo restores the deleted notes', () => {
      const before = makeFixtureDoc();
      const cmd = new DeleteNotesCommand(
        new Set([
          noteId({tick: 480, type: 'redDrum'}),
          noteId({tick: 1440, type: 'blueDrum'}),
        ]),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });

    it('deleting a non-existent note is a no-op (round-trip safe)', () => {
      const before = makeFixtureDoc();
      const cmd = new DeleteNotesCommand(
        new Set([noteId({tick: 99999, type: 'kick'})]),
        DRUMS_KEY,
      );
      const after = cmd.execute(before);
      expectDocsEqual(after, before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('ToggleFlagCommand', () => {
    it('toggling cymbal twice returns to the original state', () => {
      const before = makeFixtureDoc();
      const yellowId = noteId({tick: 960, type: 'yellowDrum'});
      const cmd = new ToggleFlagCommand([yellowId], 'cymbal', DRUMS_KEY);
      const after = cmd.execute(before);
      const restored = cmd.undo(after);
      expectDocsEqual(restored, before);
    });

    it('execute then undo when starting from no cymbal', () => {
      const before = makeFixtureDoc();
      const redId = noteId({tick: 480, type: 'redDrum'});
      const cmd = new ToggleFlagCommand([redId], 'accent', DRUMS_KEY);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('MoveEntitiesCommand (notes)', () => {
    it('execute then undo restores tick + lane', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand(
        'note',
        [noteId({tick: 480, type: 'redDrum'})],
        240,
        1,
      );
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });

    it('moving multiple notes by the same delta round-trips', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand(
        'note',
        [noteId({tick: 0, type: 'kick'}), noteId({tick: 480, type: 'redDrum'})],
        240,
        0,
      );
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('MoveEntitiesCommand (sections)', () => {
    it('execute then undo restores the section', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand('section', ['1920'], -480, 0);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('MoveEntitiesCommand (lyrics in vocals scope)', () => {
    it('round-trips a lyric move within the active vocal part', () => {
      const before = makeFixtureDoc();
      const cmd = new MoveEntitiesCommand('lyric', ['vocals:240'], 120, 0, {
        partName: 'vocals',
      });
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });

    it('round-trips a lyric move in harm1 without disturbing vocals', () => {
      const before = makeMultiPartVocalsDoc();
      const cmd = new MoveEntitiesCommand('lyric', ['harm1:120'], 60, 0, {
        partName: 'harm1',
      });
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('MoveEntitiesCommand (phrase-start)', () => {
    it('round-trips a phrase-start move', () => {
      const before = makeFixtureDoc();
      // The fixture phrase starts at 0; bump to 60 then undo.
      const cmd = new MoveEntitiesCommand('phrase-start', ['vocals:0'], 60, 0, {
        partName: 'vocals',
      });
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('AddBPMCommand', () => {
    it('execute then undo removes the added tempo', () => {
      const before = makeFixtureDoc();
      const cmd = new AddBPMCommand(960, 100);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });

    it('adding at tick 0 is a no-op on undo (replaces the default)', () => {
      const before = makeFixtureDoc();
      const cmd = new AddBPMCommand(0, 200);
      const after = cmd.execute(before);
      // Undo at tick 0 returns the doc unchanged (special case: don't
      // remove the seed tempo).
      const restored = cmd.undo(after);
      expect(restored).toBe(after);
    });
  });

  describe('AddTimeSignatureCommand', () => {
    it('execute then undo removes the added time signature', () => {
      const before = makeFixtureDoc();
      const cmd = new AddTimeSignatureCommand(960, 3, 4);
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('AddSectionCommand', () => {
    it('execute then undo removes the section', () => {
      const before = makeFixtureDoc();
      const cmd = new AddSectionCommand(2880, 'Chorus');
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('DeleteSectionCommand', () => {
    it('execute then undo restores the deleted section', () => {
      const before = makeFixtureDoc();
      const cmd = new DeleteSectionCommand(1920, 'Verse');
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('RenameSectionCommand', () => {
    it('execute then undo restores the original name', () => {
      const before = makeFixtureDoc();
      const cmd = new RenameSectionCommand(0, 'Intro', 'Opening');
      const after = cmd.execute(before);
      expectDocsEqual(cmd.undo(after), before);
    });
  });

  describe('BatchCommand', () => {
    it('runs sub-commands in order on execute', () => {
      const before = makeFixtureDoc();
      const order: string[] = [];
      const wrap = (label: string, inner: () => void) => ({
        description: label,
        execute: (doc: typeof before) => {
          order.push(`${label}:execute`);
          inner();
          return doc;
        },
        undo: (doc: typeof before) => {
          order.push(`${label}:undo`);
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

    it('runs sub-commands in reverse order on undo', () => {
      const before = makeFixtureDoc();
      const order: string[] = [];
      const wrap = (label: string) => ({
        description: label,
        execute: (doc: typeof before) => {
          order.push(`${label}:execute`);
          return doc;
        },
        undo: (doc: typeof before) => {
          order.push(`${label}:undo`);
          return doc;
        },
      });
      const batch = new BatchCommand([wrap('A'), wrap('B'), wrap('C')]);
      batch.execute(before);
      order.length = 0;
      batch.undo(before);
      expect(order).toEqual(['C:undo', 'B:undo', 'A:undo']);
    });

    it('round-trips a real edit batch (add three notes)', () => {
      const before = makeFixtureDoc();
      const batch = new BatchCommand([
        new AddNoteCommand(
          {tick: 60, type: 'kick', length: 0, flags: {}},
          DRUMS_KEY,
        ),
        new AddNoteCommand(
          {
            tick: 120,
            type: 'redDrum',
            length: 0,
            flags: {},
          },
          DRUMS_KEY,
        ),
        new AddNoteCommand(
          {
            tick: 180,
            type: 'yellowDrum',
            length: 0,
            flags: {},
          },
          DRUMS_KEY,
        ),
      ]);
      const after = batch.execute(before);
      expectDocsEqual(batch.undo(after), before);
    });
  });
});
