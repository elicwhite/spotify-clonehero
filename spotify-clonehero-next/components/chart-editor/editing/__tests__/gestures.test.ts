/**
 * Shared note-drag semantics tests (plan 0062 invariant 3 / §6). One
 * implementation, called by both the highway and the piano roll — these
 * pin the delta-snap, single-note lane change, and multi-note lane lock.
 */

import {
  computeNoteDragDelta,
  exceedsDragThreshold,
  DRAG_THRESHOLD_PX,
} from '../gestures';
import {guitarSchema, padLaneRange, typeToLane} from '@/lib/chart-edit';

const PADS = {minPadLane: 0, maxPadLane: 3, excludedLane: 4};

// Guitar's pad range/excluded lane (open, plan 0067 point 4) — used to
// verify the piano-roll drag math generalizes off the drum schema.
const {min: GUITAR_MIN_PAD, max: GUITAR_MAX_PAD} = padLaneRange(guitarSchema);
const GUITAR_OPEN_LANE = typeToLane(
  guitarSchema,
  guitarSchema.lanes[0].noteType,
);
const GUITAR_PADS = {
  minPadLane: GUITAR_MIN_PAD,
  maxPadLane: GUITAR_MAX_PAD,
  excludedLane: GUITAR_OPEN_LANE,
};

describe('exceedsDragThreshold', () => {
  it('is false at/under the threshold and true past it', () => {
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, DRAG_THRESHOLD_PX)).toBe(
      false,
    );
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    expect(exceedsDragThreshold(0, -(DRAG_THRESHOLD_PX + 1))).toBe(true);
  });
});

describe('computeNoteDragDelta', () => {
  it('delta-snaps the tick offset (anchor snaps, offsets preserved)', () => {
    // Grabbed note at tick 470 (off-grid); cursor snapped to 600. The offset
    // applied to every selected note is +130, so an off-grid neighbour keeps
    // its relative position.
    const {tickDelta} = computeNoteDragDelta({
      anchorTick: 470,
      anchorLane: 1,
      snappedCursorTick: 600,
      cursorLane: 1,
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(tickDelta).toBe(130);
  });

  it('single-note drag changes lane', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 0, // red
      snappedCursorTick: 0,
      cursorLane: 2, // blue
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(laneDelta).toBe(2);
  });

  it('multi-note selection locks lanes (time-only move)', () => {
    const {tickDelta, laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 0,
      snappedCursorTick: 240,
      cursorLane: 3,
      selectionSize: 3,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(tickDelta).toBe(240);
    expect(laneDelta).toBe(0);
  });

  it('a kick anchor never changes lane', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 4, // kick
      snappedCursorTick: 0,
      cursorLane: 3,
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(laneDelta).toBe(0);
  });

  it('clamps pad lanes to the valid range', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 2,
      snappedCursorTick: 0,
      cursorLane: 99, // out of range → clamps to maxPadLane (3)
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(laneDelta).toBe(1); // 3 - 2
  });

  it('keeps the previous lane delta while off the pad lanes', () => {
    // cursorLane null (e.g. over the kick strip) → hold the last lane delta.
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 1,
      snappedCursorTick: 0,
      cursorLane: null,
      selectionSize: 1,
      prevLaneDelta: 2,
      ...PADS,
    });
    expect(laneDelta).toBe(2);
  });

  describe('guitarSchema pad range (plan 0067 point 4)', () => {
    it('clamps at the guitar pad-lane boundaries', () => {
      const {laneDelta} = computeNoteDragDelta({
        anchorTick: 0,
        anchorLane: 3, // yellow
        snappedCursorTick: 0,
        cursorLane: 99, // out of range → clamps to maxPadLane (orange, 5)
        selectionSize: 1,
        prevLaneDelta: 0,
        ...GUITAR_PADS,
      });
      expect(laneDelta).toBe(2); // 5 - 3
    });

    it('open behaves like kick: an open anchor never changes lane', () => {
      const {laneDelta} = computeNoteDragDelta({
        anchorTick: 0,
        anchorLane: GUITAR_OPEN_LANE,
        snappedCursorTick: 0,
        cursorLane: GUITAR_MAX_PAD,
        selectionSize: 1,
        prevLaneDelta: 0,
        ...GUITAR_PADS,
      });
      expect(laneDelta).toBe(0);
    });
  });
});
