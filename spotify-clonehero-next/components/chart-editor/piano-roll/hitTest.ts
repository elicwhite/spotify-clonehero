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

import {tickToMs} from '@/lib/drum-transcription/timing';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import {msToX, xToMs, type PianoRollView} from './viewMath';
import {LANE_COUNT, type PianoRollNote} from './notes';

/** Vertical layout of the note-lane band inside the panel canvas. */
export interface LaneGeometry {
  /** Top y (px) of the first note lane. */
  laneTop: number;
  /** Height (px) of one lane row. */
  laneH: number;
}

/**
 * Editor lane row (0..LANE_COUNT-1) under a y pixel, or null when the point
 * is outside the note-lane band (ruler / tempo lane / waveform row).
 */
export function laneAtY(y: number, geo: LaneGeometry): number | null {
  if (geo.laneH <= 0) return null;
  const idx = Math.floor((y - geo.laneTop) / geo.laneH);
  if (idx < 0 || idx >= LANE_COUNT) return null;
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
 * count; the ms range comes from the view's x-axis. Lanes increase downward
 * on the piano roll (kick on top), so a top-to-bottom drag yields
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
    return Math.max(0, Math.min(LANE_COUNT - 1, raw));
  };
  return {
    msMin: xToMs(xMin, view),
    msMax: xToMs(xMax, view),
    laneMin: laneFor(yMin),
    laneMax: laneFor(yMax),
  };
}
