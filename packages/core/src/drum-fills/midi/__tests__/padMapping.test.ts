import {ALESIS_SURGE_PROFILE} from '../chProfile';
import {PadMapping, resolvePad, LANE_NOTE_TYPES} from '../padMapping';

describe('PadMapping', () => {
  const mapping = new PadMapping(ALESIS_SURGE_PROFILE);

  it('maps kick note 36 to kick lane, not a cymbal, noteType 13', () => {
    expect(mapping.resolve(36)).toEqual({
      lane: 'kick',
      isCymbal: false,
      noteType: 13,
    });
  });

  it('maps red notes to red lane / noteType 14, never cymbal', () => {
    for (const n of [38, 40]) {
      expect(mapping.resolve(n)).toEqual({
        lane: 'red',
        isCymbal: false,
        noteType: 14,
      });
    }
  });

  it('distinguishes yellow pad (tom) from yellow cymbal', () => {
    expect(mapping.resolve(48)).toEqual({
      lane: 'yellow',
      isCymbal: false,
      noteType: 15,
    });
    expect(mapping.resolve(22)).toEqual({
      lane: 'yellow',
      isCymbal: true,
      noteType: 15,
    });
  });

  it('maps blue pad vs cymbal and green pad vs cymbal', () => {
    expect(mapping.resolve(45)!.isCymbal).toBe(false);
    expect(mapping.resolve(51)!.isCymbal).toBe(true);
    expect(mapping.resolve(58)).toEqual({
      lane: 'green',
      isCymbal: false,
      noteType: 17,
    });
    expect(mapping.resolve(49)).toEqual({
      lane: 'green',
      isCymbal: true,
      noteType: 17,
    });
  });

  it('returns null for unmapped note numbers', () => {
    expect(mapping.resolve(0)).toBeNull();
    expect(mapping.resolve(127)).toBeNull();
  });

  it('exposes all known note numbers', () => {
    const known = mapping.knownNotes().sort((a, b) => a - b);
    expect(known).toEqual(
      [36, 38, 40, 48, 50, 45, 47, 41, 43, 58, 22, 42, 23, 51, 46, 49].sort(
        (a, b) => a - b,
      ),
    );
  });

  it('lane note types match scan-chart drum NoteType values', () => {
    expect(LANE_NOTE_TYPES).toEqual({
      kick: 13,
      red: 14,
      yellow: 15,
      blue: 16,
      green: 17,
    });
  });

  it('resolvePad convenience matches PadMapping', () => {
    expect(resolvePad(ALESIS_SURGE_PROFILE, 49)).toEqual(mapping.resolve(49));
  });

  it('first assignment wins on note-number conflicts', () => {
    const conflicting = {
      deviceName: 'C',
      mappings: {
        'Red Pad': [{noteNumber: 38, velocity: 10, overHitThreshold: 0}],
        'Yellow Cymbal': [{noteNumber: 38, velocity: 10, overHitThreshold: 0}],
      },
    } as const;
    const m = new PadMapping(conflicting as any);
    expect(m.resolve(38)!.lane).toBe('red');
  });
});
