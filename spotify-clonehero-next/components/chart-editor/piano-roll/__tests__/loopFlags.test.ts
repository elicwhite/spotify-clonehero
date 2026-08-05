import {MIN_LOOP_SPAN_MS} from '@/lib/preview/loopRegion';
import {
  DEFAULT_LOOP_SPAN_MS,
  isInsideLoopShade,
  loopEndRegionAt,
  loopFlagXs,
  loopStartRegionAt,
  moveLoopEdge,
  pickLoopFlagAt,
} from '../loopFlags';
import type {PianoRollView} from '../viewMath';

// 1px per ms, left edge at 0ms — screen x equals ms, so the expectations
// below read directly as milliseconds.
const view: PianoRollView = {leftMs: 0, pxPerMs: 1};
const region = {startMs: 1000, endMs: 3000};

describe('loopFlagXs', () => {
  it('maps both edges through the view transform', () => {
    expect(loopFlagXs(region, {leftMs: 500, pxPerMs: 0.5})).toEqual({
      startX: 250,
      endX: 1250,
    });
  });
});

describe('pickLoopFlagAt', () => {
  it('grabs the start flag within the hit radius', () => {
    expect(pickLoopFlagAt(region, view, 1004)).toBe('loop-start');
  });

  it('grabs the end flag within the hit radius', () => {
    expect(pickLoopFlagAt(region, view, 2996)).toBe('loop-end');
  });

  it('misses between the flags and outside the region', () => {
    expect(pickLoopFlagAt(region, view, 2000)).toBeNull();
    expect(pickLoopFlagAt(region, view, 500)).toBeNull();
  });

  it('resolves an overlap to the start flag', () => {
    // Zoomed far out: both edges land within one hit radius of the pointer.
    const zoomedOut: PianoRollView = {leftMs: 0, pxPerMs: 0.001};
    expect(pickLoopFlagAt(region, zoomedOut, 2)).toBe('loop-start');
  });

  it('returns null with no loop set', () => {
    expect(pickLoopFlagAt(null, view, 1000)).toBeNull();
  });
});

describe('isInsideLoopShade', () => {
  it('covers the span between the edges, inclusive', () => {
    expect(isInsideLoopShade(region, view, 1000)).toBe(true);
    expect(isInsideLoopShade(region, view, 2000)).toBe(true);
    expect(isInsideLoopShade(region, view, 3000)).toBe(true);
  });

  it('excludes points outside the span', () => {
    expect(isInsideLoopShade(region, view, 999)).toBe(false);
    expect(isInsideLoopShade(region, view, 3001)).toBe(false);
  });

  it('returns false with no loop set', () => {
    expect(isInsideLoopShade(null, view, 2000)).toBe(false);
  });
});

describe('moveLoopEdge', () => {
  it('moves the start edge', () => {
    expect(moveLoopEdge(region, 'loop-start', 1500)).toEqual({
      startMs: 1500,
      endMs: 3000,
    });
  });

  it('moves the end edge', () => {
    expect(moveLoopEdge(region, 'loop-end', 5000)).toEqual({
      startMs: 1000,
      endMs: 5000,
    });
  });

  it('clamps a start dragged past the end instead of swapping', () => {
    expect(moveLoopEdge(region, 'loop-start', 9000)).toEqual({
      startMs: 3000 - MIN_LOOP_SPAN_MS,
      endMs: 3000,
    });
  });

  it('clamps an end dragged past the start instead of swapping', () => {
    expect(moveLoopEdge(region, 'loop-end', 0)).toEqual({
      startMs: 1000,
      endMs: 1000 + MIN_LOOP_SPAN_MS,
    });
  });

  it('never lets the start go negative', () => {
    expect(moveLoopEdge(region, 'loop-start', -500).startMs).toBe(0);
  });

  it('keeps the start at zero when the end is inside the minimum span', () => {
    expect(moveLoopEdge({startMs: 0, endMs: 50}, 'loop-start', 40)).toEqual({
      startMs: 0,
      endMs: 50,
    });
  });
});

describe('loopStartRegionAt', () => {
  it('places a default-span end marker when there is no existing region', () => {
    expect(loopStartRegionAt(1000, null)).toEqual({
      startMs: 1000,
      endMs: 1000 + DEFAULT_LOOP_SPAN_MS,
    });
  });

  it('keeps an existing region end', () => {
    expect(loopStartRegionAt(1000, {startMs: 4000, endMs: 9000})).toEqual({
      startMs: 1000,
      endMs: 9000,
    });
  });

  it('clamps the kept end forward when the new start would leave too little span', () => {
    expect(loopStartRegionAt(8500, {startMs: 0, endMs: 8550})).toEqual({
      startMs: 8500,
      endMs: 8500 + MIN_LOOP_SPAN_MS,
    });
  });

  it('never places the start below zero', () => {
    expect(loopStartRegionAt(-200, null).startMs).toBe(0);
  });
});

describe('loopEndRegionAt', () => {
  it('places a default-span start marker when there is no existing region', () => {
    expect(loopEndRegionAt(9000, null)).toEqual({
      startMs: 9000 - DEFAULT_LOOP_SPAN_MS,
      endMs: 9000,
    });
  });

  it('keeps an existing region start', () => {
    expect(loopEndRegionAt(9000, {startMs: 4000, endMs: 1000})).toEqual({
      startMs: 4000,
      endMs: 9000,
    });
  });

  it('clamps the kept start backward when the new end would leave too little span', () => {
    expect(loopEndRegionAt(500, {startMs: 4000, endMs: 9000})).toEqual({
      startMs: 500 - MIN_LOOP_SPAN_MS,
      endMs: 500,
    });
  });

  it('never places the end below the minimum span', () => {
    expect(loopEndRegionAt(10, null)).toEqual({
      startMs: 0,
      endMs: MIN_LOOP_SPAN_MS,
    });
  });

  it('never places a kept start below zero', () => {
    expect(
      loopEndRegionAt(100, {startMs: -50, endMs: 200}).startMs,
    ).toBeGreaterThanOrEqual(0);
  });
});
