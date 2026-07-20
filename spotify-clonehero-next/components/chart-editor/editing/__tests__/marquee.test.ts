/**
 * selectNotesInRange box-select math tests.
 *
 * Pure function — no React, no DOM. The screen-to-world conversion is
 * the caller's job; this test passes already-converted bounds.
 */

import {selectNotesInRange} from '../marquee';
import type {DrumNote} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {noteId} from '../../commands';
import {noteTypes} from '@eliwhite/scan-chart';

/** 120 BPM, resolution 480: 1 beat = 500ms, 1 tick ≈ 1.0417ms. */
const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RESOLUTION = 480;

function note(tick: number, type: DrumNote['type']): DrumNote {
  return {tick, type, length: 0, flags: 0};
}

describe('selectNotesInRange', () => {
  it('selects notes whose ms-time + lane fall inside the box', () => {
    const notes: DrumNote[] = [
      note(0, noteTypes.kick),
      note(480, noteTypes.redDrum),
      note(960, noteTypes.yellowDrum),
      note(1440, noteTypes.blueDrum),
    ];
    // 480 ticks @ 120 BPM is 500ms. Red=lane 0, yellow=lane 1.
    const result = selectNotesInRange(
      notes,
      {msMin: 400, msMax: 1100, laneMin: 0, laneMax: 1},
      TIMED_TEMPOS,
      RESOLUTION,
    );
    expect(result).toEqual(
      new Set([
        noteId({tick: 480, type: noteTypes.redDrum}),
        noteId({tick: 960, type: noteTypes.yellowDrum}),
      ]),
    );
  });

  it('lane bounds are inclusive on both ends', () => {
    // Red=lane 0, yellow=lane 1, blue=lane 2 — bounds [0,1] should include
    // red+yellow but not blue.
    const notes = [
      note(0, noteTypes.redDrum),
      note(0, noteTypes.yellowDrum),
      note(0, noteTypes.blueDrum),
    ];
    const result = selectNotesInRange(
      notes,
      {msMin: -1, msMax: 1, laneMin: 0, laneMax: 1},
      TIMED_TEMPOS,
      RESOLUTION,
    );
    expect(result).toEqual(
      new Set([
        noteId({tick: 0, type: noteTypes.redDrum}),
        noteId({tick: 0, type: noteTypes.yellowDrum}),
      ]),
    );
  });

  it('empty box selects nothing', () => {
    const notes = [note(480, noteTypes.redDrum)];
    const result = selectNotesInRange(
      notes,
      {msMin: 0, msMax: 0, laneMin: 0, laneMax: 0},
      TIMED_TEMPOS,
      RESOLUTION,
    );
    expect(result.size).toBe(0);
  });

  it('handles tempo changes — uses the active tempo for each tick', () => {
    // Tempo doubles at tick 960. Notes after 960 advance twice as fast in ms.
    const tempos: TimedTempo[] = [
      {tick: 0, beatsPerMinute: 120, msTime: 0},
      {tick: 960, beatsPerMinute: 240, msTime: 1000},
    ];
    const notes = [
      note(0, noteTypes.kick), // 0ms
      note(960, noteTypes.redDrum), // 1000ms
      note(1440, noteTypes.yellowDrum), // 1000 + 500*((1440-960)/960) = 1250ms
    ];
    // Box spans 1100..1500 — should pick up only the third note.
    const result = selectNotesInRange(
      notes,
      {msMin: 1100, msMax: 1500, laneMin: 0, laneMax: 4},
      tempos,
      RESOLUTION,
    );
    expect(result).toEqual(
      new Set([noteId({tick: 1440, type: noteTypes.yellowDrum})]),
    );
  });
});
