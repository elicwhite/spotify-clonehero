/**
 * Invariants every `InstrumentSchema`'s lane geometry has to hold, and the one
 * documented exception.
 *
 * `worldXOffset` became the single spelling of a lane's X (plan 0077 item 2),
 * which put the renderer, the strikeline and the hit-test on the same numbers
 * and made a duplicate X a real defect rather than a cosmetic one: the
 * nearest-lane hit-test resolves ties by candidate order, and the eraser band
 * is derived from the gaps between lane Xs.
 */

import {bassSchema, guitarSchema, keysSchema, rhythmSchema} from '../guitar';
import {drums4LaneSchema, drums5LaneSchema} from '../drums';
import type {InstrumentSchema} from '../types';

const SCHEMAS: Array<[string, InstrumentSchema]> = [
  ['drums 4-lane', drums4LaneSchema],
  ['drums 5-lane', drums5LaneSchema],
  ['guitar', guitarSchema],
  ['bass', bassSchema],
  ['rhythm', rhythmSchema],
  ['keys', keysSchema],
];

describe.each(SCHEMAS)('%s lane geometry', (_name, schema) => {
  it('numbers lanes by their position in the array', () => {
    // Editor lane numbers are array positions in several places
    // (`SceneOverlays`' per-lane X and colour arrays, `laneAt`), so a lane
    // whose `index` disagreed with where it sits would read a neighbour's
    // geometry. The 5-lane kick is the one that used to: it reused the
    // 4-lane kick's `index: 4`, which is the 5-lane green's slot.
    expect(schema.lanes.map(lane => lane.index)).toEqual(
      schema.lanes.map((_lane, i) => i),
    );
  });

  it('gives every pad lane its own X', () => {
    const padXs = schema.lanes
      .filter(lane => !lane.fullWidth)
      .map(lane => lane.worldXOffset);
    expect(new Set(padXs).size).toBe(padXs.length);
  });

  it('keeps every lane inside the highway', () => {
    const halfWidth = schema.highwayWidth / 2;
    for (const lane of schema.lanes) {
      expect(Math.abs(lane.worldXOffset)).toBeLessThanOrEqual(halfWidth);
    }
  });
});

describe('drum pad spacing', () => {
  /** Width of the fret sprite drawn at each pad center on the strikeline:
   *  `FRET_SPRITE_HEIGHT * aspectRatio` in `HighwayScene.ts`. */
  const FRET_SPRITE_WIDTH = (96 / 975) * 2;
  /** Horizontal fraction of that sprite box the authored `cover` ring
   *  actually covers, measured from the alpha channel of
   *  `public/assets/preview/assets2/frets/*-cover.webp` (opaque columns
   *  4..186 of 192). The sprite box is what the art is drawn into; this is
   *  what a player sees. */
  const RING_FRACTION_OF_SPRITE = 183 / 192;
  const FRET_RING_WIDTH = FRET_SPRITE_WIDTH * RING_FRACTION_OF_SPRITE;

  function padXs(schema: InstrumentSchema): number[] {
    return schema.lanes
      .filter(lane => !lane.fullWidth)
      .sort((a, b) => a.index - b.index)
      .map(lane => lane.worldXOffset);
  }

  it('spaces the four 4-lane pads wider apart than the fret sprite', () => {
    // A step narrower than the sprite box overlaps adjacent buttons and the
    // strikeline reads as one scrunched blob.
    const xs = padXs(drums4LaneSchema);
    expect(xs).toHaveLength(4);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThan(FRET_SPRITE_WIDTH);
    }
  });

  it('keeps the 4-lane pad step near 1.09 visible ring widths', () => {
    // The reference highway's ratio. Pinned because the usable range is
    // narrow -- below one sprite box (1.05 ring widths) the buttons overlap,
    // and much above this they read as four islands rather than a strikeline.
    const xs = padXs(drums4LaneSchema);
    const step = xs[1] - xs[0];
    expect(step / FRET_RING_WIDTH).toBeGreaterThan(1.07);
    expect(step / FRET_RING_WIDTH).toBeLessThan(1.11);
  });

  it('centers the pad strip on the highway in both drum layouts', () => {
    for (const schema of [drums4LaneSchema, drums5LaneSchema]) {
      const xs = padXs(schema);
      expect(xs[0] + xs[xs.length - 1]).toBeCloseTo(0, 10);
    }
  });
});

describe('the 5-lane kick / middle-pad collision', () => {
  const kick = drums5LaneSchema.lanes.find(lane => lane.fullWidth)!;
  const middlePad = drums5LaneSchema.lanes.find(
    lane => !lane.fullWidth && lane.label === 'Blue',
  )!;

  it('is real, and is the reason the hit-test breaks pad-vs-kick ties', () => {
    // An odd number of pads spread symmetrically has one on the center line,
    // which is where the kick's hover ghost and its pointer target sit. The
    // geometry is correct (Clone Hero draws 5-lane drums this way); what has
    // to give is the tie, and it gives to the pad. See `worldXToLane` in
    // `InteractionManager.ts`, pinned in `InteractionManager.test.ts`.
    expect(kick.worldXOffset).toBe(0);
    expect(middlePad.worldXOffset).toBe(0);
  });

  it('does not exist in the 4-lane layout, where the kick owns the gap', () => {
    const kick4 = drums4LaneSchema.lanes.find(lane => lane.fullWidth)!;
    const padXs4 = drums4LaneSchema.lanes
      .filter(lane => !lane.fullWidth)
      .map(lane => lane.worldXOffset);
    expect(padXs4).not.toContain(kick4.worldXOffset);
  });
});
