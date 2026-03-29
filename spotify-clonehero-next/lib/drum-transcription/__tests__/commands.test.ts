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
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  MoveSectionCommand,
  BatchCommand,
  noteId,
  typeToLane,
  laneToType,
  shiftLane,
  defaultFlagsForType,
} from '@/app/drum-transcription/commands';
import type {ChartDocument, DrumNote, DrumNoteType, TrackData} from '@/lib/chart-edit';
import {createChart, addDrumNote, getDrumNotes} from '@/lib/chart-edit';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDoc(notes: Array<{tick: number; type: DrumNoteType; flags?: DrumNote['flags']; length?: number}> = []): ChartDocument {
  const doc = createChart();
  // Add an expert drums track
  const track = {
    instrument: 'drums',
    difficulty: 'expert',
    trackEvents: [],
    starPowerSections: [],
    rejectedStarPowerSections: [],
    soloSections: [],
    flexLanes: [],
    drumFreestyleSections: [],
    noteEventGroups: [],
  } as unknown as TrackData;
  doc.trackData.push(track);

  for (const n of notes) {
    addDrumNote(track, {
      tick: n.tick,
      type: n.type,
      length: n.length ?? 0,
      flags: n.flags ?? {},
    });
  }

  return doc;
}

function getExpertNotes(doc: ChartDocument): DrumNote[] {
  const track = doc.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) return [];
  return getDrumNotes(track);
}

// ---------------------------------------------------------------------------
// noteId
// ---------------------------------------------------------------------------

describe('noteId', () => {
  it('creates a composite key from tick and type', () => {
    expect(noteId({tick: 480, type: 'redDrum'})).toBe('480:redDrum');
    expect(noteId({tick: 0, type: 'kick'})).toBe('0:kick');
  });
});

// ---------------------------------------------------------------------------
// Lane helpers
// ---------------------------------------------------------------------------

describe('lane helpers', () => {
  it('typeToLane maps drum types to lane indices', () => {
    expect(typeToLane('kick')).toBe(0);
    expect(typeToLane('redDrum')).toBe(1);
    expect(typeToLane('yellowDrum')).toBe(2);
    expect(typeToLane('blueDrum')).toBe(3);
    expect(typeToLane('greenDrum')).toBe(4);
  });

  it('laneToType maps lane indices to drum types', () => {
    expect(laneToType(0)).toBe('kick');
    expect(laneToType(1)).toBe('redDrum');
    expect(laneToType(2)).toBe('yellowDrum');
    expect(laneToType(3)).toBe('blueDrum');
    expect(laneToType(4)).toBe('greenDrum');
  });

  it('laneToType clamps out-of-range values', () => {
    expect(laneToType(-1)).toBe('kick');
    expect(laneToType(5)).toBe('greenDrum');
    expect(laneToType(100)).toBe('greenDrum');
  });

  it('shiftLane moves a type by delta', () => {
    expect(shiftLane('kick', 1)).toBe('redDrum');
    expect(shiftLane('redDrum', 2)).toBe('blueDrum');
    expect(shiftLane('greenDrum', -1)).toBe('blueDrum');
  });

  it('shiftLane clamps at boundaries', () => {
    expect(shiftLane('kick', -1)).toBe('kick');
    expect(shiftLane('greenDrum', 1)).toBe('greenDrum');
  });

  it('defaultFlagsForType returns cymbal for yellow/blue/green', () => {
    expect(defaultFlagsForType('yellowDrum')).toEqual({cymbal: true});
    expect(defaultFlagsForType('blueDrum')).toEqual({cymbal: true});
    expect(defaultFlagsForType('greenDrum')).toEqual({cymbal: true});
  });

  it('defaultFlagsForType returns empty for kick and red', () => {
    expect(defaultFlagsForType('kick')).toEqual({});
    expect(defaultFlagsForType('redDrum')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// AddNoteCommand
// ---------------------------------------------------------------------------

describe('AddNoteCommand', () => {
  it('adds a note to an empty track', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'redDrum', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(1);
    expect(notes[0].tick).toBe(480);
    expect(notes[0].type).toBe('redDrum');
  });

  it('maintains sort order when inserting', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick'},
      {tick: 960, type: 'redDrum'},
    ]);
    const note: DrumNote = {tick: 480, type: 'yellowDrum', length: 0, flags: {cymbal: true}};
    const cmd = new AddNoteCommand(note);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(3);
    expect(notes[0].tick).toBe(0);
    expect(notes[1].tick).toBe(480);
    expect(notes[2].tick).toBe(960);
  });

  it('does not add a duplicate', () => {
    const doc = makeDoc([{tick: 480, type: 'redDrum'}]);
    const note: DrumNote = {tick: 480, type: 'redDrum', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)).toHaveLength(1);
  });

  it('undo removes the added note', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'redDrum', length: 0, flags: {}};
    const cmd = new AddNoteCommand(note);

    const after = cmd.execute(doc);
    expect(getExpertNotes(after)).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)).toHaveLength(0);
  });

  it('does not mutate the original document', () => {
    const doc = makeDoc();
    const note: DrumNote = {tick: 480, type: 'redDrum', length: 0, flags: {}};
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
    const doc = makeDoc([
      {tick: 0, type: 'kick'},
      {tick: 480, type: 'redDrum'},
      {tick: 960, type: 'yellowDrum', flags: {cymbal: true}},
    ]);
    const cmd = new DeleteNotesCommand(new Set(['480:redDrum']));

    const result = cmd.execute(doc);
    const remaining = getExpertNotes(result);
    expect(remaining).toHaveLength(2);
    expect(remaining.map(n => n.type)).toEqual(['kick', 'yellowDrum']);
  });

  it('undo restores deleted notes', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick'},
      {tick: 480, type: 'redDrum', flags: {accent: true}},
    ]);
    const cmd = new DeleteNotesCommand(new Set(['480:redDrum']));

    const after = cmd.execute(doc);
    expect(getExpertNotes(after)).toHaveLength(1);

    const reverted = cmd.undo(after);
    const restored = getExpertNotes(reverted);
    expect(restored).toHaveLength(2);
    expect(restored[1].type).toBe('redDrum');
    expect(restored[1].flags.accent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MoveNotesCommand
// ---------------------------------------------------------------------------

describe('MoveNotesCommand', () => {
  it('moves notes by tick and lane delta', () => {
    const doc = makeDoc([
      {tick: 480, type: 'redDrum'},
    ]);
    const cmd = new MoveNotesCommand(['480:redDrum'], 240, 1);

    const result = cmd.execute(doc);
    const moved = getExpertNotes(result);
    expect(moved).toHaveLength(1);
    expect(moved[0].tick).toBe(720);
    expect(moved[0].type).toBe('yellowDrum');
  });

  it('clamps tick to 0', () => {
    const doc = makeDoc([
      {tick: 100, type: 'kick'},
    ]);
    const cmd = new MoveNotesCommand(['100:kick'], -200, 0);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].tick).toBe(0);
  });

  it('undo reverses the move', () => {
    const doc = makeDoc([
      {tick: 480, type: 'redDrum'},
    ]);
    const cmd = new MoveNotesCommand(['480:redDrum'], 240, 1);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    const restored = getExpertNotes(reverted);
    expect(restored[0].tick).toBe(480);
    expect(restored[0].type).toBe('redDrum');
  });
});

// ---------------------------------------------------------------------------
// ToggleFlagCommand
// ---------------------------------------------------------------------------

describe('ToggleFlagCommand', () => {
  it('toggles cymbal flag on', () => {
    const doc = makeDoc([
      {tick: 480, type: 'yellowDrum'},
    ]);
    const cmd = new ToggleFlagCommand(['480:yellowDrum'], 'cymbal');

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].flags.cymbal).toBe(true);
  });

  it('toggles cymbal flag off', () => {
    const doc = makeDoc([
      {tick: 480, type: 'yellowDrum', flags: {cymbal: true}},
    ]);
    const cmd = new ToggleFlagCommand(['480:yellowDrum'], 'cymbal');

    const result = cmd.execute(doc);
    // getDrumNotes returns undefined (not false) when no cymbal marker is present
    expect(getExpertNotes(result)[0].flags.cymbal).toBeFalsy();
  });

  it('undo restores original flag state', () => {
    const doc = makeDoc([
      {tick: 480, type: 'yellowDrum', flags: {cymbal: true}},
    ]);
    const cmd = new ToggleFlagCommand(['480:yellowDrum'], 'cymbal');

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)[0].flags.cymbal).toBe(true);
  });

  it('toggles accent on multiple notes', () => {
    const doc = makeDoc([
      {tick: 0, type: 'redDrum'},
      {tick: 480, type: 'redDrum'},
    ]);
    const cmd = new ToggleFlagCommand(['0:redDrum', '480:redDrum'], 'accent');

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
    expect(result.tempos[1]).toEqual({tick: 480, beatsPerMinute: 140});
  });

  it('updates existing BPM marker at the same tick', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(0, 140);

    const result = cmd.execute(doc);
    expect(result.tempos).toHaveLength(1);
    expect(result.tempos[0].beatsPerMinute).toBe(140);
  });

  it('maintains sort order', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      tempos: [
        {tick: 0, beatsPerMinute: 120},
        {tick: 960, beatsPerMinute: 150},
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
      new AddNoteCommand({tick: 480, type: 'redDrum', length: 0, flags: {}}),
      new AddNoteCommand({tick: 960, type: 'yellowDrum', length: 0, flags: {cymbal: true}}),
    ]);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)).toHaveLength(3);
  });

  it('undo reverses all commands in reverse order', () => {
    const doc = makeDoc();
    const cmd = new BatchCommand([
      new AddNoteCommand({tick: 0, type: 'kick', length: 0, flags: {}}),
      new AddNoteCommand({tick: 480, type: 'redDrum', length: 0, flags: {}}),
    ]);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(getExpertNotes(reverted)).toHaveLength(0);
  });

  it('can combine different command types', () => {
    const doc = makeDoc([
      {tick: 0, type: 'kick'},
    ]);
    const cmd = new BatchCommand([
      new AddNoteCommand({tick: 480, type: 'redDrum', length: 0, flags: {}}),
      new DeleteNotesCommand(new Set(['0:kick'])),
    ]);

    const result = cmd.execute(doc);
    const notes = getExpertNotes(result);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe('redDrum');
  });
});

// ---------------------------------------------------------------------------
// AddSectionCommand
// ---------------------------------------------------------------------------

describe('AddSectionCommand', () => {
  it('adds a section to an empty sections array', () => {
    const doc = makeDoc();
    const cmd = new AddSectionCommand(480, 'verse 1');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toEqual({tick: 480, name: 'verse 1'});
  });

  it('maintains sort order when adding', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 960, name: 'chorus'},
      ],
    };
    const cmd = new AddSectionCommand(480, 'verse');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].tick).toBe(0);
    expect(result.sections[1].tick).toBe(480);
    expect(result.sections[2].tick).toBe(960);
  });

  it('replaces an existing section at the same tick', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'old name'}],
    };
    const cmd = new AddSectionCommand(480, 'new name');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('new name');
  });

  it('undo removes the added section', () => {
    const doc = makeDoc();
    const cmd = new AddSectionCommand(480, 'verse 1');

    const after = cmd.execute(doc);
    expect(after.sections).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(reverted.sections).toHaveLength(0);
  });

  it('does not mutate the original document', () => {
    const doc = makeDoc();
    const cmd = new AddSectionCommand(480, 'verse 1');

    cmd.execute(doc);
    expect(doc.sections).toHaveLength(0);
  });

  it('has a descriptive description', () => {
    const cmd = new AddSectionCommand(480, 'chorus');
    expect(cmd.description).toBe('Add section "chorus"');
  });
});

// ---------------------------------------------------------------------------
// DeleteSectionCommand
// ---------------------------------------------------------------------------

describe('DeleteSectionCommand', () => {
  it('removes a section at the given tick', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
        {tick: 960, name: 'chorus'},
      ],
    };
    const cmd = new DeleteSectionCommand(480, 'verse');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(2);
    expect(result.sections.map(s => s.name)).toEqual(['intro', 'chorus']);
  });

  it('undo restores the deleted section', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
      ],
    };
    const cmd = new DeleteSectionCommand(480, 'verse');

    const after = cmd.execute(doc);
    expect(after.sections).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(reverted.sections).toHaveLength(2);
    expect(reverted.sections[1]).toEqual({tick: 480, name: 'verse'});
  });

  it('does not mutate the original document', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'verse'}],
    };
    const cmd = new DeleteSectionCommand(480, 'verse');

    cmd.execute(doc);
    expect(doc.sections).toHaveLength(1);
  });

  it('has a descriptive description', () => {
    const cmd = new DeleteSectionCommand(480, 'verse');
    expect(cmd.description).toBe('Delete section "verse"');
  });
});

// ---------------------------------------------------------------------------
// RenameSectionCommand
// ---------------------------------------------------------------------------

describe('RenameSectionCommand', () => {
  it('renames a section', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'verse'}],
    };
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('verse 1');
  });

  it('undo restores the original name', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'verse'}],
    };
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.sections[0].name).toBe('verse');
  });

  it('does not mutate the original document', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'verse'}],
    };
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    cmd.execute(doc);
    expect(doc.sections[0].name).toBe('verse');
  });

  it('has a descriptive description', () => {
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');
    expect(cmd.description).toBe('Rename section to "verse 1"');
  });
});

// ---------------------------------------------------------------------------
// MoveSectionCommand
// ---------------------------------------------------------------------------

describe('MoveSectionCommand', () => {
  it('moves a section to a new tick position', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
        {tick: 960, name: 'chorus'},
      ],
    };
    const cmd = new MoveSectionCommand(480, 720, 'verse');

    const result = cmd.execute(doc);
    expect(result.sections).toHaveLength(3);
    const ticks = result.sections.map(s => s.tick);
    expect(ticks).toEqual([0, 720, 960]);
    expect(result.sections.find(s => s.tick === 720)?.name).toBe('verse');
  });

  it('undo moves the section back', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
      ],
    };
    const cmd = new MoveSectionCommand(480, 720, 'verse');

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.sections).toHaveLength(2);
    expect(reverted.sections[1]).toEqual({tick: 480, name: 'verse'});
  });

  it('does not mutate the original document', () => {
    const doc: ChartDocument = {
      ...makeDoc(),
      sections: [{tick: 480, name: 'verse'}],
    };
    const cmd = new MoveSectionCommand(480, 720, 'verse');

    cmd.execute(doc);
    expect(doc.sections[0].tick).toBe(480);
  });

  it('has a descriptive description', () => {
    const cmd = new MoveSectionCommand(480, 720, 'verse');
    expect(cmd.description).toBe('Move section "verse"');
  });
});
