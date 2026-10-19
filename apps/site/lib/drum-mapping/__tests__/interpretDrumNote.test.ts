import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {
  interpretDrumNote,
  isKickNote,
  isDrumCymbal,
  noteTypeToPad,
  applyDiscoFlip,
  noteEventToInstrument,
} from '../noteToInstrument';

// Helper to build a note with flags
function note(type: number, flags = 0) {
  return {type: type as (typeof noteTypes)[keyof typeof noteTypes], flags};
}

// ---------------------------------------------------------------------------
// interpretDrumNote — pad assignment
// ---------------------------------------------------------------------------

describe('interpretDrumNote', () => {
  describe('pad assignment', () => {
    it('kick → kick pad', () => {
      expect(interpretDrumNote(note(noteTypes.kick)).pad).toBe('kick');
    });

    it('redDrum → red pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.tom)).pad,
      ).toBe('red');
    });

    it('yellowDrum → yellow pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellowDrum, noteFlags.cymbal)).pad,
      ).toBe('yellow');
    });

    it('blueDrum → blue pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.blueDrum, noteFlags.tom)).pad,
      ).toBe('blue');
    });

    it('greenDrum → green pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.greenDrum, noteFlags.cymbal)).pad,
      ).toBe('green');
    });
  });

  describe('4-lane aliases', () => {
    it('noteTypes.yellow → yellow pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellow, noteFlags.cymbal)).pad,
      ).toBe('yellow');
    });

    it('noteTypes.blue → blue pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.blue, noteFlags.cymbal)).pad,
      ).toBe('blue');
    });

    it('noteTypes.green → green pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.green, noteFlags.cymbal)).pad,
      ).toBe('green');
    });

    it('noteTypes.orange → green pad', () => {
      expect(
        interpretDrumNote(note(noteTypes.orange, noteFlags.cymbal)).pad,
      ).toBe('green');
    });
  });

  describe('instrument mapping', () => {
    it('kick → kick', () => {
      expect(interpretDrumNote(note(noteTypes.kick)).instrument).toBe('kick');
    });

    it('red → snare', () => {
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.tom)).instrument,
      ).toBe('snare');
    });

    it('yellow + cymbal → hihat', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellowDrum, noteFlags.cymbal))
          .instrument,
      ).toBe('hihat');
    });

    it('yellow + tom → high-tom', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellowDrum, noteFlags.tom)).instrument,
      ).toBe('high-tom');
    });

    it('blue + cymbal → ride', () => {
      expect(
        interpretDrumNote(note(noteTypes.blueDrum, noteFlags.cymbal))
          .instrument,
      ).toBe('ride');
    });

    it('blue + tom → mid-tom', () => {
      expect(
        interpretDrumNote(note(noteTypes.blueDrum, noteFlags.tom)).instrument,
      ).toBe('mid-tom');
    });

    it('green + cymbal → crash', () => {
      expect(
        interpretDrumNote(note(noteTypes.greenDrum, noteFlags.cymbal))
          .instrument,
      ).toBe('crash');
    });

    it('green + tom → floor-tom', () => {
      expect(
        interpretDrumNote(note(noteTypes.greenDrum, noteFlags.tom)).instrument,
      ).toBe('floor-tom');
    });
  });

  describe('cymbal detection', () => {
    it('yellow + cymbal → isCymbal true', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellowDrum, noteFlags.cymbal))
          .isCymbal,
      ).toBe(true);
    });

    it('yellow + tom → isCymbal false', () => {
      expect(
        interpretDrumNote(note(noteTypes.yellowDrum, noteFlags.tom)).isCymbal,
      ).toBe(false);
    });

    it('red + cymbal flag → isCymbal false (red is never cymbal)', () => {
      // Red with cymbal flag should still not be cymbal
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.cymbal)).isCymbal,
      ).toBe(false);
    });

    it('kick → isCymbal false', () => {
      expect(interpretDrumNote(note(noteTypes.kick)).isCymbal).toBe(false);
    });
  });

  describe('kick detection', () => {
    it('kick → isKick true', () => {
      expect(interpretDrumNote(note(noteTypes.kick)).isKick).toBe(true);
    });

    it('redDrum → isKick false', () => {
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.tom)).isKick,
      ).toBe(false);
    });
  });

  describe('double-kick', () => {
    it('kick + doubleKick flag → isDoubleKick true', () => {
      expect(
        interpretDrumNote(note(noteTypes.kick, noteFlags.doubleKick))
          .isDoubleKick,
      ).toBe(true);
    });

    it('kick without doubleKick flag → isDoubleKick false', () => {
      expect(interpretDrumNote(note(noteTypes.kick)).isDoubleKick).toBe(false);
    });

    it('non-kick with doubleKick flag → isDoubleKick false', () => {
      expect(
        interpretDrumNote(
          note(noteTypes.redDrum, noteFlags.tom | noteFlags.doubleKick),
        ).isDoubleKick,
      ).toBe(false);
    });
  });

  describe('dynamic modifier', () => {
    it('ghost flag → ghost', () => {
      expect(
        interpretDrumNote(
          note(noteTypes.redDrum, noteFlags.tom | noteFlags.ghost),
        ).dynamic,
      ).toBe('ghost');
    });

    it('accent flag → accent', () => {
      expect(
        interpretDrumNote(
          note(noteTypes.redDrum, noteFlags.tom | noteFlags.accent),
        ).dynamic,
      ).toBe('accent');
    });

    it('no dynamic flag → none', () => {
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.tom)).dynamic,
      ).toBe('none');
    });

    it('both ghost and accent → ghost wins (checked first)', () => {
      expect(
        interpretDrumNote(
          note(
            noteTypes.redDrum,
            noteFlags.tom | noteFlags.ghost | noteFlags.accent,
          ),
        ).dynamic,
      ).toBe('ghost');
    });
  });

  describe('flam', () => {
    it('flam flag → isFlam true', () => {
      expect(
        interpretDrumNote(
          note(noteTypes.redDrum, noteFlags.tom | noteFlags.flam),
        ).isFlam,
      ).toBe(true);
    });

    it('no flam flag → isFlam false', () => {
      expect(
        interpretDrumNote(note(noteTypes.redDrum, noteFlags.tom)).isFlam,
      ).toBe(false);
    });
  });

  describe('disco flip', () => {
    it('red + disco → yellow cymbal (hihat)', () => {
      const result = interpretDrumNote(
        note(noteTypes.redDrum, noteFlags.tom | noteFlags.disco),
      );
      expect(result.pad).toBe('yellow');
      expect(result.instrument).toBe('hihat');
      expect(result.isCymbal).toBe(true);
    });

    it('yellow + disco → red tom (snare)', () => {
      const result = interpretDrumNote(
        note(noteTypes.yellowDrum, noteFlags.cymbal | noteFlags.disco),
      );
      expect(result.pad).toBe('red');
      expect(result.instrument).toBe('snare');
      expect(result.isCymbal).toBe(false);
    });

    it('discoNoflip strips flag but does not swap', () => {
      const result = interpretDrumNote(
        note(noteTypes.redDrum, noteFlags.tom | noteFlags.discoNoflip),
      );
      expect(result.pad).toBe('red');
      expect(result.instrument).toBe('snare');
      // discoNoflip flag should be stripped from output flags
      expect(result.flags & noteFlags.discoNoflip).toBe(0);
    });

    it('disco flag is stripped from output flags', () => {
      const result = interpretDrumNote(
        note(noteTypes.redDrum, noteFlags.tom | noteFlags.disco),
      );
      expect(result.flags & noteFlags.disco).toBe(0);
    });
  });

  describe('resolved noteType and flags', () => {
    it('exposes post-disco-flip noteType', () => {
      const result = interpretDrumNote(
        note(noteTypes.redDrum, noteFlags.tom | noteFlags.disco),
      );
      expect(result.noteType).toBe(noteTypes.yellowDrum);
    });

    it('exposes post-disco-flip flags', () => {
      const result = interpretDrumNote(
        note(noteTypes.yellowDrum, noteFlags.cymbal),
      );
      expect(result.flags & noteFlags.cymbal).not.toBe(0);
    });
  });

  it('throws for non-drum note type', () => {
    expect(() => interpretDrumNote(note(noteTypes.open))).toThrow(
      'Not a drum note type',
    );
  });
});

// ---------------------------------------------------------------------------
// Standalone predicates
// ---------------------------------------------------------------------------

describe('isKickNote', () => {
  it('kick → true', () => {
    expect(isKickNote(noteTypes.kick)).toBe(true);
  });

  it('redDrum → false', () => {
    expect(isKickNote(noteTypes.redDrum)).toBe(false);
  });

  it('yellowDrum → false', () => {
    expect(isKickNote(noteTypes.yellowDrum)).toBe(false);
  });
});

describe('isDrumCymbal', () => {
  it('yellow + cymbal → true', () => {
    expect(isDrumCymbal(noteTypes.yellowDrum, noteFlags.cymbal)).toBe(true);
  });

  it('yellow + tom → false', () => {
    expect(isDrumCymbal(noteTypes.yellowDrum, noteFlags.tom)).toBe(false);
  });

  it('red + cymbal → false (red is never cymbal)', () => {
    expect(isDrumCymbal(noteTypes.redDrum, noteFlags.cymbal)).toBe(false);
  });

  it('kick → false', () => {
    expect(isDrumCymbal(noteTypes.kick, 0)).toBe(false);
  });
});

describe('noteTypeToPad', () => {
  it('kick → kick', () => {
    expect(noteTypeToPad(noteTypes.kick)).toBe('kick');
  });

  it('redDrum → red', () => {
    expect(noteTypeToPad(noteTypes.redDrum)).toBe('red');
  });

  it('yellowDrum → yellow', () => {
    expect(noteTypeToPad(noteTypes.yellowDrum)).toBe('yellow');
  });

  it('blueDrum → blue', () => {
    expect(noteTypeToPad(noteTypes.blueDrum)).toBe('blue');
  });

  it('greenDrum → green', () => {
    expect(noteTypeToPad(noteTypes.greenDrum)).toBe('green');
  });

  it('yellow (4-lane alias) → yellow', () => {
    expect(noteTypeToPad(noteTypes.yellow)).toBe('yellow');
  });

  it('blue (4-lane alias) → blue', () => {
    expect(noteTypeToPad(noteTypes.blue)).toBe('blue');
  });

  it('green (4-lane alias) → green', () => {
    expect(noteTypeToPad(noteTypes.green)).toBe('green');
  });

  it('orange (4-lane alias) → green', () => {
    expect(noteTypeToPad(noteTypes.orange)).toBe('green');
  });

  it('open (non-drum) → null', () => {
    expect(noteTypeToPad(noteTypes.open)).toBeNull();
  });

  it('red (guitar, not redDrum) → null', () => {
    expect(noteTypeToPad(noteTypes.red)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legacy API — noteEventToInstrument
// ---------------------------------------------------------------------------

describe('noteEventToInstrument (legacy)', () => {
  it('delegates to interpretDrumNote', () => {
    expect(
      noteEventToInstrument(note(noteTypes.yellowDrum, noteFlags.cymbal)),
    ).toBe('hihat');
  });

  it('applies disco flip', () => {
    expect(
      noteEventToInstrument(
        note(noteTypes.redDrum, noteFlags.tom | noteFlags.disco),
      ),
    ).toBe('hihat');
  });
});

// ---------------------------------------------------------------------------
// applyDiscoFlip
// ---------------------------------------------------------------------------

describe('applyDiscoFlip', () => {
  it('no disco flag → unchanged', () => {
    const result = applyDiscoFlip(note(noteTypes.redDrum, noteFlags.tom));
    expect(result.type).toBe(noteTypes.redDrum);
    expect(result.flags).toBe(noteFlags.tom);
  });

  it('red + disco → yellow + cymbal', () => {
    const result = applyDiscoFlip(
      note(noteTypes.redDrum, noteFlags.tom | noteFlags.disco),
    );
    expect(result.type).toBe(noteTypes.yellowDrum);
    expect(result.flags & noteFlags.cymbal).not.toBe(0);
    expect(result.flags & noteFlags.tom).toBe(0);
    expect(result.flags & noteFlags.disco).toBe(0);
  });

  it('yellow + disco → red + tom', () => {
    const result = applyDiscoFlip(
      note(noteTypes.yellowDrum, noteFlags.cymbal | noteFlags.disco),
    );
    expect(result.type).toBe(noteTypes.redDrum);
    expect(result.flags & noteFlags.tom).not.toBe(0);
    expect(result.flags & noteFlags.cymbal).toBe(0);
    expect(result.flags & noteFlags.disco).toBe(0);
  });

  it('discoNoflip strips flag only', () => {
    const result = applyDiscoFlip(
      note(noteTypes.redDrum, noteFlags.tom | noteFlags.discoNoflip),
    );
    expect(result.type).toBe(noteTypes.redDrum);
    expect(result.flags & noteFlags.discoNoflip).toBe(0);
    expect(result.flags & noteFlags.tom).not.toBe(0);
  });

  it('blue + disco → unchanged (disco only swaps red/yellow)', () => {
    const result = applyDiscoFlip(
      note(noteTypes.blueDrum, noteFlags.cymbal | noteFlags.disco),
    );
    expect(result.type).toBe(noteTypes.blueDrum);
    expect(result.flags & noteFlags.disco).toBe(0);
  });
});
