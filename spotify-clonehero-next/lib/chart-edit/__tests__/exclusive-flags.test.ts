/**
 * Mutually-exclusive flag groups (plan 0126) — drums' accent/ghost dynamics
 * and five-fret's strum/HOPO/tap articulation.
 *
 * The rule these pin: a note carries at most one flag from a group. The
 * reference implementation models a drum note's dynamic as a single enum
 * value (`YARG.Core/Chart/Notes/DrumNote.cs`'s `DrumNoteType`), not as two
 * independent bits, and `interpretDrumNote` reads the bits that way when it
 * picks a highway sprite. An editor that can write both at once produces a
 * note no consumer can draw.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {drums4LaneSchema, drums5LaneSchema} from '../instruments/drums';
import {guitarSchema} from '../instruments/guitar';
import {legalizeFlagBits, setFlagBits, toggleFlagBits} from '../entities/notes';

const RED = noteTypes.redDrum;
const YELLOW = noteTypes.yellowDrum;
const KICK = noteTypes.kick;
const DYNAMICS = noteFlags.accent | noteFlags.ghost;

describe('drum dynamics are mutually exclusive', () => {
  it('setting accent on a ghosted note clears the ghost', () => {
    const bits = setFlagBits(
      drums4LaneSchema,
      RED,
      noteFlags.ghost,
      'accent',
      true,
    );
    expect(bits & noteFlags.accent).toBeTruthy();
    expect(bits & noteFlags.ghost).toBeFalsy();
  });

  it('setting ghost on an accented note clears the accent', () => {
    const bits = setFlagBits(
      drums4LaneSchema,
      RED,
      noteFlags.accent,
      'ghost',
      true,
    );
    expect(bits & noteFlags.ghost).toBeTruthy();
    expect(bits & noteFlags.accent).toBeFalsy();
  });

  it('toggling the active dynamic leaves the note neutral', () => {
    const bits = toggleFlagBits(
      drums4LaneSchema,
      RED,
      noteFlags.accent,
      'accent',
    );
    expect(bits & DYNAMICS).toBe(0);
  });

  it('toggling the other dynamic replaces rather than adds', () => {
    const bits = toggleFlagBits(
      drums4LaneSchema,
      RED,
      noteFlags.accent,
      'ghost',
    );
    expect(bits & noteFlags.ghost).toBeTruthy();
    expect(bits & noteFlags.accent).toBeFalsy();
  });

  it('clearing a dynamic that is not set leaves the other one alone', () => {
    const bits = setFlagBits(
      drums4LaneSchema,
      RED,
      noteFlags.ghost,
      'accent',
      false,
    );
    expect(bits & noteFlags.ghost).toBeTruthy();
  });

  it('a toggle is exactly a set to the other state', () => {
    // `toggleFlagBits` delegates to `setFlagBits`, so this holds for every
    // flag on every lane of every schema, not just this one case.
    for (const schema of [drums4LaneSchema, drums5LaneSchema, guitarSchema]) {
      for (const lane of schema.lanes) {
        for (const binding of schema.flagBindings) {
          for (const bits of [0, noteFlags[binding.flag], DYNAMICS]) {
            const on = (bits & noteFlags[binding.flag]) === 0;
            expect(
              toggleFlagBits(schema, lane.noteType, bits, binding.flag),
            ).toBe(setFlagBits(schema, lane.noteType, bits, binding.flag, on));
          }
        }
      }
    }
  });

  it('leaves the cymbal/tom complement pair untouched', () => {
    // Dynamics and the cymbal pair are different rules over different bits;
    // ghosting a cymbal must not turn it back into a tom. 7.7% of drum
    // charts in the corpus carry a ghost on a cymbal, so this combination is
    // ordinary, not a malformed edge case.
    const bits = setFlagBits(
      drums4LaneSchema,
      YELLOW,
      noteFlags.cymbal,
      'ghost',
      true,
    );
    expect(bits & noteFlags.cymbal).toBeTruthy();
    expect(bits & noteFlags.ghost).toBeTruthy();
  });

  it('allows a dynamic on every hand-struck pad', () => {
    for (const type of [RED, YELLOW, noteTypes.blueDrum, noteTypes.greenDrum]) {
      for (const flag of ['ghost', 'accent'] as const) {
        const bits = setFlagBits(drums4LaneSchema, type, 0, flag, true);
        expect(bits & noteFlags[flag]).toBeTruthy();
      }
    }
  });

  it('refuses a dynamic on the kick', () => {
    // A kick pedal has no ghosted or accented articulation. The corpus
    // agrees: 150 ghosted kicks across 78,453 charts, which is noise beside
    // 96,905 ghosts on cymbals alone.
    for (const flag of ['ghost', 'accent'] as const) {
      const bits = setFlagBits(drums4LaneSchema, KICK, 0, flag, true);
      expect(bits & noteFlags[flag]).toBeFalsy();
    }
  });

  it('leaves the kick doubleKick flag alone when stripping a dynamic', () => {
    const bits = legalizeFlagBits(
      drums4LaneSchema,
      KICK,
      noteFlags.doubleKick | noteFlags.ghost,
    );
    expect(bits & noteFlags.doubleKick).toBeTruthy();
    expect(bits & noteFlags.ghost).toBeFalsy();
  });

  it('toggling a dynamic on a kick is a no-op, not a half-set state', () => {
    const bits = toggleFlagBits(drums4LaneSchema, KICK, 0, 'ghost');
    expect(bits & DYNAMICS).toBe(0);
  });

  it('applies the same kick rule on the 5-lane schema', () => {
    for (const flag of ['ghost', 'accent'] as const) {
      expect(
        setFlagBits(drums5LaneSchema, KICK, 0, flag, true) & noteFlags[flag],
      ).toBeFalsy();
      expect(
        setFlagBits(drums5LaneSchema, YELLOW, 0, flag, true) & noteFlags[flag],
      ).toBeTruthy();
    }
  });
});

describe('legalizeFlagBits enforces lane legality, not group precedence', () => {
  it('leaves a chart that set two members of a group alone', () => {
    // Deliberate: both readers already collapse the pair (`interpretDrumNote`
    // takes ghost over accent), so such a note displays consistently, and the
    // first deliberate edit to it goes through `setFlagBits` and leaves one
    // member set. Collapsing here would rewrite bits the user never touched.
    const bits = legalizeFlagBits(drums4LaneSchema, RED, DYNAMICS);
    expect(bits & DYNAMICS).toBe(DYNAMICS);
  });

  it('still strips a flag the lane cannot carry', () => {
    const bits = legalizeFlagBits(drums4LaneSchema, KICK, DYNAMICS);
    expect(bits & DYNAMICS).toBe(0);
  });

  it('still fills in a complement so a pad is never flagless', () => {
    const bits = legalizeFlagBits(drums4LaneSchema, YELLOW, 0);
    expect(bits & noteFlags.tom).toBeTruthy();
  });

  it('leaves a single set group member alone', () => {
    const bits = legalizeFlagBits(drums4LaneSchema, RED, noteFlags.accent);
    expect(bits & noteFlags.accent).toBeTruthy();
  });
});

describe('five-fret articulation still works through the generalized path', () => {
  const GREEN = noteTypes.green;

  it('toggling the active technique returns to natural', () => {
    const bits = toggleFlagBits(guitarSchema, GREEN, noteFlags.hopo, 'hopo');
    expect(bits & (noteFlags.strum | noteFlags.hopo | noteFlags.tap)).toBe(0);
  });

  it('toggling another technique replaces the current one', () => {
    const bits = toggleFlagBits(guitarSchema, GREEN, noteFlags.hopo, 'tap');
    expect(bits & noteFlags.tap).toBeTruthy();
    expect(bits & noteFlags.hopo).toBeFalsy();
  });
});
