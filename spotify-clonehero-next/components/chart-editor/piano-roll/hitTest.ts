/**
 * Pure hit-testing for the piano-roll note lanes (plan 0062 §6).
 *
 * The canvas hit-tests, React decides, commands mutate — same
 * hybrid-interaction philosophy as the highway. These helpers turn a pointer
 * pixel into a lane row and the note under it, and turn a marquee rectangle
 * into (ms × lane) bounds for the shared `selectNotesInRange`. No React, no
 * canvas, no store access.
 *
 * The tick↔ms conversion reuses the canonical `tickToMs`
 * (`lib/drum-transcription/timing.ts`) so the hit geometry can never disagree
 * with what the panel draws.
 */

import {tickToMs, msToTick} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {msToX, xToMs, type PianoRollView} from './viewMath';
import type {PianoRollNote} from './notes';
import type {LyricBand, LyricChip} from './lyricsScene';

/** Vertical layout of the note-lane band inside the panel canvas. */
export interface LaneGeometry {
  /** Top y (px) of the first note lane. */
  laneTop: number;
  /** Height (px) of one lane row. */
  laneH: number;
  /** Number of note lanes (the active scope's schema lane count). */
  laneCount: number;
}

/**
 * Editor lane row (0..laneCount-1) under a y pixel, or null when the point
 * is outside the note-lane band (ruler / tempo lane / waveform row). The
 * panel's display row *is* the data lane (`note.lane`, `lanesForSchema`
 * order) — no separate row↔lane mapping.
 */
export function laneAtY(y: number, geo: LaneGeometry): number | null {
  if (geo.laneH <= 0) return null;
  const idx = Math.floor((y - geo.laneTop) / geo.laneH);
  if (idx < 0 || idx >= geo.laneCount) return null;
  return idx;
}

export interface PickContext {
  view: PianoRollView;
  geo: LaneGeometry;
  timedTempos: TimedTempo[];
  resolution: number;
  /** Half-width hit tolerance in px around a glyph center. */
  hitHalfWidth: number;
}

/**
 * The note nearest to `(x, y)` whose glyph the pointer is within, or null.
 * Only notes on the pointer's lane row are considered; among those, the one
 * whose on-screen x is closest (within `hitHalfWidth`) wins.
 */
export function pickNoteAt(
  notes: readonly PianoRollNote[],
  ctx: PickContext,
  x: number,
  y: number,
): PianoRollNote | null {
  const lane = laneAtY(y, ctx.geo);
  if (lane === null) return null;
  let best: PianoRollNote | null = null;
  let bestDx = Infinity;
  for (const note of notes) {
    if (note.lane !== lane) continue;
    const nx = msToX(
      tickToMs(note.tick, ctx.timedTempos, ctx.resolution),
      ctx.view,
    );
    const dx = Math.abs(nx - x);
    if (dx <= ctx.hitHalfWidth && dx < bestDx) {
      best = note;
      bestDx = dx;
    }
  }
  return best;
}

export interface MarqueeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MarqueeBounds {
  msMin: number;
  msMax: number;
  laneMin: number;
  laneMax: number;
}

/**
 * Convert a screen-space marquee rectangle to (ms × lane) bounds for
 * `selectNotesInRange`. The lane range is inclusive and clamped to the lane
 * count; the ms range comes from the view's x-axis. The display row is the
 * data lane (see `laneAtY`), so a top-to-bottom drag yields
 * `laneMin <= laneMax` directly.
 */
export function marqueeBounds(
  rect: MarqueeRect,
  view: PianoRollView,
  geo: LaneGeometry,
): MarqueeBounds {
  const xMin = Math.min(rect.x0, rect.x1);
  const xMax = Math.max(rect.x0, rect.x1);
  const yMin = Math.min(rect.y0, rect.y1);
  const yMax = Math.max(rect.y0, rect.y1);
  const laneFor = (y: number): number => {
    const raw = Math.floor((y - geo.laneTop) / geo.laneH);
    return Math.max(0, Math.min(geo.laneCount - 1, raw));
  };
  return {
    msMin: xToMs(xMin, view),
    msMax: xToMs(xMax, view),
    laneMin: laneFor(yMin),
    laneMax: laneFor(yMax),
  };
}

// ---------------------------------------------------------------------------
// Lyrics row (plan 0063 Part D)
// ---------------------------------------------------------------------------

/** Extra px the lyric-chip pill's hit box extends left/right of its text —
 *  MUST match the `roundRect` padding `drawLyricsRow` paints the pill with
 *  (`x - LYRIC_CHIP_PAD_LEFT`, width `textWidth + LYRIC_CHIP_PAD_LEFT +
 *  LYRIC_CHIP_PAD_RIGHT`), so the hit box is exactly the rendered pill —
 *  not an arbitrary window around the tick x (QA round-2 fix: the old
 *  fixed ±14px window let long syllables render past their hit box, or
 *  shrank the box below a short syllable's glyph). */
export const LYRIC_CHIP_PAD_LEFT = 2;
export const LYRIC_CHIP_PAD_RIGHT = 8;

/** Fallback pill width (px) for a chip whose text hasn't been measured yet
 *  (e.g. the very first frame, before `drawLyricsRow` populates `widths`). */
const DEFAULT_LYRIC_CHIP_WIDTH = 24;

/**
 * The lyric chip whose rendered pill rect contains `x`, or null when none
 * does. `widths` is the per-chip measured text width (px) `drawLyricsRow`
 * records each frame — the SAME width the pill was actually painted at, so
 * hit-testing can never disagree with what's on screen. A flat x-only scan
 * — the row has no vertical lanes, so unlike `pickNoteAt` there's no y
 * filter beyond the caller already having confirmed `y` is inside the row
 * band. When two pills overlap, the one whose center is nearest `x` wins.
 */
export function pickLyricChipAt(
  chips: readonly LyricChip[],
  view: PianoRollView,
  x: number,
  widths: ReadonlyMap<string, number>,
): LyricChip | null {
  let best: LyricChip | null = null;
  let bestDx = Infinity;
  for (const chip of chips) {
    const cx = msToX(chip.ms, view);
    const width = widths.get(chip.id) ?? DEFAULT_LYRIC_CHIP_WIDTH;
    const left = cx - LYRIC_CHIP_PAD_LEFT;
    const right = cx + width + LYRIC_CHIP_PAD_RIGHT;
    if (x < left || x > right) continue;
    const dx = Math.abs(cx - x);
    if (dx < bestDx) {
      best = chip;
      bestDx = dx;
    }
  }
  return best;
}

/** Hit-radius (px) for grabbing a phrase band's start/end edge. */
export const PHRASE_EDGE_HIT_RADIUS = 8;

/** A phrase edge under the pointer: which end, the entity tick that end's
 *  `EntityKind` (`phrase-start`/`phrase-end`) keys off of, and the band's
 *  index in the (tick-sorted) `bands` array — for {@link phraseEdgeDragBounds}. */
export interface PhraseEdgeHit {
  kind: 'phrase-start' | 'phrase-end';
  tick: number;
  bandIndex: number;
}

/**
 * The phrase-band edge (start or end) nearest `x` within `hitRadius`, or
 * null. Checked before a chip/band-body hit so a syllable sitting right at
 * a phrase boundary doesn't steal the resize gesture.
 */
export function pickPhraseEdgeAt(
  bands: readonly LyricBand[],
  view: PianoRollView,
  x: number,
  hitRadius: number = PHRASE_EDGE_HIT_RADIUS,
): PhraseEdgeHit | null {
  let best: PhraseEdgeHit | null = null;
  let bestDx = Infinity;
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i];
    const startX = msToX(band.ms, view);
    const startDx = Math.abs(startX - x);
    if (startDx <= hitRadius && startDx < bestDx) {
      best = {kind: 'phrase-start', tick: band.tick, bandIndex: i};
      bestDx = startDx;
    }
    const endX = msToX(band.msEnd, view);
    const endDx = Math.abs(endX - x);
    if (endDx <= hitRadius && endDx < bestDx) {
      best = {kind: 'phrase-end', tick: band.tickEnd, bandIndex: i};
      bestDx = endDx;
    }
  }
  return best;
}

/** Tick bounds a phrase-edge drag must stay within — mirrors what
 *  `movePhraseStart`/`movePhraseEnd` (`lib/chart-edit/helpers/phrases.ts`)
 *  will actually clamp to, so the live drag ghost never overshoots what the
 *  command commits. Derived purely from the row's tick-sorted `LyricBand`s
 *  (as `buildLyricsRowScene` produces them), so it never needs the raw
 *  phrase array. */
export interface PhraseEdgeBounds {
  min: number;
  max: number;
}

export function phraseEdgeDragBounds(
  bands: readonly LyricBand[],
  bandIndex: number,
  kind: 'phrase-start' | 'phrase-end',
): PhraseEdgeBounds {
  const band = bands[bandIndex];
  if (kind === 'phrase-start') {
    const prev = bands[bandIndex - 1];
    return {min: prev ? prev.tickEnd : 0, max: band.tickEnd - 1};
  }
  const next = bands[bandIndex + 1];
  return {
    min: band.tick + 1,
    max: next ? next.tick : Number.POSITIVE_INFINITY,
  };
}

/**
 * The phrase band (if any) containing `x` in real time — used to resolve a
 * lyrics-row right-click on empty band space (vs. outside every phrase) to
 * "Add lyric…" vs. "Add phrase here".
 */
export function pickPhraseBandAt(
  bands: readonly LyricBand[],
  view: PianoRollView,
  x: number,
): LyricBand | null {
  const ms = xToMs(x, view);
  return bands.find(b => ms >= b.ms && ms <= b.msEnd) ?? null;
}

/**
 * Screen x → tick with NO grid snap (plan 0063 Part D §2: lyric retiming is
 * continuous, unlike a note/section drag). Composes the view's x→ms mapping
 * with the canonical `msToTick` — the same tempo-map conversion every other
 * piano-roll tick read uses — so the only difference from a snapped read is
 * the absence of `snapTickToGrid`.
 */
export function xToTickNoSnap(
  x: number,
  view: PianoRollView,
  timedTempos: TimedTempo[],
  resolution: number,
): number {
  return msToTick(xToMs(x, view), timedTempos, resolution);
}
