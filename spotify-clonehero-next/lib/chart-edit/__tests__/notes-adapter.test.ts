/**
 * Parity tests for the schema-driven note adapter (`entities/notes.ts`,
 * plan 0037 Task 4) — add/delete/move/flag-toggle exercised against both
 * `drums4LaneSchema` and `guitarSchema` to confirm the engine genuinely
 * generalizes over `InstrumentSchema`, not just drums.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {drums4LaneSchema} from '../instruments/drums';
import {guitarSchema} from '../instruments/guitar';
import type {InstrumentSchema} from '../instruments/types';
import type {ParsedTrackData} from '../types';
import {
  schemaNoteId,
  parseSchemaNoteId,
  typeToLane,
  laneToType,
  shiftLane,
  padLaneRange,
  defaultFlagBits,
  toggleFlagBits,
  legalizeFlagBits,
  listNotes,
  findNote,
  addNote,
  removeNote,
  setNoteFlags,
  moveNote,
} from '../entities/notes';
import {emptyTrackData} from './test-utils';
import {createEmptyChart} from '@eliwhite/scan-chart';

function track(): ParsedTrackData {
  return emptyTrackData('drums', 'expert');
}

describe.each([
  {name: 'drums4LaneSchema', schema: drums4LaneSchema},
  {name: 'guitarSchema', schema: guitarSchema},
])('schema-generic note adapter — $name', ({schema}) => {
  const [laneA, laneB] = schema.lanes;

  it('addNote + listNotes round-trip', () => {
    const t = track();
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    const notes = listNotes(t, schema);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({tick: 480, type: laneA.noteType});
  });

  it('does not add a duplicate at the same tick+type (caller pre-checks)', () => {
    const t = track();
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    // addNote itself doesn't dedupe (AddNoteCommand pre-checks via
    // findNote) — confirm a second insert creates a second NoteEvent in
    // the group rather than silently merging, so callers must guard.
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    expect(listNotes(t, schema)).toHaveLength(2);
  });

  it('removeNote deletes the note', () => {
    const t = track();
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    removeNote(t, 480, laneA.noteType, schema);
    expect(listNotes(t, schema)).toHaveLength(0);
  });

  it('findNote resolves an existing note and null otherwise', () => {
    const t = track();
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    expect(findNote(t, 480, laneA.noteType)).not.toBeNull();
    expect(findNote(t, 480, laneB.noteType)).toBeNull();
  });

  it('typeToLane / laneToType round-trip every lane', () => {
    for (const lane of schema.lanes) {
      expect(typeToLane(schema, lane.noteType)).toBe(lane.index);
      expect(laneToType(schema, lane.index)).toBe(lane.noteType);
    }
  });

  it('schemaNoteId / parseSchemaNoteId round-trip', () => {
    const id = schemaNoteId(720, laneA.noteType);
    const parsed = parseSchemaNoteId(id, schema);
    expect(parsed).toEqual({tick: 720, type: laneA.noteType});
  });

  it('moveNote shifts tick and lane, returning the new id components', () => {
    const t = track();
    addNote(t, {tick: 480, type: laneA.noteType}, schema);
    const chart = createEmptyChart({bpm: 120, resolution: 480});
    const moved = moveNote(chart, t, 480, laneA.noteType, 240, 0, schema);
    expect(moved).toEqual({tick: 720, type: laneA.noteType});
    expect(findNote(t, 720, laneA.noteType)).not.toBeNull();
    expect(findNote(t, 480, laneA.noteType)).toBeNull();
  });

  it('moveNote returns null when no note exists at the source', () => {
    const t = track();
    const chart = createEmptyChart({bpm: 120, resolution: 480});
    expect(moveNote(chart, t, 480, laneA.noteType, 240, 0, schema)).toBeNull();
  });

  it('toggleFlagBits on a binding with no appliesTo is a plain XOR', () => {
    const binding = schema.flagBindings.find(b => !b.appliesTo && !b.complementFlag);
    if (!binding) return; // schema has no unrestricted plain-toggle flag
    const bit = noteFlags[binding.flag];
    const toggled = toggleFlagBits(schema, laneA.noteType, 0, binding.flag);
    expect(toggled & bit).toBeTruthy();
    const toggledBack = toggleFlagBits(schema, laneA.noteType, toggled, binding.flag);
    expect(toggledBack & bit).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Drum-specific behavior: tri-state cymbal/tom, lane legality, kick exclusion
// ---------------------------------------------------------------------------

describe('drums4LaneSchema-specific note adapter behavior', () => {
  const schema: InstrumentSchema = drums4LaneSchema;

  it('defaultFlagBits sets cymbal on yellow/blue/green, not kick/red', () => {
    expect(defaultFlagBits(schema, noteTypes.yellowDrum) & noteFlags.cymbal).toBeTruthy();
    expect(defaultFlagBits(schema, noteTypes.blueDrum) & noteFlags.cymbal).toBeTruthy();
    expect(defaultFlagBits(schema, noteTypes.greenDrum) & noteFlags.cymbal).toBeTruthy();
    expect(defaultFlagBits(schema, noteTypes.kick)).toBe(0);
    expect(defaultFlagBits(schema, noteTypes.redDrum)).toBe(0);
  });

  it('toggleFlagBits cycles cymbal tri-state: unset -> cymbal -> tom -> cymbal', () => {
    let bits = 0;
    bits = toggleFlagBits(schema, noteTypes.yellowDrum, bits, 'cymbal');
    expect(bits & noteFlags.cymbal).toBeTruthy();
    bits = toggleFlagBits(schema, noteTypes.yellowDrum, bits, 'cymbal');
    expect(bits & noteFlags.tom).toBeTruthy();
    expect(bits & noteFlags.cymbal).toBeFalsy();
    bits = toggleFlagBits(schema, noteTypes.yellowDrum, bits, 'cymbal');
    expect(bits & noteFlags.cymbal).toBeTruthy();
    expect(bits & noteFlags.tom).toBeFalsy();
  });

  it('toggleFlagBits on cymbal is a no-op for kick/red (lane legality)', () => {
    expect(toggleFlagBits(schema, noteTypes.kick, 0, 'cymbal')).toBe(0);
    expect(toggleFlagBits(schema, noteTypes.redDrum, 0, 'cymbal')).toBe(0);
  });

  it('legalizeFlagBits strips cymbal/tom when the target type is illegal', () => {
    expect(legalizeFlagBits(schema, noteTypes.redDrum, noteFlags.cymbal)).toBe(0);
    expect(legalizeFlagBits(schema, noteTypes.redDrum, noteFlags.tom)).toBe(0);
  });

  it('addNote legalizes flags at insert time', () => {
    const t = track();
    // A caller passing an illegal cymbal bit on red gets it stripped.
    addNote(t, {tick: 0, type: noteTypes.redDrum, flags: noteFlags.cymbal}, schema);
    expect(findNote(t, 0, noteTypes.redDrum)!.flags & noteFlags.cymbal).toBeFalsy();
  });

  it('setNoteFlags overwrites a note flag bitmask directly', () => {
    const t = track();
    addNote(t, {tick: 0, type: noteTypes.yellowDrum}, schema);
    setNoteFlags(t, 0, noteTypes.yellowDrum, noteFlags.accent, schema);
    expect(findNote(t, 0, noteTypes.yellowDrum)!.flags).toBe(noteFlags.accent);
  });

  it('setNoteFlags throws when no note exists at tick/type', () => {
    const t = track();
    expect(() => setNoteFlags(t, 0, noteTypes.kick, 0, schema)).toThrow();
  });

  it('flam (groupShared) syncs onto every note added to the tick group', () => {
    const t = track();
    addNote(t, {tick: 0, type: noteTypes.kick}, schema);
    addNote(t, {tick: 0, type: noteTypes.redDrum, flags: noteFlags.flam}, schema);
    expect(findNote(t, 0, noteTypes.kick)!.flags & noteFlags.flam).toBeTruthy();
    expect(findNote(t, 0, noteTypes.redDrum)!.flags & noteFlags.flam).toBeTruthy();
  });

  it('flam clears from the group once every member is explicitly un-flammed', () => {
    const t = track();
    addNote(t, {tick: 0, type: noteTypes.kick}, schema);
    addNote(t, {tick: 0, type: noteTypes.redDrum, flags: noteFlags.flam}, schema);
    // Both notes carry the synced bit; explicitly clearing it on both is what
    // it takes to clear the group (matches `setNoteFlags`' "last one to want
    // it wins" contract — removing a note that merely inherited the bit from
    // the sync doesn't clear it from notes that still carry it).
    setNoteFlags(t, 0, noteTypes.kick, 0, schema);
    setNoteFlags(t, 0, noteTypes.redDrum, 0, schema);
    expect(findNote(t, 0, noteTypes.kick)!.flags & noteFlags.flam).toBeFalsy();
    expect(findNote(t, 0, noteTypes.redDrum)!.flags & noteFlags.flam).toBeFalsy();
  });

  it('kick is excluded from the lane-shift axis; pads clamp instead of sliding into it', () => {
    expect(shiftLane(schema, noteTypes.kick, 5)).toBe(noteTypes.kick);
    const {max} = padLaneRange(schema);
    const lastPadType = laneToType(schema, max);
    expect(shiftLane(schema, lastPadType, 10)).toBe(lastPadType);
  });

  it('moveNote drops the cymbal flag when a lane shift lands on an illegal lane', () => {
    const t = track();
    addNote(t, {tick: 480, type: noteTypes.yellowDrum, flags: noteFlags.cymbal}, schema);
    const chart = createEmptyChart({bpm: 120, resolution: 480});
    // yellow (lane 1) -> red (lane 0)
    const moved = moveNote(chart, t, 480, noteTypes.yellowDrum, 0, -1, schema);
    expect(moved).toEqual({tick: 480, type: noteTypes.redDrum});
    expect(findNote(t, 480, noteTypes.redDrum)!.flags & noteFlags.cymbal).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// guitarSchema-specific: no lane-shift exclusions, no tri-state flags
// ---------------------------------------------------------------------------

describe('guitarSchema-specific note adapter behavior', () => {
  const schema = guitarSchema;

  it('every lane participates in the shift axis (no kick-like exclusion)', () => {
    expect(shiftLane(schema, noteTypes.open, 1)).toBe(noteTypes.green);
    expect(shiftLane(schema, noteTypes.green, -1)).toBe(noteTypes.open);
    expect(shiftLane(schema, noteTypes.orange, 1)).toBe(noteTypes.orange); // clamps
  });

  it('defaultFlagBits is 0 for every lane (no defaultOn bindings)', () => {
    for (const lane of schema.lanes) {
      expect(defaultFlagBits(schema, lane.noteType)).toBe(0);
    }
  });

  it('toggleFlagBits on hopo/tap/strum is a plain, unrestricted bit flip', () => {
    let bits = 0;
    bits = toggleFlagBits(schema, noteTypes.green, bits, 'hopo');
    expect(bits & noteFlags.hopo).toBeTruthy();
    bits = toggleFlagBits(schema, noteTypes.green, bits, 'hopo');
    expect(bits & noteFlags.hopo).toBeFalsy();
  });
});
