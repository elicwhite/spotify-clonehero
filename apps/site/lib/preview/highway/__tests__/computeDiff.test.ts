/**
 * Tests for NotesManager.computeDiff() -- the pure diff logic that
 * determines which PreparedNotes have been added, removed, or moved.
 */

import {NotesManager} from '../NotesManager';
import type {PreparedNote} from '../types';

// Jest can't construct a full THREE.js scene, but computeDiff is a static
// method that only operates on PreparedNote data structures (no THREE dependency).

/** Helper to create a minimal PreparedNote for testing. */
function pn(
  tick: number,
  type: number,
  msTime: number,
  xPosition: number = 0,
  flags: number = 0,
): PreparedNote {
  return {
    note: {
      tick,
      type,
      flags,
      msTime,
      msLength: 0,
    },
    msTime,
    msLength: 0,
    xPosition,
    inStarPower: false,
    isKick: type === 12, // noteTypes.kick = 12
    isOpen: false,
    lane: type === 12 ? -1 : type - 13, // kick=-1, redDrum=0, yellowDrum=1, etc.
  } as PreparedNote;
}

describe('NotesManager.computeDiff', () => {
  it('returns empty diff for identical arrays', () => {
    const notes = [pn(0, 13, 0), pn(480, 14, 500), pn(960, 15, 1000)];

    const diff = NotesManager.computeDiff(notes, [...notes]);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
  });

  it('detects added notes', () => {
    const old = [pn(0, 13, 0)];
    const added = pn(480, 14, 500);
    const newer = [pn(0, 13, 0), added];

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].note.tick).toBe(480);
    expect(diff.added[0].note.type).toBe(14);
    expect(diff.removed).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
  });

  it('detects removed notes', () => {
    const old = [pn(0, 13, 0), pn(480, 14, 500)];
    const newer = [pn(0, 13, 0)];

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toEqual([1]); // index 1 in old array
    expect(diff.moved).toHaveLength(0);
  });

  it('detects moved notes (msTime changed)', () => {
    const old = [pn(0, 13, 0), pn(480, 14, 500)];
    const newer = [pn(0, 13, 0), pn(480, 14, 600)]; // same tick:type, different msTime

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.moved).toHaveLength(1);
    expect(diff.moved[0].oldIndex).toBe(1);
    expect(diff.moved[0].newNote.msTime).toBe(600);
  });

  it('detects moved notes (xPosition changed)', () => {
    const old = [pn(480, 14, 500, 0.1)];
    const newer = [pn(480, 14, 500, 0.3)]; // same tick:type, different xPosition

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.moved).toHaveLength(1);
    expect(diff.moved[0].newNote.xPosition).toBe(0.3);
  });

  it('detects moved notes (flags changed)', () => {
    const old = [pn(480, 14, 500, 0.1, 0)];
    const newer = [pn(480, 14, 500, 0.1, 32)]; // cymbal flag added

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.moved).toHaveLength(1);
    expect(diff.moved[0].newNote.note.flags).toBe(32);
  });

  it('handles combined add + remove (note type change at same tick)', () => {
    // Old: kick at tick 0; New: red drum at tick 0
    const old = [pn(0, 12, 0)];
    const newer = [pn(0, 13, 0)];

    const diff = NotesManager.computeDiff(old, newer);

    // Different tick:type key, so it's a remove + add
    expect(diff.removed).toEqual([0]);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].note.type).toBe(13);
    expect(diff.moved).toHaveLength(0);
  });

  it('handles empty old array (all added)', () => {
    const newer = [pn(0, 13, 0), pn(480, 14, 500)];

    const diff = NotesManager.computeDiff([], newer);

    expect(diff.added).toHaveLength(2);
    expect(diff.removed).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
  });

  it('handles empty new array (all removed)', () => {
    const old = [pn(0, 13, 0), pn(480, 14, 500)];

    const diff = NotesManager.computeDiff(old, []);

    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toEqual([0, 1]);
    expect(diff.moved).toHaveLength(0);
  });

  it('handles complex scenario with adds, removes, and moves', () => {
    const old = [
      pn(0, 12, 0), // kick at tick 0 - will remain
      pn(480, 13, 500), // red at tick 480 - will be removed
      pn(960, 14, 1000), // yellow at tick 960 - will be moved (msTime changes)
    ];
    const newer = [
      pn(0, 12, 0), // kick unchanged
      pn(960, 14, 1100), // yellow moved (msTime changed)
      pn(1440, 15, 1500), // blue added
    ];

    const diff = NotesManager.computeDiff(old, newer);

    expect(diff.removed).toEqual([1]); // red at index 1 removed
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].note.tick).toBe(1440); // blue added
    expect(diff.moved).toHaveLength(1);
    expect(diff.moved[0].oldIndex).toBe(2); // yellow at index 2 moved
    expect(diff.moved[0].newNote.msTime).toBe(1100);
  });

  it('does not report unchanged star power status as a move', () => {
    // Same note, same star power status
    const note1: PreparedNote = {
      ...pn(0, 13, 0),
      inStarPower: true,
    };
    const note2: PreparedNote = {
      ...pn(0, 13, 0),
      inStarPower: true,
    };

    const diff = NotesManager.computeDiff([note1], [note2]);
    expect(diff.moved).toHaveLength(0);
  });

  it('detects star power status change as a move', () => {
    const note1: PreparedNote = {
      ...pn(0, 13, 0),
      inStarPower: false,
    };
    const note2: PreparedNote = {
      ...pn(0, 13, 0),
      inStarPower: true,
    };

    const diff = NotesManager.computeDiff([note1], [note2]);
    expect(diff.moved).toHaveLength(1);
  });
});
