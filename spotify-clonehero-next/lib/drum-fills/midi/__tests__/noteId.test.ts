import {noteFlags, noteTypes} from '@/lib/chart-edit/types';
import {
  fillNoteId,
  fillNoteIdFromRaw,
  noteIsCymbal,
  noteTypeToLane,
} from '../noteId';

describe('noteId', () => {
  it('maps raw note types to lanes', () => {
    expect(noteTypeToLane(noteTypes.kick)).toBe('kick');
    expect(noteTypeToLane(noteTypes.redDrum)).toBe('red');
    expect(noteTypeToLane(noteTypes.yellowDrum)).toBe('yellow');
    expect(noteTypeToLane(noteTypes.blueDrum)).toBe('blue');
    expect(noteTypeToLane(noteTypes.greenDrum)).toBe('green');
    expect(noteTypeToLane(99999)).toBeNull();
  });

  it('only yellow/blue/green with the cymbal flag are cymbals', () => {
    expect(noteIsCymbal('yellow', noteFlags.cymbal)).toBe(true);
    expect(noteIsCymbal('yellow', noteFlags.tom)).toBe(false);
    expect(noteIsCymbal('red', noteFlags.cymbal)).toBe(false);
    expect(noteIsCymbal('kick', noteFlags.cymbal)).toBe(false);
  });

  it('composes the stable id with the c/p suffix', () => {
    expect(fillNoteId(480, 'yellow', true)).toBe('480:yellow:c');
    expect(fillNoteId(480, 'yellow', false)).toBe('480:yellow:p');
  });

  it('fillNoteIdFromRaw agrees for a tom vs. a cymbal on the same lane', () => {
    const tom = fillNoteIdFromRaw(96, {
      type: noteTypes.blueDrum,
      flags: noteFlags.tom,
    });
    const cym = fillNoteIdFromRaw(96, {
      type: noteTypes.blueDrum,
      flags: noteFlags.cymbal,
    });
    expect(tom).toEqual({id: '96:blue:p', lane: 'blue', isCymbal: false});
    expect(cym).toEqual({id: '96:blue:c', lane: 'blue', isCymbal: true});
  });

  it('returns null for a non-drum note', () => {
    expect(fillNoteIdFromRaw(0, {type: 99999, flags: 0})).toBeNull();
  });
});
