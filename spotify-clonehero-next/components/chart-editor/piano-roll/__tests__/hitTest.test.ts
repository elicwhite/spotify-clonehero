/**
 * Piano-roll hit-test tests (plan 0062 §6). Pure geometry: lane row under a
 * pixel, nearest note under a pixel, marquee rect → (ms × lane) bounds.
 */

import {laneAtY, marqueeBounds, pickNoteAt} from '../hitTest';
import type {PianoRollNote} from '../notes';
import type {PianoRollView} from '../viewMath';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

const VIEW: PianoRollView = {leftMs: 0, pxPerMs: 0.1}; // 1000ms → 100px
const GEO = {laneTop: 50, laneH: 20}; // 5 lanes: [50,70,90,110,130,150)
const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RES = 480; // 480 ticks = 500ms @ 120 BPM → x = 50px

function note(tick: number, lane: number, id: string): PianoRollNote {
  return {tick, lane, cymbal: false, id};
}

describe('laneAtY', () => {
  it('maps a y pixel to its lane row', () => {
    expect(laneAtY(50, GEO)).toBe(0);
    expect(laneAtY(69, GEO)).toBe(0);
    expect(laneAtY(70, GEO)).toBe(1);
    expect(laneAtY(149, GEO)).toBe(4);
  });

  it('returns null outside the note-lane band', () => {
    expect(laneAtY(49, GEO)).toBeNull();
    expect(laneAtY(150, GEO)).toBeNull();
    expect(laneAtY(0, GEO)).toBeNull();
  });
});

describe('pickNoteAt', () => {
  const ctx = {
    view: VIEW,
    geo: GEO,
    timedTempos: TIMED_TEMPOS,
    resolution: RES,
    hitHalfWidth: 8,
  };
  // red note at tick 480 → 500ms → x = 50px, lane 1 → y center 80.
  const notes = [note(480, 1, '480:redDrum'), note(960, 2, '960:yellowDrum')];

  it('picks the note under the pointer on the right lane', () => {
    expect(pickNoteAt(notes, ctx, 50, 80)?.id).toBe('480:redDrum');
  });

  it('misses when the pointer is on a different lane', () => {
    // x hits the note but y is on lane 0.
    expect(pickNoteAt(notes, ctx, 50, 55)).toBeNull();
  });

  it('misses when the pointer is outside the glyph half-width', () => {
    expect(pickNoteAt(notes, ctx, 65, 80)).toBeNull(); // 15px away > 8
  });

  it('picks the nearest note when several share a lane', () => {
    const crowded = [note(480, 1, 'a'), note(500, 1, 'b')]; // 500ms/520.8ms
    // tick 500 → ~520.8ms → x≈52px; pointer at 53 is closer to b.
    expect(pickNoteAt(crowded, ctx, 53, 80)?.id).toBe('b');
  });
});

describe('marqueeBounds', () => {
  it('converts a rect to inclusive ms + lane bounds', () => {
    // Drag from (30px, 65y) to (120px, 115y): x 30..120 → ms 300..1200,
    // y 65..115 → lanes 0..3.
    const bounds = marqueeBounds({x0: 30, y0: 65, x1: 120, y1: 115}, VIEW, GEO);
    expect(bounds.msMin).toBeCloseTo(300, 5);
    expect(bounds.msMax).toBeCloseTo(1200, 5);
    expect(bounds.laneMin).toBe(0);
    expect(bounds.laneMax).toBe(3);
  });

  it('normalizes a bottom-up / right-to-left drag', () => {
    const bounds = marqueeBounds({x0: 120, y0: 115, x1: 30, y1: 65}, VIEW, GEO);
    expect(bounds.msMin).toBeCloseTo(300, 5);
    expect(bounds.msMax).toBeCloseTo(1200, 5);
    expect(bounds.laneMin).toBe(0);
    expect(bounds.laneMax).toBe(3);
  });

  it('clamps lanes outside the band into range', () => {
    const bounds = marqueeBounds({x0: 0, y0: 0, x1: 10, y1: 500}, VIEW, GEO);
    expect(bounds.laneMin).toBe(0);
    expect(bounds.laneMax).toBe(4);
  });
});
