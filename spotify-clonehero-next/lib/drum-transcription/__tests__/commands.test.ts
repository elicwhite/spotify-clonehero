/**
 * Tests for the EditCommand pattern (0007a).
 *
 * Verifies that each command correctly transforms a ChartDocument
 * and that undo reverses the transformation.
 */

import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveEntitiesCommand,
  ToggleFlagCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  BatchCommand,
  noteId,
  typeToLane,
  laneToType,
  shiftLane,
  defaultFlagsForType,
} from '@/components/chart-editor/commands';
import type {
  ChartDocument,
  DrumNote,
  DrumNoteType,
  ParsedChart,
  ParsedTrackData,
} from '@/lib/chart-edit';
import {createEmptyChart, addDrumNote, getDrumNotes} from '@/lib/chart-edit';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeDoc(
  notes: Array<{
    tick: number;
    type: DrumNoteType;
    flags?: DrumNote['flags'];
    length?: number;
  }> = [],
): ChartDocument {
  const parsedChart = createEmptyChart({bpm: 120, resolution: 480});
  // Add an expert drums track with all the fields the new ParsedTrackData
  // shape requires (noteEventGroups, animations, textEvents, versusPhrases,
  // etc.).
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
    textEvents: [],
    versusPhrases: [],
    animations: [],
  } as unknown as ParsedTrackData;
  parsedChart.trackData.push(track);

  for (const n of notes) {
    addDrumNote(track, {
      tick: n.tick,
      type: n.type,
      length: n.length ?? 0,
      flags: n.flags ?? {},
    });
  }

  return {parsedChart, assets: []};
}

function getExpertNotes(doc: ChartDocument): DrumNote[] {
  const track = doc.parsedChart.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) return [];
  return getDrumNotes(track);
}

/** Apply overrides to the inner `parsedChart` (where tempos/sections/etc. live).
 *  Accepts source-shape objects (without msTime/msLength) and fills in defaults. */
function withChart(
  base: ChartDocument,
  overrides: {
    tempos?: Array<{tick: number; beatsPerMinute: number; msTime?: number}>;
    timeSignatures?: Array<{
      tick: number;
      numerator: number;
      denominator: number;
      msTime?: number;
      msLength?: number;
    }>;
    sections?: Array<{
      tick: number;
      name: string;
      msTime?: number;
      msLength?: number;
    }>;
    endEvents?: Array<{tick: number; msTime?: number; msLength?: number}>;
  } & Partial<
    Omit<ParsedChart, 'tempos' | 'timeSignatures' | 'sections' | 'endEvents'>
  >,
): ChartDocument {
  const {tempos, timeSignatures, sections, endEvents, ...rest} = overrides;
  const next = {...base.parsedChart, ...rest} as ParsedChart;
  if (tempos) {
    next.tempos = tempos.map(t => ({msTime: 0, ...t})) as ParsedChart['tempos'];
  }
  if (timeSignatures) {
    next.timeSignatures = timeSignatures.map(ts => ({
      msTime: 0,
      msLength: 0,
      ...ts,
    })) as ParsedChart['timeSignatures'];
  }
  if (sections) {
    next.sections = sections.map(s => ({
      msTime: 0,
      msLength: 0,
      ...s,
    })) as ParsedChart['sections'];
  }
  if (endEvents) {
    next.endEvents = endEvents.map(e => ({
      msTime: 0,
      msLength: 0,
      ...e,
    })) as ParsedChart['endEvents'];
  }
  return {...base, parsedChart: next};
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
    const note: DrumNote = {
      tick: 480,
      type: 'yellowDrum',
      length: 0,
      flags: {cymbal: true},
    };
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
// MoveEntitiesCommand: notes
// ---------------------------------------------------------------------------

describe('MoveEntitiesCommand: notes', () => {
  it('moves notes by tick and lane delta', () => {
    const doc = makeDoc([{tick: 480, type: 'redDrum'}]);
    const cmd = new MoveEntitiesCommand('note', ['480:redDrum'], 240, 1);

    const result = cmd.execute(doc);
    const moved = getExpertNotes(result);
    expect(moved).toHaveLength(1);
    expect(moved[0].tick).toBe(720);
    expect(moved[0].type).toBe('yellowDrum');
  });

  it('clamps tick to 0', () => {
    const doc = makeDoc([{tick: 100, type: 'kick'}]);
    const cmd = new MoveEntitiesCommand('note', ['100:kick'], -200, 0);

    const result = cmd.execute(doc);
    expect(getExpertNotes(result)[0].tick).toBe(0);
  });

  it('undo reverses the move', () => {
    const doc = makeDoc([{tick: 480, type: 'redDrum'}]);
    const cmd = new MoveEntitiesCommand('note', ['480:redDrum'], 240, 1);

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
    const doc = makeDoc([{tick: 480, type: 'yellowDrum'}]);
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
    expect(result.parsedChart.tempos).toHaveLength(2);
    expect(result.parsedChart.tempos[1]).toMatchObject({
      tick: 480,
      beatsPerMinute: 140,
    });
  });

  it('updates existing BPM marker at the same tick', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(0, 140);

    const result = cmd.execute(doc);
    expect(result.parsedChart.tempos).toHaveLength(1);
    expect(result.parsedChart.tempos[0].beatsPerMinute).toBe(140);
  });

  it('maintains sort order', () => {
    const doc = withChart(makeDoc(), {
      tempos: [
        {tick: 0, beatsPerMinute: 120},
        {tick: 960, beatsPerMinute: 150},
      ],
    });
    const cmd = new AddBPMCommand(480, 130);

    const result = cmd.execute(doc);
    expect(result.parsedChart.tempos).toHaveLength(3);
    expect(result.parsedChart.tempos[0].tick).toBe(0);
    expect(result.parsedChart.tempos[1].tick).toBe(480);
    expect(result.parsedChart.tempos[2].tick).toBe(960);
  });

  it('undo removes the added marker', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(480, 140);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.tempos).toHaveLength(1);
    expect(reverted.parsedChart.tempos[0].tick).toBe(0);
  });

  it('undo does not remove the marker at tick 0', () => {
    const doc = makeDoc();
    const cmd = new AddBPMCommand(0, 140);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.tempos).toHaveLength(1);
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
    expect(result.parsedChart.timeSignatures).toHaveLength(2);
    expect(result.parsedChart.timeSignatures[1]).toMatchObject({
      tick: 480,
      numerator: 3,
      denominator: 4,
    });
  });

  it('updates existing time signature at the same tick', () => {
    const doc = makeDoc();
    const cmd = new AddTimeSignatureCommand(0, 6, 8);

    const result = cmd.execute(doc);
    expect(result.parsedChart.timeSignatures).toHaveLength(1);
    expect(result.parsedChart.timeSignatures[0].numerator).toBe(6);
    expect(result.parsedChart.timeSignatures[0].denominator).toBe(8);
  });

  it('undo removes the added time signature', () => {
    const doc = makeDoc();
    const cmd = new AddTimeSignatureCommand(480, 3, 4);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.timeSignatures).toHaveLength(1);
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
      new AddNoteCommand({
        tick: 960,
        type: 'yellowDrum',
        length: 0,
        flags: {cymbal: true},
      }),
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
    const doc = makeDoc([{tick: 0, type: 'kick'}]);
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
    expect(result.parsedChart.sections).toHaveLength(1);
    expect(result.parsedChart.sections[0]).toMatchObject({
      tick: 480,
      name: 'verse 1',
    });
  });

  it('maintains sort order when adding', () => {
    const doc = withChart(makeDoc(), {
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 960, name: 'chorus'},
      ],
    });
    const cmd = new AddSectionCommand(480, 'verse');

    const result = cmd.execute(doc);
    expect(result.parsedChart.sections).toHaveLength(3);
    expect(result.parsedChart.sections[0].tick).toBe(0);
    expect(result.parsedChart.sections[1].tick).toBe(480);
    expect(result.parsedChart.sections[2].tick).toBe(960);
  });

  it('replaces an existing section at the same tick', () => {
    const doc = withChart(makeDoc(), {
      sections: [{tick: 480, name: 'old name'}],
    });
    const cmd = new AddSectionCommand(480, 'new name');

    const result = cmd.execute(doc);
    expect(result.parsedChart.sections).toHaveLength(1);
    expect(result.parsedChart.sections[0].name).toBe('new name');
  });

  it('undo removes the added section', () => {
    const doc = makeDoc();
    const cmd = new AddSectionCommand(480, 'verse 1');

    const after = cmd.execute(doc);
    expect(after.parsedChart.sections).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.sections).toHaveLength(0);
  });

  it('does not mutate the original document', () => {
    const doc = makeDoc();
    const cmd = new AddSectionCommand(480, 'verse 1');

    cmd.execute(doc);
    expect(doc.parsedChart.sections).toHaveLength(0);
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
    const doc = withChart(makeDoc(), {
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
        {tick: 960, name: 'chorus'},
      ],
    });
    const cmd = new DeleteSectionCommand(480, 'verse');

    const result = cmd.execute(doc);
    expect(result.parsedChart.sections).toHaveLength(2);
    expect(result.parsedChart.sections.map(s => s.name)).toEqual([
      'intro',
      'chorus',
    ]);
  });

  it('undo restores the deleted section', () => {
    const doc = withChart(makeDoc(), {
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
      ],
    });
    const cmd = new DeleteSectionCommand(480, 'verse');

    const after = cmd.execute(doc);
    expect(after.parsedChart.sections).toHaveLength(1);

    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.sections).toHaveLength(2);
    expect(reverted.parsedChart.sections[1]).toMatchObject({
      tick: 480,
      name: 'verse',
    });
  });

  it('does not mutate the original document', () => {
    const doc = withChart(makeDoc(), {sections: [{tick: 480, name: 'verse'}]});
    const cmd = new DeleteSectionCommand(480, 'verse');

    cmd.execute(doc);
    expect(doc.parsedChart.sections).toHaveLength(1);
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
    const doc = withChart(makeDoc(), {sections: [{tick: 480, name: 'verse'}]});
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    const result = cmd.execute(doc);
    expect(result.parsedChart.sections).toHaveLength(1);
    expect(result.parsedChart.sections[0].name).toBe('verse 1');
  });

  it('undo restores the original name', () => {
    const doc = withChart(makeDoc(), {sections: [{tick: 480, name: 'verse'}]});
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.sections[0].name).toBe('verse');
  });

  it('does not mutate the original document', () => {
    const doc = withChart(makeDoc(), {sections: [{tick: 480, name: 'verse'}]});
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');

    cmd.execute(doc);
    expect(doc.parsedChart.sections[0].name).toBe('verse');
  });

  it('has a descriptive description', () => {
    const cmd = new RenameSectionCommand(480, 'verse', 'verse 1');
    expect(cmd.description).toBe('Rename section to "verse 1"');
  });
});

// ---------------------------------------------------------------------------
// MoveEntitiesCommand: sections
// ---------------------------------------------------------------------------

describe('MoveEntitiesCommand: sections', () => {
  it('moves a section to a new tick position', () => {
    const doc = withChart(makeDoc(), {
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
        {tick: 960, name: 'chorus'},
      ],
    });
    const cmd = new MoveEntitiesCommand('section', ['480'], 240, 0);

    const result = cmd.execute(doc);
    expect(result.parsedChart.sections).toHaveLength(3);
    const ticks = result.parsedChart.sections.map(s => s.tick);
    expect(ticks).toEqual([0, 720, 960]);
    expect(result.parsedChart.sections.find(s => s.tick === 720)?.name).toBe(
      'verse',
    );
  });

  it('undo moves the section back', () => {
    const doc = withChart(makeDoc(), {
      sections: [
        {tick: 0, name: 'intro'},
        {tick: 480, name: 'verse'},
      ],
    });
    const cmd = new MoveEntitiesCommand('section', ['480'], 240, 0);

    const after = cmd.execute(doc);
    const reverted = cmd.undo(after);
    expect(reverted.parsedChart.sections).toHaveLength(2);
    expect(reverted.parsedChart.sections[1]).toMatchObject({
      tick: 480,
      name: 'verse',
    });
  });

  it('does not mutate the original document', () => {
    const doc = withChart(makeDoc(), {sections: [{tick: 480, name: 'verse'}]});
    const cmd = new MoveEntitiesCommand('section', ['480'], 240, 0);

    cmd.execute(doc);
    expect(doc.parsedChart.sections[0].tick).toBe(480);
  });

  it('has a descriptive description', () => {
    const cmd = new MoveEntitiesCommand('section', ['480'], 240, 0);
    expect(cmd.description).toBe('Move 1 section');
  });
});

// ---------------------------------------------------------------------------
// MoveEntitiesCommand: lyric + phrase
// ---------------------------------------------------------------------------

function makeVocalDoc(): ChartDocument {
  const doc = makeDoc();
  doc.parsedChart.vocalTracks = {
    parts: {
      vocals: {
        notePhrases: [
          {
            tick: 0,
            msTime: 0,
            length: 480,
            msLength: 0,
            isPercussion: false,
            notes: [
              {tick: 240, msTime: 0, length: 60, msLength: 0, pitch: 60, type: 'pitched'},
            ],
            lyrics: [{tick: 240, msTime: 0, text: 'la', flags: 0}],
          },
        ],
        staticLyricPhrases: [],
        starPowerSections: [],
        rangeShifts: [],
        lyricShifts: [],
        textEvents: [],
      },
    },
    rangeShifts: [],
    lyricShifts: [],
  };
  return doc;
}

describe('MoveEntitiesCommand: lyric', () => {
  it('moves a lyric within its phrase and undo restores it', () => {
    const doc = makeVocalDoc();
    const cmd = new MoveEntitiesCommand('lyric', ['240'], 120, 0);

    const after = cmd.execute(doc);
    const phrase = after.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(phrase.lyrics[0].tick).toBe(360);
    expect(phrase.notes[0].tick).toBe(360);

    const reverted = cmd.undo(after);
    const original =
      reverted.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(original.lyrics[0].tick).toBe(240);
    expect(original.notes[0].tick).toBe(240);
  });

  it('clamps the lyric drag to the phrase upper bound', () => {
    const doc = makeVocalDoc();
    const cmd = new MoveEntitiesCommand('lyric', ['240'], 9999, 0);
    const after = cmd.execute(doc);
    expect(
      after.parsedChart.vocalTracks!.parts.vocals.notePhrases[0].lyrics[0].tick,
    ).toBe(480);
  });
});

describe('MoveEntitiesCommand: phrase markers', () => {
  it('phrase-start drag adjusts length only; undo restores the original tick', () => {
    const doc = makeVocalDoc();
    const cmd = new MoveEntitiesCommand('phrase-start', ['0'], 120, 0);

    const after = cmd.execute(doc);
    const moved = after.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(moved.tick).toBe(120);
    expect(moved.length).toBe(360);

    const reverted = cmd.undo(after);
    const original =
      reverted.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(original.tick).toBe(0);
    expect(original.length).toBe(480);
  });

  it('phrase-end drag adjusts length only; undo restores the original end tick', () => {
    const doc = makeVocalDoc();
    const cmd = new MoveEntitiesCommand('phrase-end', ['480'], 240, 0);

    const after = cmd.execute(doc);
    const moved = after.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(moved.tick).toBe(0);
    expect(moved.length).toBe(720);

    const reverted = cmd.undo(after);
    const original =
      reverted.parsedChart.vocalTracks!.parts.vocals.notePhrases[0];
    expect(original.length).toBe(480);
  });
});
