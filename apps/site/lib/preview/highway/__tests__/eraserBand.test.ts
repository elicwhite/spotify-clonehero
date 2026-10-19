/**
 * The eraser's per-lane highlight band (plan 0077 item 2 follow-up).
 *
 * The band used to be derived from a lane X's *position* in a sorted copy of
 * the lane list. That is only equivalent to "this lane's neighbours" while
 * every lane has a distinct X, which stopped being true when 5-lane drums put
 * the middle pad on the kick's center line.
 */

import {eraserBand} from '../SceneOverlays';
import {drums4LaneSchema, drums5LaneSchema} from '@/lib/chart-edit/instruments';
import type {InstrumentSchema} from '@/lib/chart-edit/instruments';

function bandFor(schema: InstrumentSchema, lane: number) {
  const laneXs = schema.lanes
    .slice()
    .sort((a, b) => a.index - b.index)
    .map(l => l.worldXOffset);
  return eraserBand(laneXs[lane], laneXs, schema.highwayWidth / 2);
}

describe('eraserBand', () => {
  it('runs to the highway edge on the outermost lanes', () => {
    const half = drums4LaneSchema.highwayWidth / 2;
    const red = bandFor(drums4LaneSchema, 0);
    const green = bandFor(drums4LaneSchema, 3);

    expect(red.centerX - red.width / 2).toBeCloseTo(-half, 10);
    expect(green.centerX + green.width / 2).toBeCloseTo(half, 10);
  });

  it('meets its neighbours halfway on an interior lane', () => {
    // On 4-lane the kick sits in the gap between yellow and blue, so it is
    // yellow's right-hand neighbour, not blue.
    const yellow = bandFor(drums4LaneSchema, 1);
    const kick = bandFor(drums4LaneSchema, 4);

    expect(yellow.centerX + yellow.width / 2).toBeCloseTo(
      kick.centerX - kick.width / 2,
      10,
    );
  });

  it('gives the 5-lane middle pad a real band despite sharing the kick X', () => {
    // The regression: both lanes sit at X 0, so looking a position up by value
    // found whichever sorted first and produced a band with one bound equal to
    // the lane's own X: a zero-width, invisible highlight.
    const blue = bandFor(drums5LaneSchema, 2);
    expect(blue.width).toBeGreaterThan(0);
    expect(blue.centerX).toBeCloseTo(0, 10);
  });

  it('gives the 5-lane kick the same band its shared pad gets', () => {
    const blue = bandFor(drums5LaneSchema, 2);
    const kick = bandFor(drums5LaneSchema, 5);
    expect(kick.width).toBeCloseTo(blue.width, 10);
    expect(kick.centerX).toBeCloseTo(blue.centerX, 10);
  });

  it('tiles the whole 4-lane highway exactly once', () => {
    // Every lane, kick included, and no double-counting: the widths of five
    // distinct-X lanes add up to the highway.
    const half = drums4LaneSchema.highwayWidth / 2;
    const total = [0, 1, 2, 3, 4]
      .map(lane => bandFor(drums4LaneSchema, lane).width)
      .reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(half * 2, 10);
  });
});
