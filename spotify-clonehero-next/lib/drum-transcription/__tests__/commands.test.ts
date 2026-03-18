/**
 * Tests for the EditCommand pattern (0007a).
 *
 * Verifies that each command correctly transforms a ChartDocument
 * and that undo reverses the transformation.
 */

import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ToggleFlagCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  BatchCommand,
  noteId,
  typeToLane,
  laneToType,
  shiftLane,
  defaultFlagsForType,
} from '@/app/drum-transcription/commands';
import type {ChartDocument, DrumNote} from '../chart-io/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDoc(notes: DrumNote[] = []): ChartDocument {
  return {
    resolution: 480,
    metadata: {
      name: 'Test Song',
      artist: 'Test Artist',
      resolution: 480,
    },
    tempos: [{tick: 0, bpm: 120}],
    timeSignatures: [{tick: 0, numerator: 4, denominator: 4}],
    sections: [],
    endEvents: [],
    tracks: [
      {
        instrument: 'drums',
        difficulty: 'expert',
        notes,
      },
    ],
  };
}

function getExpertNotes(doc: ChartDocument): DrumNote[] {
  const track = doc.tracks.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  return track?.notes ?? [];
}

// ---------------------------------------------------------------------------
// noteId
// ---------------------------------------------------------------------------

describe('noteId', () => {
  it('creates a composite key from tick and type', () => {
    expect(noteId({tick: 480, type: 'red'})).toBe('480:red');
    expect(noteId({tick: 0, type: 'kick'})).toBe('0:kick');
  });
});

// ---------------------------------------------------------------------------
// Lane helpers
// ---------------------------------------------------------------------------

describe('lane helpers', () => {
  it('typeToLane maps drum types to lane indices', () => {
    expect(typeToLane('kick')).toBe(0);
    expect(typeToLane('red')).toBe(1);
    expect(typeToLane('yellow')).toBe(2);
    expect(typeToLane('blue')).toBe(3);
    expect(typeToLane('green')).toBe(4);
  });

  it('laneToType maps lane indices to drum types', () => {
    expect(laneToType(0)).toBe('kick');
    expect(laneToType(1)).toBe('red');
    expect(laneToType(2)).toBe('yellow');
    expect(laneToType(3)).toBe('blue');
    expect(laneToType(4)).toBe('green');
  });

  it('laneToType clamps out-of-range values', () => {
    expect(laneToType(-1)).toBe('kick');
    expect(laneToType(5)).toBe('green');
    expect(laneToType(100)).toBe('green');
  });

  it('shiftLane moves a type by delta', () => {
    expect(shiftLane('kick', 1)).toBe('red');
    expect(shiftLane('red', 2)).toBe('blue');
    expect(shiftLane('green', -1)).toBe('blue');
  });

  it('shiftLane clamps at boundaries', () => {
    expect(shiftLane('kick', -1)).toBe('kick');
    expect(shiftLane('green', 1)).toBe('green');
  });

  it('defaultFlagsForType returns cymbal for yellow/blue/green', () => {
    expect(defaultFlagsForType('yellow')).toEqual({cymbal: true});
    expect(defaultFlagsForType('blue')).toEqual({cymbal: true});
    expect(defaultFlagsForType('green')).toEqual({cymbal: true});
  });

  it('defaultFlagsForType returns empty for kick and red', () => {
    expect(defaultFlagsForType('kick')).toEqual({});
    expect(defaultFlagsForType('red')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

describe('AddNoteCommand', () => {
  it('adds a note to an empty track', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'red', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(1);
    expect(notes[0].tick).toBe(480);
    expect(notes[0].type).toBe('red');
  });

  it('maintains sort order when inserting', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick', length: 0, flags: {}},
      {tick: 960, type: 'red', length: 0, flags: {}},
    ]);
    const note: DrumNote = {tick: 480, type: 'yellow', length: 0, flags: {cymbal: true}};
    const cmd = new AddNoteCommand(note);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(3);
    expect(notes[0].tick).toBe(0);
    expect(notes[1].tick).toBe(480);
    expect(notes[2].tick).toBe(960);
  });

  it('does not add a duplicate', () => {
    const existing: DrumNote = {tick: 480, type: 'red', length: 0, flags: {}};
    const doc = makeDoc([existing]);
    const cmd = new AddNoteCommand({...existing});

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)).toHaveLength(1);
  });

  it('undo removes the added note', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'red', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    const after = cmd.execute(doc);
    expect(getExpertNotes(after)).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)).toHaveLength(0);
  });

  it('does not mutate the original document', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'red', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    cmd.execute(doc);
    expect(getExpertNotes(doc)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DeleteNotesCommand
// ---------------------------------------------------------------------------

describe('DeleteNotesCommand', () => {
  it('removes notes by ID', () => {
    const notes: DrumNote[] = [
      {tick: 0, type: 'kick', length: 0, flags: {}},
      {tick: 480, type: 'red', length: 0, flags: {}},
      {tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}},
    ];
    const doc = makeDoc(notes);
    const cmd = new DeleteNotesCommand(new Set(['480:red']));

    const result = cmd.execute(doc);
    const remaining = getExpertNotes(result);
    expect(remaining).toHaveLength(2);
    expect(remaining.map(n => n.type)).toEqual(['kick', 'yellow']);
  });

  it('undo restores deleted notes', () => {
    const notes: DrumNote[] = [
      {tick: 0, type: 'kick', length: 0, flags: {}},
      {tick: 480, type: 'red', length: 0, flags: {accent: true}},
    ];
    const doc = makeDoc(notes);
    const cmd = new DeleteNotesCommand(new Set(['480:red']));

    const after = cmd.execute(doc);
    expect(getExpertNotes(after)).toHaveLength(1);

    const reverted = cmd.undo(after);
    const restored = getExpertNotes(reverted);
    expect(restored).toHaveLength(2);
    expect(restored[1].type).toBe('red');
    expect(restored[1].flags.accent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MoveNotesCommand
// ---------------------------------------------------------------------------

describe('MoveNotesCommand', () => {
  it('moves notes by tick and lane delta', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'red', length: 0, flags: {}},
    ];
    const doc = makeDoc(notes);
    const cmd = new MoveNotesCommand(['480:red'], 240, 1);

    const result = cmd.execute(doc);
    const moved = getExpertNotes(result);
    expect(moved).toHaveLength(1);
    expect(moved[0].tick).toBe(720);
    expect(moved[0].type).toBe('yellow');
  });

  it('clamps tick to 0', () => {
    const notes: DrumNote[] = [
      {tick: 100, type: 'kick', length: 0, flags: {}},
    ];
    const doc = makeDoc(notes);
    const cmd = new MoveNotesCommand(['100:kick'], -200, 0);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].tick).toBe(0);
  });

  it('undo reverses the move', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'red', length: 0, flags: {}},
    ];
    const doc = makeDoc(notes);
    const cmd = new MoveNotesCommand(['480:red'], 240, 1);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    const restored = getExpertNotes(reverted);
    expect(restored[0].tick).toBe(480);
    expect(restored[0].type).toBe('red');
  });
});

// ---------------------------------------------------------------------------
// ToggleFlagCommand
// ---------------------------------------------------------------------------

describe('ToggleFlagCommand', () => {
  it('toggles cymbal flag on', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'yellow', length: 0, flags: {}},
    ];
    const doc = makeDoc(notes);
    const cmd = new ToggleFlagCommand(['480:yellow'], 'cymbal');

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].flags.cymbal).toBe(true);
  });

  it('toggles cymbal flag off', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'yellow', length: 0, flags: {cymbal: true}},
    ];
    const doc = makeDoc(notes);
    const cmd = new ToggleFlagCommand(['480:yellow'], 'cymbal');

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].flags.cymbal).toBe(false);
  });

  it('undo restores original flag state', () => {
    const notes: DrumNote[] = [
      {tick: 480, type: 'yellow', length: 0, flags: {cymbal: true}},
    ];
    const doc = makeDoc(notes);
    const cmd = new ToggleFlagCommand(['480:yellow'], 'cymbal');

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)[0].flags.cymbal).toBe(true);
  });

  it('toggles accent on multiple notes', () => {
    const notes: DrumNote[] = [
      {tick: 0, type: 'red', length: 0, flags: {}},
      {tick: 480, type: 'red', length: 0, flags: {}},
    ];
    const doc = makeDoc(notes);
    const cmd = new ToggleFlagCommand(['0:red', '480:red'], 'accent');

    const result = cmd.execute(doc);
    const edited = getExpertNotes(result);
    expect(edited[0].flags.accent).toBe(true);
    expect(edited[1].flags.accent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AddBPMCommand
// ---------------------------------------------------------------------------

describe('AddBPMCommand', () => {
  it('adds a new BPM marker', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(480, 140);

    const result = cmd.execute(doc);
    expect(result.tempos).toHaveLength(2);
    expect(result.tempos[1]).toEqual({tick: 480, bpm: 140});
  });

  it('updates existing BPM marker at the same tick', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(0, 140);

    const result = cmd.execute(doc);
    expect(result.tempos).toHaveLength(1);
    expect(result.tempos[0].bpm).toBe(140);
  });

  it('maintains sort order', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      tempos: [
        {tick: 0, bpm: 120},
        {tick: 960, bpm: 150},
      ],
    };
    const cmd = new AddBPMCommand(480, 130);

    const result = cmd.execute(doc);
    expect(result.tempos).toHaveLength(3);
    expect(result.tempos[0].tick).toBe(0);
    expect(result.tempos[1].tick).toBe(480);
    expect(result.tempos[2].tick).toBe(960);
  });

  it('undo removes the added marker', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(480, 140);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.tempos).toHaveLength(1);
    expect(reverted.tempos[0].tick).toBe(0);
  });

  it('undo does not remove the marker at tick 0', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(0, 140);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.tempos).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AddTimeSignatureCommand
// ---------------------------------------------------------------------------

describe('AddTimeSignatureCommand', () => {
  it('adds a new time signature', () => {
    const doc = makeDoc();
    const cmd = new AddTimeSignatureCommand(480, 3, 4);

    const result = cmd.execute(doc);
    expect(result.timeSignatures).toHaveLength(2);
    expect(result.timeSignatures[1]).toEqual({
      tick: 480,
      numerator: 3,
      denominator: 4,
    });
  });

  it('updates existing time signature at the same tick', () => {
    const doc = makeDoc();
    const cmd = new AddTimeSignatureCommand(0, 6, 8);

    const result = cmd.execute(doc);
    expect(result.timeSignatures).toHaveLength(1);
    expect(result.timeSignatures[0].numerator).toBe(6);
    expect(result.timeSignatures[0].denominator).toBe(8);
  });

  it('undo removes the added time signature', () => {
    const doc = makeDoc();
    const cmd = new AddTimeSignatureCommand(480, 3, 4);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.timeSignatures).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// BatchCommand
// ---------------------------------------------------------------------------

describe('BatchCommand', () => {
  it('executes all commands in order', () => {
    const doc = makeDoc();
    const cmd = new BatchCommand([
      new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      new AddNoteCommand({tick: 480, type: 'red', length: 0, flags: {}}),
      new AddNoteCommand({tick: 960, type: 'yellow', length: 0, flags: {cymbal: true}}),
    ]);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)).toHaveLength(3);
  });

  it('undo reverses all commands in reverse order', () => {
    const doc = makeDoc();
    const cmd = new BatchCommand([
      new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      new AddNoteCommand({tick: 480, type: 'red', length: 0, flags: {}}),
    ]);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)).toHaveLength(0);
  });

  it('can combine different command types', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick', length: 0, flags: {}},
    ]);
    const cmd = new BatchCommand([
      new AddNoteCommand({tick: 480, type: 'red', length: 0, flags: {}}),
      new DeleteNotesCommand(new Set(['0:kick'])),
    ]);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('red');
  });
});
