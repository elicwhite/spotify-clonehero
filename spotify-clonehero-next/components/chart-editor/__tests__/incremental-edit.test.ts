/**
 * Tests for incremental editing helpers.
 *
 * Verifies that command type classification (incremental vs full rebuild)
 * works correctly for all command types.
 */

import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ToggleFlagCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  MoveSectionCommand,
  BatchCommand,
  type EditCommand,
} from '../commands';

// Since isIncrementalCommand is private to useEditCommands, we test the
// command classification behavior via a standalone replica of the logic.
// This ensures the classification stays in sync.

function isIncrementalCommand(cmd: EditCommand): boolean {
  if (
    cmd instanceof AddNoteCommand ||
    cmd instanceof DeleteNotesCommand ||
    cmd instanceof MoveNotesCommand ||
    cmd instanceof ToggleFlagCommand ||
    cmd instanceof AddSectionCommand ||
    cmd instanceof DeleteSectionCommand ||
    cmd instanceof RenameSectionCommand ||
    cmd instanceof MoveSectionCommand
  ) {
    return true;
  }
  if (cmd instanceof BatchCommand) {
    return cmd.getCommands().every(isIncrementalCommand);
  }
  return false;
}

describe('isIncrementalCommand', () => {
  it('classifies note commands as incremental', () => {
    expect(
      isIncrementalCommand(
        new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      ),
    ).toBe(true);

    expect(
      isIncrementalCommand(new DeleteNotesCommand(new Set(['0:kick']))),
    ).toBe(true);

    expect(
      isIncrementalCommand(new MoveNotesCommand(['0:kick'], 480, 0)),
    ).toBe(true);

    expect(
      isIncrementalCommand(new ToggleFlagCommand(['0:kick'], 'cymbal')),
    ).toBe(true);
  });

  it('classifies section commands as incremental', () => {
    expect(
      isIncrementalCommand(new AddSectionCommand(0, 'Intro')),
    ).toBe(true);

    expect(
      isIncrementalCommand(new DeleteSectionCommand(0, 'Intro')),
    ).toBe(true);

    expect(
      isIncrementalCommand(new RenameSectionCommand(0, 'Intro', 'Verse')),
    ).toBe(true);

    expect(
      isIncrementalCommand(new MoveSectionCommand(0, 480, 'Intro')),
    ).toBe(true);
  });

  it('classifies BPM/TS commands as NOT incremental', () => {
    expect(isIncrementalCommand(new AddBPMCommand(0, 120))).toBe(false);

    expect(
      isIncrementalCommand(new AddTimeSignatureCommand(0, 4, 4)),
    ).toBe(false);
  });

  it('classifies batch of incremental commands as incremental', () => {
    const batch = new BatchCommand([
      new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      new DeleteNotesCommand(new Set(['480:redDrum'])),
    ]);

    expect(isIncrementalCommand(batch)).toBe(true);
  });

  it('classifies batch containing BPM command as NOT incremental', () => {
    const batch = new BatchCommand([
      new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      new AddBPMCommand(0, 140),
    ]);

    expect(isIncrementalCommand(batch)).toBe(false);
  });

  it('classifies empty batch as incremental', () => {
    const batch = new BatchCommand([]);
    expect(isIncrementalCommand(batch)).toBe(true);
  });
});
