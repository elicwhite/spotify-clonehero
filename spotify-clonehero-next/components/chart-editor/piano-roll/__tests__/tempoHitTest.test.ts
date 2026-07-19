/**
 * Pure tempo-lane hit-test / drag-math tests (plan 0062 §7/§8): marker hit
 * radius, min-segment clamp, nearest-beat resolution.
 */

import {
  clampMarkerMs,
  hitTempoMarker,
  nearestBeatTick,
  MIN_SEGMENT_MS,
  TEMPO_MARKER_HIT_RADIUS,
} from '../tempoHitTest';
import type {PianoRollView} from '../viewMath';

const VIEW: PianoRollView = {leftMs: 0, pxPerMs: 0.1}; // 1000ms → 100px

describe('hitTempoMarker', () => {
  // markers at 0ms→0px, 1000ms→100px, 3000ms→300px.
  const markers = [{ms: 0}, {ms: 1000}, {ms: 3000}];

  it('hits the marker under the pointer within the generous radius', () => {
    expect(hitTempoMarker(markers, VIEW, 100)).toBe(1);
    expect(hitTempoMarker(markers, VIEW, 300)).toBe(2);
    // marker 0 is still returned by index — the caller gates draggability on
    // index > 0, not the hit-test.
    expect(hitTempoMarker(markers, VIEW, 2)).toBe(0);
  });

  it('honours the ~10px radius and returns -1 on a miss', () => {
    expect(TEMPO_MARKER_HIT_RADIUS).toBe(10);
    expect(hitTempoMarker(markers, VIEW, 109)).toBe(1); // 9px away
    expect(hitTempoMarker(markers, VIEW, 111)).toBe(-1); // 11px away
  });

  it('picks the nearest marker when two are close', () => {
    const close = [{ms: 1000}, {ms: 1050}]; // 100px, 105px
    expect(hitTempoMarker(close, VIEW, 103)).toBe(1); // closer to 105
    expect(hitTempoMarker(close, VIEW, 101)).toBe(0); // closer to 100
  });
});

describe('clampMarkerMs', () => {
  const markers = [{ms: 0}, {ms: 1000}, {ms: 3000}];

  it('keeps the marker off both neighbours by the min segment', () => {
    // Dragging marker 1 (between 0 and 3000).
    expect(clampMarkerMs(markers, 1, 1500, 10000)).toBe(1500);
    expect(clampMarkerMs(markers, 1, -50, 10000)).toBe(0 + MIN_SEGMENT_MS);
    expect(clampMarkerMs(markers, 1, 5000, 10000)).toBe(3000 - MIN_SEGMENT_MS);
  });

  it('lets the last marker slide out past the song end', () => {
    // marker 2 is last: high bound is totalMs + 60000, not a neighbour.
    expect(clampMarkerMs(markers, 2, 9000, 10000)).toBe(9000);
    expect(clampMarkerMs(markers, 2, 500, 10000)).toBe(1000 + MIN_SEGMENT_MS);
  });
});

describe('nearestBeatTick', () => {
  // beats every 500ms (120 BPM, quarter beats), tick step 480.
  const beats = [
    {tick: 0, ms: 0},
    {tick: 480, ms: 500},
    {tick: 960, ms: 1000},
    {tick: 1440, ms: 1500},
  ];

  it('returns the tick of the beat nearest the pointer ms', () => {
    // x=100px → 1000ms → beat at tick 960.
    expect(nearestBeatTick(beats, VIEW, 100)).toBe(960);
    // x=52px → 520ms → nearest beat is 500ms (tick 480).
    expect(nearestBeatTick(beats, VIEW, 52)).toBe(480);
    // x=3px → 30ms → nearest is tick 0.
    expect(nearestBeatTick(beats, VIEW, 3)).toBe(0);
  });

  it('returns null when there are no beats', () => {
    expect(nearestBeatTick([], VIEW, 100)).toBeNull();
  });
});
