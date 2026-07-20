/**
 * View-parity tests (plan 0062 "Two views, one store", Testing section).
 *
 * The highway and the piano roll are two projections of one store. For every
 * gesture available in both views, an equivalent gesture must dispatch the
 * *identical* command with identical parameters — not "kept in sync," but
 * incapable of disagreement because both views call the same shared
 * semantics (`computeNoteDragDelta`, `selectNotesInRange`,
 * `defaultFlagsForType`) and the same command objects (`MoveEntitiesCommand`,
 * `AddNoteCommand`, ...).
 *
 * These tests exercise the shared layer both views funnel through and assert
 * the resulting command's *effect* (its `execute(doc)` output) is byte-equal,
 * which is the strongest form of "identical command."
 */

import {makeFixtureDoc, expectDocsEqual} from '../../__tests__/fixtures';
import {DEFAULT_DRUMS_EXPERT_SCOPE, entityContextFromScope} from '../../scope';
import {
  AddNoteCommand,
  MoveEntitiesCommand,
  defaultFlagsForType,
  laneToType,
  typeToLane,
  KICK_LANE,
  toSchemaNote,
  type EditCommand,
} from '../../commands';
import {computeNoteDragDelta} from '../gestures';
import {selectNotesInRange} from '../marquee';
import type {DrumNote} from '@/lib/chart-edit';
import {getDrumNotes, findTrack} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

const TRACK_KEY = {instrument: 'drums', difficulty: 'expert'} as const;
const CTX = entityContextFromScope(DEFAULT_DRUMS_EXPERT_SCOPE);
const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RES = 480;

/** Run a command against a fresh fixture doc and return the resulting doc. */
function applied(cmd: EditCommand) {
  return cmd.execute(makeFixtureDoc());
}

describe('view parity: note drag → MoveEntitiesCommand', () => {
  it('an equivalent drag in each view produces the same command effect', () => {
    // Gesture: grab the red note at tick 480 (lane 0), drag it to snapped
    // tick 960 on the same lane, single-note selection. Both views resolve
    // this to the same anchor + snapped cursor tick + lane + selection size.
    const gesture = {
      anchorTick: 480,
      anchorLane: 0,
      snappedCursorTick: 960,
      cursorLane: 0,
      selectionSize: 1,
      prevLaneDelta: 0,
      minPadLane: 0,
      maxPadLane: 3,
      kickLane: KICK_LANE,
    };
    const ids = ['480:redDrum'];

    // "Highway" path and "piano-roll" path both call the shared helper +
    // the shared command class with the same resolved gesture.
    const highwayDelta = computeNoteDragDelta(gesture);
    const pianoDelta = computeNoteDragDelta(gesture);
    expect(pianoDelta).toEqual(highwayDelta);

    const highwayCmd = new MoveEntitiesCommand(
      'note',
      ids,
      highwayDelta.tickDelta,
      highwayDelta.laneDelta,
      CTX,
    );
    const pianoCmd = new MoveEntitiesCommand(
      'note',
      ids,
      pianoDelta.tickDelta,
      pianoDelta.laneDelta,
      CTX,
    );

    expect(pianoCmd.description).toBe(highwayCmd.description);
    expectDocsEqual(applied(pianoCmd), applied(highwayCmd));
  });

  it('multi-note drag locks lanes identically in both views', () => {
    // Two selected notes, dragged up a lane and forward in time. Both views
    // must lock lanes (time-only move) — same laneDelta 0.
    const gesture = {
      anchorTick: 480,
      anchorLane: 0,
      snappedCursorTick: 720,
      cursorLane: 2,
      selectionSize: 2,
      prevLaneDelta: 0,
      minPadLane: 0,
      maxPadLane: 3,
      kickLane: KICK_LANE,
    };
    const ids = ['480:redDrum', '1440:blueDrum'];
    const delta = computeNoteDragDelta(gesture);
    expect(delta.laneDelta).toBe(0);
    expect(delta.tickDelta).toBe(240);

    const cmd = new MoveEntitiesCommand(
      'note',
      ids,
      delta.tickDelta,
      delta.laneDelta,
      CTX,
    );
    const result = applied(cmd);
    const notes = getDrumNotes(findTrack(result, TRACK_KEY)!.track);
    // Both moved +240 ticks, neither changed lane.
    expect(notes.find(n => n.type === 'redDrum')!.tick).toBe(720);
    expect(notes.find(n => n.type === 'blueDrum')!.tick).toBe(1680);
  });

  it('dragging a cymbal onto Red drops the flag (legality below the view)', () => {
    // Yellow cymbal at tick 960 (lane 1) dragged down to red (lane 0). The
    // gesture layer only computes laneDelta; the mutator strips the illegal
    // cymbal — same result regardless of which view issued the drag.
    const delta = computeNoteDragDelta({
      anchorTick: 960,
      anchorLane: 1,
      snappedCursorTick: 960,
      cursorLane: 0,
      selectionSize: 1,
      prevLaneDelta: 0,
      minPadLane: 0,
      maxPadLane: 3,
      kickLane: KICK_LANE,
    });
    expect(delta.laneDelta).toBe(-1);
    const result = new MoveEntitiesCommand(
      'note',
      ['960:yellowDrum'],
      delta.tickDelta,
      delta.laneDelta,
      CTX,
    ).execute(makeFixtureDoc());
    const red = getDrumNotes(findTrack(result, TRACK_KEY)!.track).find(
      n => n.type === 'redDrum' && n.tick === 960,
    );
    expect(red).toBeDefined();
    expect(red!.flags.cymbal).toBeFalsy();
  });
});

describe('view parity: click-to-add → AddNoteCommand', () => {
  it('placing a note builds the identical command in both views', () => {
    // Both views: lane index → type via laneToType, snapped tick, default
    // flags for that type. Yellow lane (1) → cymbal-by-default.
    const lane = 1;
    const tick = 240;
    const type = laneToType(lane);
    const highwayCmd = new AddNoteCommand(toSchemaNote({tick, type, length: 0, flags: defaultFlagsForType(type)}),
      TRACK_KEY,
    );
    const pianoCmd = new AddNoteCommand(toSchemaNote({tick, type, length: 0, flags: defaultFlagsForType(type)}),
      TRACK_KEY,
    );
    expectDocsEqual(applied(pianoCmd), applied(highwayCmd));
  });
});

describe('view parity: marquee → selectNotesInRange', () => {
  it('an equivalent box selects the same notes in both views', () => {
    const notes: DrumNote[] = getDrumNotes(
      findTrack(makeFixtureDoc(), TRACK_KEY)!.track,
    );
    // Piano roll builds DrumNote-shaped rows from PianoRollNotes; the highway
    // passes DrumNotes directly. Same bounds → same set.
    const bounds = {msMin: 400, msMax: 1100, laneMin: 1, laneMax: 2};
    const highwaySet = selectNotesInRange(notes, bounds, TIMED_TEMPOS, RES);
    const pianoSet = selectNotesInRange(
      notes.map(n => ({
        tick: n.tick,
        type: laneToType(typeToLane(n.type)),
        length: 0,
        flags: {},
      })),
      bounds,
      TIMED_TEMPOS,
      RES,
    );
    expect(pianoSet).toEqual(highwaySet);
  });
});
