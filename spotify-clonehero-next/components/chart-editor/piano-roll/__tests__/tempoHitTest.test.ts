/**
 * Pure tempo-lane hit-test / drag-math tests (plan 0062 §7/§8): marker hit
 * radius, min-segment clamp, nearest-beat resolution.
 */

import {
  clampMarkerMs,
  hitTempoMarker,
  hitTsChip,
  tsChipRect,
  nearestBeatTick,
  MIN_SEGMENT_MS,
  TEMPO_MARKER_HIT_RADIUS,
  hitSongStartFlag,
  SONG_START_PENNANT_TOP,
  SONG_START_PENNANT_H,
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

describe('hitTsChip', () => {
  // Chips at 0ms→0px and 2000ms→200px, both labelled "4/4" (20px wide).
  const chips = [
    {tick: 0, ms: 0, label: '4/4'},
    {tick: 1920, ms: 2000, label: '7/8'},
  ];
  const widths = new Map<number, number>([
    [0, 20],
    [1920, 20],
  ]);

  it('hits the pill the lane painted, and only there', () => {
    // The pill runs from tick x + 3 to tick x + 3 + 20 + 8.
    expect(hitTsChip(chips, VIEW, 205, widths)).toBe(1);
    expect(hitTsChip(chips, VIEW, 231, widths)).toBe(1);
    expect(hitTsChip(chips, VIEW, 233, widths)).toBe(-1);
  });

  it('includes a little grab room left of the signature tick', () => {
    expect(hitTsChip(chips, VIEW, 199, widths)).toBe(1);
    expect(hitTsChip(chips, VIEW, 190, widths)).toBe(-1);
  });

  it('never hits a position with no chip, however close to a bar line', () => {
    // A plain bar line halfway between the two signatures carries no chip.
    expect(hitTsChip(chips, VIEW, 100, widths)).toBe(-1);
    expect(hitTsChip(chips, VIEW, 400, widths)).toBe(-1);
  });

  it('never hits the chart initial meter at tick 0', () => {
    // x 3..31 covers the tick-0 pill, but it is not an actionable marker.
    expect(hitTsChip(chips, VIEW, 5, widths)).toBe(-1);
    expect(hitTsChip(chips, VIEW, 25, widths)).toBe(-1);
  });

  it('acts on a first authored event that is not at tick 0', () => {
    const late = [{tick: 1920, ms: 2000, label: '7/8'}];
    expect(hitTsChip(late, VIEW, 205, widths)).toBe(0);
  });

  it('reads the same rect the renderer paints', () => {
    const rect = tsChipRect(chips[1].ms, VIEW, widths.get(1920)!);
    expect(hitTsChip(chips, VIEW, rect.left, widths)).toBe(1);
    expect(hitTsChip(chips, VIEW, rect.right, widths)).toBe(1);
    expect(hitTsChip(chips, VIEW, rect.right + 1, widths)).toBe(-1);
  });
});

describe('hitSongStartFlag', () => {
  // The flag at 1000ms → 100px.
  const MS = 1000;
  const IN = SONG_START_PENNANT_TOP;
  const BELOW = SONG_START_PENNANT_TOP + SONG_START_PENNANT_H;

  it('answers in the pennant strip', () => {
    expect(hitSongStartFlag(MS, VIEW, 100, IN)).toBe(true);
    expect(hitSongStartFlag(MS, VIEW, 100, BELOW - 1)).toBe(true);
  });

  it('leaves the rest of the lane to the marker it sits on', () => {
    // `recordSongStart` snaps the song start ONTO a tempo or signature
    // marker, so sharing a tick is the normal case. A flag that answered the
    // lane's full height would take the pointerdown first and the marker
    // underneath could never be dragged again.
    expect(hitSongStartFlag(MS, VIEW, 100, BELOW)).toBe(false);
    expect(hitSongStartFlag(MS, VIEW, 100, SONG_START_PENNANT_TOP - 1)).toBe(
      false,
    );
  });

  it('does not claim the boundary pixel a marker also wants', () => {
    // `<`, matching `hitTempoMarker`, so one pixel belongs to one thing.
    const edge = 100 + TEMPO_MARKER_HIT_RADIUS;
    expect(hitSongStartFlag(MS, VIEW, edge, IN)).toBe(false);
    expect(hitSongStartFlag(MS, VIEW, edge - 1, IN)).toBe(true);
  });

  it('is never hit when there is no song start', () => {
    expect(hitSongStartFlag(null, VIEW, 100, IN)).toBe(false);
  });
});
