/**
 * Every per-note context-menu item, as a function of the selection (plan
 * 0126 §4).
 *
 * Two rules under test throughout:
 *
 *  - Add/Remove is an "any" test. Add appears when any target lacks the
 *    property and Remove when any target has it, so a mixed selection shows
 *    both — the only way either direction is reachable without the user
 *    splitting the selection first.
 *  - An action only ever covers the notes whose lane can legally carry the
 *    property, and disappears when that leaves nothing.
 */

import {noteTypes, noteFlags} from '@eliwhite/scan-chart';
import {
  drums4LaneSchema,
  guitarSchema,
  laneToType,
  type TrackKey,
} from '@/lib/chart-edit';
import {noteMenuActions, sustainTicks} from '../noteMenuActions';
import type {PianoRollNote} from '../notes';

const RES = 192;
const DRUMS_KEY: TrackKey = {instrument: 'drums', difficulty: 'expert'};

/** Lane indices in `drums4LaneSchema` order. */
const RED = 0;
const YELLOW = 1;
const KICK = 4;

function drumNote(
  lane: number,
  overrides: Partial<PianoRollNote> = {},
): PianoRollNote {
  return {
    tick: 0,
    lane,
    cymbal: false,
    dynamic: 'none',
    id: `${lane}:n`,
    ...overrides,
  };
}

function fretNote(overrides: Partial<PianoRollNote> = {}): PianoRollNote {
  return {
    tick: 0,
    lane: 1,
    cymbal: false,
    dynamic: 'none',
    id: 'g:n',
    flags: 0,
    length: 0,
    ...overrides,
  };
}

const drumLabels = (targets: PianoRollNote[]): string[] =>
  noteMenuActions({
    schema: drums4LaneSchema,
    targets,
    resolution: RES,
  }).map(a => a.label);

const fretLabels = (targets: PianoRollNote[]): string[] =>
  noteMenuActions({
    schema: guitarSchema,
    targets,
    resolution: RES,
  }).map(a => a.label);

describe('drum dynamics items', () => {
  it('offers Add for both dynamics on a neutral note', () => {
    // Red is a tom lane and can never be a cymbal (§6 lane legality), so no
    // cymbal item here — that rule is exercised on its own below.
    expect(drumLabels([drumNote(RED)])).toEqual([
      'Add accent',
      'Add ghost',
      'Delete note',
    ]);
  });

  it('offers the cymbal switch alongside dynamics on a cymbal-legal lane', () => {
    expect(drumLabels([drumNote(YELLOW)])).toEqual([
      'Switch to cymbal',
      'Add accent',
      'Add ghost',
      'Delete note',
    ]);
  });

  it('offers Remove accent and Add ghost on an accented note', () => {
    const labels = drumLabels([drumNote(RED, {dynamic: 'accent'})]);
    expect(labels).toContain('Remove accent');
    expect(labels).toContain('Add ghost');
    expect(labels).not.toContain('Add accent');
  });

  it('offers only Remove when every note carries the flag', () => {
    const labels = drumLabels([
      drumNote(RED, {dynamic: 'accent', id: 'a'}),
      drumNote(YELLOW, {dynamic: 'accent', id: 'b'}),
    ]);
    expect(labels).toContain('Remove accent');
    expect(labels).not.toContain('Add accent');
  });

  it('offers both Add and Remove for a mixed selection', () => {
    const labels = drumLabels([
      drumNote(RED, {dynamic: 'accent', id: 'a'}),
      drumNote(YELLOW, {id: 'b'}),
    ]);
    expect(labels).toContain('Add accent');
    expect(labels).toContain('Remove accent');
  });

  it('resolves each dynamic independently', () => {
    const labels = drumLabels([
      drumNote(RED, {dynamic: 'accent', id: 'a'}),
      drumNote(YELLOW, {dynamic: 'ghost', id: 'b'}),
    ]);
    for (const label of [
      'Add accent',
      'Remove accent',
      'Add ghost',
      'Remove ghost',
    ]) {
      expect(labels).toContain(label);
    }
  });
});

describe('lane legality', () => {
  it('offers no dynamics items for a kick-only selection', () => {
    expect(drumLabels([drumNote(KICK)])).toEqual(['Delete note']);
  });

  it('keeps the dynamics items when a kick is mixed in with pads', () => {
    const labels = drumLabels([
      drumNote(KICK, {id: 'k'}),
      drumNote(RED, {id: 'r'}),
    ]);
    expect(labels).toContain('Add accent');
  });

  it('excludes the kick from the ids the dynamics command receives', () => {
    // The kick must be left untouched, not merely refused by the mutator.
    const action = noteMenuActions({
      schema: drums4LaneSchema,
      targets: [drumNote(KICK, {id: 'k'}), drumNote(RED, {id: 'r'})],
      resolution: RES,
    }).find(a => a.label === 'Add accent')!;
    expect(action.makeCommand(DRUMS_KEY).description).toContain('1 note');
  });

  it('offers no cymbal item for a red-and-kick selection', () => {
    const labels = drumLabels([
      drumNote(RED, {id: 'r'}),
      drumNote(KICK, {id: 'k'}),
    ]);
    expect(labels).not.toContain('Switch to cymbal');
    expect(labels).not.toContain('Switch to tom');
  });

  it('reads the cymbal item off the cymbal-legal notes only', () => {
    const labels = drumLabels([
      drumNote(YELLOW, {cymbal: true, id: 'y'}),
      drumNote(RED, {id: 'r'}),
    ]);
    expect(labels).toContain('Switch to tom');
  });
});

describe('five-fret items', () => {
  it('offers technique and sustain items, and no drum items', () => {
    expect(fretLabels([fretNote()])).toEqual([
      'Add sustain',
      'Natural (auto)',
      'Strum',
      'HOPO',
      'Tap',
      'Delete note',
    ]);
  });

  it('ticks the technique every selected note already has', () => {
    const actions = noteMenuActions({
      schema: guitarSchema,
      targets: [fretNote({flags: noteFlags.tap})],
      resolution: RES,
    });
    expect(actions.find(a => a.label === 'Tap')?.checked).toBe(true);
    expect(actions.find(a => a.label === 'HOPO')?.checked).toBe(false);
  });

  it('leaves a technique unticked for a mixed selection', () => {
    const actions = noteMenuActions({
      schema: guitarSchema,
      targets: [
        fretNote({flags: noteFlags.tap, id: 'a'}),
        fretNote({flags: noteFlags.hopo, id: 'b'}),
      ],
      resolution: RES,
    });
    expect(actions.every(a => a.checked !== true)).toBe(true);
  });
});

describe('sustain items', () => {
  const TWO_BEATS = sustainTicks(RES);

  it('measures the tail in beats, not in snap divisions', () => {
    expect(sustainTicks(192)).toBe(384);
    expect(sustainTicks(480)).toBe(960);
  });

  it('offers only Add for a note with no tail', () => {
    const labels = fretLabels([fretNote({length: 0})]);
    expect(labels).toContain('Add sustain');
    expect(labels).not.toContain('Remove sustain');
  });

  it('offers only Remove once the tail is the standard length', () => {
    const labels = fretLabels([fretNote({length: TWO_BEATS})]);
    expect(labels).toContain('Remove sustain');
    expect(labels).not.toContain('Add sustain');
  });

  it('offers both for a tail of some other length', () => {
    // Add is the only way to normalize a hand-dragged tail to the standard
    // one, so it stays on offer even though the note is already sustained.
    const labels = fretLabels([fretNote({length: 50})]);
    expect(labels).toContain('Add sustain');
    expect(labels).toContain('Remove sustain');
  });

  it('offers no sustain items on a schema without sustain', () => {
    expect(drumLabels([drumNote(RED)])).not.toContain('Add sustain');
  });
});

describe('delete item', () => {
  it('counts the selection', () => {
    expect(drumLabels([drumNote(RED, {id: 'a'})])).toContain('Delete note');
    expect(
      drumLabels([drumNote(RED, {id: 'a'}), drumNote(YELLOW, {id: 'b'})]),
    ).toContain('Delete 2 notes');
  });

  it('is the only destructive action', () => {
    const actions = noteMenuActions({
      schema: drums4LaneSchema,
      targets: [drumNote(RED)],
      resolution: RES,
    });
    expect(actions.filter(a => a.danger).map(a => a.label)).toEqual([
      'Delete note',
    ]);
  });
});

it('offers nothing for an empty selection', () => {
  expect(drumLabels([])).toEqual([]);
});

it('never offers an item on a lane the mutator would refuse', () => {
  // Every drum lane, every schema flag: an offered item must name at least
  // one note, or it is an item that does nothing when clicked.
  for (let lane = 0; lane < drums4LaneSchema.lanes.length; lane++) {
    const actions = noteMenuActions({
      schema: drums4LaneSchema,
      targets: [drumNote(lane)],
      resolution: RES,
    });
    for (const action of actions) {
      expect(action.makeCommand(DRUMS_KEY).description).not.toContain('0 note');
    }
  }
});

it('pins the drum lane indices this file assumes', () => {
  expect(laneToType(drums4LaneSchema, RED)).toBe(noteTypes.redDrum);
  expect(laneToType(drums4LaneSchema, YELLOW)).toBe(noteTypes.yellowDrum);
  expect(laneToType(drums4LaneSchema, KICK)).toBe(noteTypes.kick);
});
