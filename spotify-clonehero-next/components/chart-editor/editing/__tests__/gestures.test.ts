/**
 * Shared note-drag semantics tests (plan 0062 invariant 3 / §6). One
 * implementation, called by both the highway and the piano roll — these pin
 * the delta-snap, the lane change, and the group clamp that holds a
 * multi-note selection's shape.
 */

import {
  computeNoteDragDelta,
  exceedsDragThreshold,
  DRAG_THRESHOLD_PX,
} from '../gestures';
import {guitarSchema, fullLaneRange, typeToLane} from '@/lib/chart-edit';

/** 4-lane drums: pads 0-3, kick 4. A drag addresses all five. */
const DRUMS = {minLane: 0, maxLane: 4};
/** A single-note drag: the selection's span is just the anchor's lane. */
const solo = (lane: number) => ({
  selectionMinLane: lane,
  selectionMaxLane: lane,
});

// Guitar's full lane range (open included, plan 0067 point 4) — used to
// verify the drag math generalizes off the drum schema.
const {min: GUITAR_MIN, max: GUITAR_MAX} = fullLaneRange(guitarSchema);
const GUITAR_OPEN_LANE = typeToLane(
  guitarSchema,
  guitarSchema.lanes[0].noteType,
);
const GUITAR = {minLane: GUITAR_MIN, maxLane: GUITAR_MAX};

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
      prevLaneDelta: 0,
      ...DRUMS,
      ...solo(1),
    });
    expect(tickDelta).toBe(130);
  });

  it('single-note drag changes lane', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 0, // red
      snappedCursorTick: 0,
      cursorLane: 2, // blue
      prevLaneDelta: 0,
      ...DRUMS,
      ...solo(0),
    });
    expect(laneDelta).toBe(2);
  });

  it('moves a whole selection across lanes by one delta', () => {
    // The feature: a run of blue notes dragged onto yellow. Anchor blue (2)
    // to yellow (1), selection entirely in lane 2.
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 2,
      snappedCursorTick: 0,
      cursorLane: 1,
      prevLaneDelta: 0,
      ...DRUMS,
      selectionMinLane: 2,
      selectionMaxLane: 2,
    });
    expect(laneDelta).toBe(-1);
  });

  it('clamps by the selection span, so the shape survives the edge', () => {
    // Selection spans red(0)..blue(2); anchor red. Dragging the anchor far
    // past the last lane may only shift until blue reaches it — otherwise
    // the three lanes would pile onto one and the intervals would be gone.
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 0,
      snappedCursorTick: 0,
      cursorLane: 99,
      prevLaneDelta: 0,
      ...DRUMS,
      selectionMinLane: 0,
      selectionMaxLane: 2,
    });
    expect(laneDelta).toBe(2); // maxLane(4) - selectionMax(2)
  });

  it('clamps the same way at the low edge', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 3,
      snappedCursorTick: 0,
      cursorLane: -99,
      prevLaneDelta: 0,
      ...DRUMS,
      selectionMinLane: 1,
      selectionMaxLane: 3,
    });
    expect(laneDelta).toBe(-1); // minLane(0) - selectionMin(1)
  });

  it('drags a pad note onto kick', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 3, // green
      snappedCursorTick: 0,
      cursorLane: 4, // kick
      prevLaneDelta: 0,
      ...DRUMS,
      ...solo(3),
    });
    expect(laneDelta).toBe(1);
  });

  it('drags a kick note back onto a pad', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 4, // kick
      snappedCursorTick: 0,
      cursorLane: 1, // yellow
      prevLaneDelta: 0,
      ...DRUMS,
      ...solo(4),
    });
    expect(laneDelta).toBe(-3);
  });

  it('clamps a cursor past the last lane', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 2,
      snappedCursorTick: 0,
      cursorLane: 99,
      prevLaneDelta: 0,
      ...DRUMS,
      ...solo(2),
    });
    expect(laneDelta).toBe(2); // clamps to lane 4 (kick)
  });

  it('keeps the previous lane delta when the cursor resolves no lane', () => {
    const {laneDelta} = computeNoteDragDelta({
      anchorTick: 0,
      anchorLane: 1,
      snappedCursorTick: 0,
      cursorLane: null,
      prevLaneDelta: 2,
      ...DRUMS,
      ...solo(1),
    });
    expect(laneDelta).toBe(2);
  });

  describe('guitarSchema (plan 0067 point 4)', () => {
    it('clamps at the guitar lane boundaries', () => {
      const {laneDelta} = computeNoteDragDelta({
        anchorTick: 0,
        anchorLane: 3,
        snappedCursorTick: 0,
        cursorLane: 99,
        prevLaneDelta: 0,
        ...GUITAR,
        ...solo(3),
      });
      expect(laneDelta).toBe(GUITAR_MAX - 3);
    });

    it('open is a drag target like kick', () => {
      const {laneDelta} = computeNoteDragDelta({
        anchorTick: 0,
        anchorLane: GUITAR_MAX,
        snappedCursorTick: 0,
        cursorLane: GUITAR_OPEN_LANE,
        prevLaneDelta: 0,
        ...GUITAR,
        ...solo(GUITAR_MAX),
      });
      expect(laneDelta).toBe(GUITAR_OPEN_LANE - GUITAR_MAX);
    });
  });
});
