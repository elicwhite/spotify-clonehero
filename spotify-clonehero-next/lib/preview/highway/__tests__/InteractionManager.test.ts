/**
 * Tests for InteractionManager -- schema-driven lane geometry.
 *
 * Plan 0067 point 8: InteractionManager takes the active InstrumentSchema at
 * construction instead of reading `drums4LaneSchema` at module level, so
 * five-fret (and any other) schemas hit-test their own lanes.
 */

import * as THREE from 'three';
import {InteractionManager} from '../InteractionManager';
import {SceneReconciler, type ElementRenderer} from '../SceneReconciler';
import {HIGHWAY_ELEMENT_KINDS} from '../cell';
import {drums4LaneSchema} from '@/lib/chart-edit';
import {guitarSchema} from '@/lib/chart-edit/instruments/guitar';
import {drums5LaneSchema} from '@/lib/chart-edit/instruments/drums';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** No-op renderer -- the reconciler is only used here for its (empty)
 *  active-groups bookkeeping, never asked to actually render anything. */
function noopRenderer(): ElementRenderer {
  return {
    create: () => new THREE.Group(),
    recycle: () => {},
  };
}

/** A reconciler shaped like a highway's: notes and sections only. */
function makeReconciler(): SceneReconciler {
  return new SceneReconciler(
    new THREE.Scene(),
    {note: noopRenderer(), section: noopRenderer()},
    1.5,
    HIGHWAY_ELEMENT_KINDS,
  );
}

/**
 * Same camera setup `lib/preview/highway/index.ts:setupRenderer` uses,
 * translated to `worldX` -- the per-viewport camera a highway root at that
 * slot renders through.
 */
function makeCamera(worldX = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
  camera.position.x = worldX;
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);
  camera.updateMatrixWorld(true);
  return camera;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractionManager -- schema-driven lane geometry', () => {
  it('constructs with drums4LaneSchema (regression) and hit-tests all 5 lanes', () => {
    const im = new InteractionManager(
      makeCamera(),
      makeReconciler(),
      1.5,
      () => 0,
      drums4LaneSchema,
    );

    const canvasW = 1000;
    const canvasH = 1000;
    const canvasY = canvasH / 2;
    const lanesSeen = new Set<number>();
    for (let x = 0; x <= canvasW; x += 5) {
      const hit = im.hitTest(x, canvasY, canvasW, canvasH);
      if (hit && hit.type === 'highway') lanesSeen.add(hit.lane);
    }

    expect(lanesSeen).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it('constructs with guitarSchema and hit-tests all 5 fret lanes', () => {
    const im = new InteractionManager(
      makeCamera(),
      makeReconciler(),
      1.5,
      () => 0,
      guitarSchema,
    );

    const canvasW = 1000;
    const canvasH = 1000;
    const canvasY = canvasH / 2;
    const lanesSeen = new Set<number>();
    for (let x = 0; x <= canvasW; x += 5) {
      const hit = im.hitTest(x, canvasY, canvasW, canvasH);
      if (hit && hit.type === 'highway') lanesSeen.add(hit.lane);
    }

    // Open is a full-width note, not an ordinary nearest-lane target.
    expect(lanesSeen).toEqual(new Set([1, 2, 3, 4, 5]));
  });
});

// ---------------------------------------------------------------------------
// Root-local X correction (plan 0075 §6)
// ---------------------------------------------------------------------------

/**
 * A highway root parked at x = 8 in the shared scene, with its camera
 * translated to match. Every assertion below compares it against the
 * untranslated root: the two must be indistinguishable from pane-local
 * pixels, because the schema's lane offsets and `highwayHalfWidth` are
 * root-local and the ray is not.
 */
const ROOT_WORLD_X = 8;

function makeManagerAt(worldX: number, reconciler = makeReconciler()) {
  return new InteractionManager(
    makeCamera(worldX),
    reconciler,
    1.5,
    () => 0,
    drums4LaneSchema,
    worldX,
  );
}

/** Sweep a horizontal line of pane-local pixels and record what each hits. */
function sweepX(
  im: InteractionManager,
  canvasW: number,
  canvasH: number,
): Array<string | null> {
  const results: Array<string | null> = [];
  for (let x = 0; x <= canvasW; x++) {
    const hit = im.hitTest(x, canvasH / 2, canvasW, canvasH);
    if (!hit) {
      results.push(null);
    } else if (hit.type === 'highway') {
      results.push(`highway:${hit.lane}:${hit.tick}`);
    } else {
      results.push(hit.type);
    }
  }
  return results;
}

describe('InteractionManager -- root-local X correction', () => {
  const canvasW = 600;
  const canvasH = 600;

  it('resolves identical hits from identical pane-local pixels at worldX 0 and 8', () => {
    const atZero = sweepX(makeManagerAt(0), canvasW, canvasH);
    const atEight = sweepX(makeManagerAt(ROOT_WORLD_X), canvasW, canvasH);

    expect(atEight).toEqual(atZero);
    // The sweep has to actually exercise both sides of the bounds check,
    // otherwise "identical" would be vacuously true.
    expect(atZero.some(r => r === null)).toBe(true);
    expect(atZero.some(r => r?.startsWith('highway:'))).toBe(true);
  });

  it('regresses without the correction: an uncorrected manager at worldX 8 hits nothing', () => {
    // Same translated camera, but `rootWorldX` left at its default. This is
    // the pre-fix behaviour, pinned so the correction cannot be quietly
    // dropped: every highway-plane hit lands ~8 world units off-center and
    // fails `Math.abs(localX) > highwayHalfWidth`.
    const uncorrected = new InteractionManager(
      makeCamera(ROOT_WORLD_X),
      makeReconciler(),
      1.5,
      () => 0,
      drums4LaneSchema,
    );
    const results = sweepX(uncorrected, canvasW, canvasH);
    expect(results.every(r => r === null)).toBe(true);
  });

  it('agrees on the in-bounds pixel band and its edges', () => {
    const atZero = sweepX(makeManagerAt(0), canvasW, canvasH);
    const atEight = sweepX(makeManagerAt(ROOT_WORLD_X), canvasW, canvasH);

    const firstIn = atZero.findIndex(r => r !== null);
    const lastIn =
      atZero.length - 1 - [...atZero].reverse().findIndex(r => r !== null);

    expect(firstIn).toBeGreaterThan(0);
    expect(lastIn).toBeLessThan(atZero.length - 1);

    // Right edge in bounds for both; one pixel past it out of bounds for both.
    expect(atEight[lastIn]).not.toBeNull();
    expect(atZero[lastIn + 1]).toBeNull();
    expect(atEight[lastIn + 1]).toBeNull();
    expect(atEight[firstIn]).not.toBeNull();
    expect(atZero[firstIn - 1]).toBeNull();
    expect(atEight[firstIn - 1]).toBeNull();
  });

  it('returns identical screenToLane / screenToMs / screenToTick at worldX 0 and 8', () => {
    const zero = makeManagerAt(0);
    const eight = makeManagerAt(ROOT_WORLD_X);
    const timing = [{tick: 0, msTime: 0, beatsPerMinute: 120}];
    zero.setTimingData(timing, 192);
    eight.setTimingData(timing, 192);

    for (let x = 0; x <= canvasW; x += 10) {
      for (let y = 100; y <= canvasH - 100; y += 100) {
        expect(eight.screenToLane(x, y, canvasW, canvasH)).toBe(
          zero.screenToLane(x, y, canvasW, canvasH),
        );
        expect(eight.screenToMs(x, y, canvasW, canvasH)).toBeCloseTo(
          zero.screenToMs(x, y, canvasW, canvasH),
          9,
        );
        expect(eight.screenToTick(x, y, canvasW, canvasH, 4)).toBe(
          zero.screenToTick(x, y, canvasW, canvasH, 4),
        );
      }
    }
  });
});

describe('InteractionManager -- marker line projected.y invariant', () => {
  const canvasW = 600;
  const canvasH = 600;

  /**
   * A reconciler holding one active section marker at a known ms, so
   * `hitTestMarkerLines` has a group to project.
   */
  function makeSectionReconciler(): SceneReconciler {
    const reconciler = new SceneReconciler(
      new THREE.Group(),
      {note: noopRenderer(), section: noopRenderer()},
      1.5,
      HIGHWAY_ELEMENT_KINDS,
    );
    reconciler.setElements([
      {
        key: 'section:480',
        kind: 'section',
        msTime: 500,
        data: {text: 'Verse'},
      },
    ]);
    reconciler.updateWindow(0);
    return reconciler;
  }

  function sectionRows(im: InteractionManager): number[] {
    const rows: number[] = [];
    for (let y = 0; y <= canvasH; y++) {
      const hit = im.hitTest(canvasW / 2, y, canvasW, canvasH);
      if (hit && hit.type === 'section') rows.push(y);
    }
    return rows;
  }

  it('projects the marker rule line to the same screen rows at worldX 0 and 8', () => {
    // `hitTestMarkerLines` probes `(rootWorldX, y, 0)`. A per-viewport camera
    // has no yaw, so `projected.y` is independent of X and the two roots must
    // agree exactly. This is the invariant a shared, off-axis camera would
    // silently break.
    const timing = [{tick: 0, msTime: 0, beatsPerMinute: 120}];

    const zero = makeManagerAt(0, makeSectionReconciler());
    zero.setTimingData(timing, 192);
    const eight = makeManagerAt(ROOT_WORLD_X, makeSectionReconciler());
    eight.setTimingData(timing, 192);

    const zeroRows = sectionRows(zero);
    const eightRows = sectionRows(eight);

    expect(zeroRows.length).toBeGreaterThan(0);
    expect(eightRows).toEqual(zeroRows);
  });
});

// ---------------------------------------------------------------------------
// Pad-vs-kick ties on 5-lane drums (plan 0077 item 2)
// ---------------------------------------------------------------------------

describe('InteractionManager -- 5-lane drums pad/kick tie', () => {
  const canvasW = 1000;
  const canvasH = 1000;

  function lanesAcross(schema: typeof drums5LaneSchema): Set<number> {
    const im = new InteractionManager(
      makeCamera(),
      makeReconciler(),
      1.5,
      () => 0,
      schema,
    );
    const seen = new Set<number>();
    for (let x = 0; x <= canvasW; x++) {
      const hit = im.hitTest(x, canvasH / 2, canvasW, canvasH);
      if (hit && hit.type === 'highway') seen.add(hit.lane);
    }
    return seen;
  }

  it('reaches all five pads', () => {
    // Five pads spread symmetrically put the middle one on the highway's
    // center line, which is also the kick's X. The kick used to win that tie
    // by being earlier in the schema, making the middle pad unreachable by
    // pointer on every 5-lane chart.
    const seen = lanesAcross(drums5LaneSchema);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it('still reaches the kick on 4-lane, where it owns the center gap', () => {
    const seen = lanesAcross(drums4LaneSchema);
    expect(seen.has(4)).toBe(true);
  });

  it('resolves the exact center pixel to the middle pad, not the kick', () => {
    const im = new InteractionManager(
      makeCamera(),
      makeReconciler(),
      1.5,
      () => 0,
      drums5LaneSchema,
    );
    expect(im.screenToLane(canvasW / 2, canvasH / 2, canvasW, canvasH)).toBe(2);
  });
});
