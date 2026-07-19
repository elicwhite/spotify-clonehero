/**
 * Piano-roll hit-test tests (plan 0062 §6). Pure geometry: lane row under a
 * pixel, nearest note under a pixel, marquee rect → (ms × lane) bounds.
 *
 * Display order (top→bottom) is Red, Yellow, Blue, Green, Kick — the same
 * order as the editor lane indices (0 red, 1 yellow, 2 blue, 3 green, 4
 * kick; see `typeToLane`/`laneToType` in `../../commands`), so the display
 * row *is* the data lane.
 */

import {
  laneAtY,
  marqueeBounds,
  pickNoteAt,
  pickLyricChipAt,
  pickPhraseEdgeAt,
  pickPhraseBandAt,
  phraseEdgeDragBounds,
  xToTickNoSnap,
} from '../hitTest';
import type {PianoRollNote} from '../notes';
import type {LyricBand, LyricChip} from '../lyricsScene';
import type {PianoRollView} from '../viewMath';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';

const VIEW: PianoRollView = {leftMs: 0, pxPerMs: 0.1}; // 1000ms → 100px
// 5 rows: [50,70) Red, [70,90) Yellow, [90,110) Blue, [110,130) Green,
// [130,150) Kick.
const GEO = {laneTop: 50, laneH: 20};
const TIMED_TEMPOS: TimedTempo[] = [{tick: 0, beatsPerMinute: 120, msTime: 0}];
const RES = 480; // 480 ticks = 500ms @ 120 BPM → x = 50px

function note(tick: number, lane: number, id: string): PianoRollNote {
  return {tick, lane, cymbal: false, id};
}

describe('laneAtY', () => {
  it('maps a y pixel to its lane row', () => {
    expect(laneAtY(50, GEO)).toBe(0); // top row -> Red
    expect(laneAtY(69, GEO)).toBe(0);
    expect(laneAtY(70, GEO)).toBe(1); // Yellow
    expect(laneAtY(90, GEO)).toBe(2); // Blue
    expect(laneAtY(110, GEO)).toBe(3); // Green
    expect(laneAtY(149, GEO)).toBe(4); // bottom row -> Kick
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
  // red note at tick 480 → 500ms → x = 50px, lane 0 (Red, top row) → y
  // center 60.
  const notes = [note(480, 0, '480:redDrum'), note(960, 1, '960:yellowDrum')];

  it('picks the note under the pointer on the right lane', () => {
    expect(pickNoteAt(notes, ctx, 50, 60)?.id).toBe('480:redDrum');
  });

  it('misses when the pointer is on a different lane', () => {
    // x hits the note but y is on the Yellow row (lane 1).
    expect(pickNoteAt(notes, ctx, 50, 80)).toBeNull();
  });

  it('misses when the pointer is outside the glyph half-width', () => {
    expect(pickNoteAt(notes, ctx, 65, 60)).toBeNull(); // 15px away > 8
  });

  it('picks the nearest note when several share a lane', () => {
    const crowded = [note(480, 0, 'a'), note(500, 0, 'b')]; // 500ms/520.8ms
    // tick 500 → ~520.8ms → x≈52px; pointer at 53 is closer to b.
    expect(pickNoteAt(crowded, ctx, 53, 60)?.id).toBe('b');
  });
});

describe('marqueeBounds', () => {
  it('converts a rect to inclusive ms + lane bounds', () => {
    // Drag from (30px, 65y) to (120px, 115y): x 30..120 → ms 300..1200,
    // y 65..115 → lanes 0..3 (Red..Green).
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

// ---------------------------------------------------------------------------
// Lyrics row (plan 0063 Part D)
// ---------------------------------------------------------------------------

function chip(tick: number, id: string): LyricChip {
  return {
    id,
    tick,
    ms: tick / 0.96, // 480 ticks/500ms @ 120bpm/480res -> ms = tick * (500/480)
    text: id,
    phraseMinTick: 0,
    phraseMaxTick: 1_000_000,
  };
}

describe('pickLyricChipAt', () => {
  // Same VIEW as above: 1000ms -> 100px, so 480 ticks (500ms @ 120bpm) -> 50px.
  const chips = [chip(480, 'vocals:480'), chip(960, 'vocals:960')];
  // Pill rect for a chip at x=cx is [cx - 2, cx + width + 8] (mirrors
  // `drawLyricsRow`'s `roundRect(x - 2, ..., tw + 8, ...)`).
  const widths = new Map([
    ['vocals:480', 20],
    ['vocals:960', 20],
  ]);

  it('picks the chip whose rendered pill rect contains the pointer', () => {
    expect(pickLyricChipAt(chips, VIEW, 50, widths)?.id).toBe('vocals:480');
    // Still inside the pill's right edge (cx=50, right=50+20+8=78).
    expect(pickLyricChipAt(chips, VIEW, 75, widths)?.id).toBe('vocals:480');
  });

  it("misses when outside every chip's pill rect", () => {
    expect(pickLyricChipAt(chips, VIEW, 85, widths)).toBeNull();
  });

  it('a longer syllable has a wider hit box than a short one', () => {
    const wide = new Map([
      ['vocals:480', 4],
      ['vocals:960', 60],
    ]);
    // x=90 is well past chip 480's narrow pill (right edge 50+4+8=62) but
    // still inside chip 960's wide one (left edge 100-2=98)... use a point
    // that only the wide pill covers.
    expect(pickLyricChipAt(chips, VIEW, 70, wide)).toBeNull();
    const wideChips = [chip(480, 'vocals:480')];
    expect(pickLyricChipAt(wideChips, VIEW, 60, wide)?.id).toBe('vocals:480');
  });

  it('picks the nearer of two overlapping pills by center distance', () => {
    const crowded = [chip(480, 'a'), chip(500, 'b')]; // centers 50px / ~52px
    const crowdedWidths = new Map([
      ['a', 20],
      ['b', 20],
    ]);
    expect(pickLyricChipAt(crowded, VIEW, 53, crowdedWidths)?.id).toBe('b');
  });

  it('returns null for an empty chip list', () => {
    expect(pickLyricChipAt([], VIEW, 50, widths)).toBeNull();
  });

  it('falls back to a default width for an unmeasured chip', () => {
    expect(pickLyricChipAt(chips, VIEW, 50, new Map())?.id).toBe('vocals:480');
  });
});

describe('pickPhraseEdgeAt', () => {
  function band(tick: number, tickEnd: number): LyricBand {
    return {
      tick,
      tickEnd,
      ms: tick / 0.96,
      msEnd: tickEnd / 0.96,
    };
  }

  // Same VIEW: 480 ticks -> 50px, 960 ticks -> 100px.
  const bands = [band(0, 480)];

  it('hits the phrase-start edge near its ms position', () => {
    expect(pickPhraseEdgeAt(bands, VIEW, 1)).toEqual({
      kind: 'phrase-start',
      tick: 0,
      bandIndex: 0,
    });
  });

  it('hits the phrase-end edge near its ms position', () => {
    expect(pickPhraseEdgeAt(bands, VIEW, 49)).toEqual({
      kind: 'phrase-end',
      tick: 480,
      bandIndex: 0,
    });
  });

  it('misses outside the hit radius of both edges', () => {
    expect(pickPhraseEdgeAt(bands, VIEW, 25)).toBeNull();
  });
});

describe('phraseEdgeDragBounds', () => {
  function band(tick: number, tickEnd: number): LyricBand {
    return {tick, tickEnd, ms: tick / 0.96, msEnd: tickEnd / 0.96};
  }
  const bands = [band(0, 480), band(960, 1440)];

  it('bounds a phrase-start drag to [0, ownEnd - 1] with no preceding phrase', () => {
    expect(phraseEdgeDragBounds(bands, 0, 'phrase-start')).toEqual({
      min: 0,
      max: 479,
    });
  });

  it('bounds a phrase-start drag to [prevEnd, ownEnd - 1] with a preceding phrase', () => {
    expect(phraseEdgeDragBounds(bands, 1, 'phrase-start')).toEqual({
      min: 480,
      max: 1439,
    });
  });

  it('bounds a phrase-end drag to [ownStart + 1, nextStart] with a following phrase', () => {
    expect(phraseEdgeDragBounds(bands, 0, 'phrase-end')).toEqual({
      min: 1,
      max: 960,
    });
  });

  it('bounds a phrase-end drag to [ownStart + 1, +Infinity] with no following phrase', () => {
    expect(phraseEdgeDragBounds(bands, 1, 'phrase-end')).toEqual({
      min: 961,
      max: Number.POSITIVE_INFINITY,
    });
  });
});

describe('pickPhraseBandAt', () => {
  function band(tick: number, tickEnd: number): LyricBand {
    return {
      tick,
      tickEnd,
      ms: tick / 0.96,
      msEnd: tickEnd / 0.96,
    };
  }
  const bands = [band(0, 480), band(960, 1440)];

  it('finds the band containing x', () => {
    expect(pickPhraseBandAt(bands, VIEW, 20)?.tick).toBe(0);
  });

  it('returns null for x outside every band', () => {
    expect(pickPhraseBandAt(bands, VIEW, 70)).toBeNull();
  });
});

describe('xToTickNoSnap', () => {
  it('converts x -> ms -> tick with no grid snap, unlike a snapped read', () => {
    // 53px -> 530ms -> ~127.2 ticks @ 120bpm/480res (not a multiple of any
    // grid division) -- this is the whole point of the "no-snap" contract.
    const tick = xToTickNoSnap(53, VIEW, TIMED_TEMPOS, RES);
    expect(tick).not.toBe(0);
    expect(tick % (RES / 4)).not.toBe(0);
  });

  it('is continuous: nearby pixels produce nearby (not grid-quantized) ticks', () => {
    const a = xToTickNoSnap(50, VIEW, TIMED_TEMPOS, RES);
    const b = xToTickNoSnap(51, VIEW, TIMED_TEMPOS, RES);
    // 1px at this view's scale is ~4.8 ticks; a snapped read would jump in
    // much larger, grid-aligned increments (e.g. RES/4 = 120 ticks).
    expect(Math.abs(b - a)).toBeLessThan(RES / 4);
  });

  it("round-trips a chip's own ms back to (approximately) its tick", () => {
    const view: PianoRollView = {leftMs: 0, pxPerMs: 0.1};
    const x = 50; // chip at tick 480 sits at ms 500 -> x 50 under this view
    expect(xToTickNoSnap(x, view, TIMED_TEMPOS, RES)).toBe(480);
  });
});
