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

const PADS = {minPadLane: 1, maxPadLane: 4};

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
      anchorLane: 1, // red
      snappedCursorTick: 0,
      cursorLane: 3, // blue
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(laneDelta).toBe(2);
  });

  it('multi-note selection locks lanes (time-only move)', () => {
    const {tickDelta, laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 1,
      snappedCursorTick: 240,
      cursorLane: 4,
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
      anchorLane: 0, // kick
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
      cursorLane: 99, // out of range → clamps to maxPadLane (4)
      selectionSize: 1,
      prevLaneDelta: 0,
      ...PADS,
    });
    expect(laneDelta).toBe(2); // 4 - 2
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
});
