/**
 * Tests for InteractionManager -- schema-driven lane geometry.
 *
 * Plan 0067 point 8: InteractionManager takes the active InstrumentSchema at
 * construction instead of reading `drums4LaneSchema` at module level, so
 * five-fret (and any other) schemas can hit-test their own lanes instead of
 * throwing for missing `worldXOffset`.
 */

import * as THREE from 'three';
import {InteractionManager} from '../InteractionManager';
import {SceneReconciler, type ElementRenderer} from '../SceneReconciler';
import {drums4LaneSchema} from '@/lib/chart-edit';
import {guitarSchema} from '@/lib/chart-edit/instruments/guitar';

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

function makeReconciler(): SceneReconciler {
  return new SceneReconciler(
    new THREE.Scene(),
    {
      note: noopRenderer(),
      section: noopRenderer(),
      lyric: noopRenderer(),
      'phrase-start': noopRenderer(),
      'phrase-end': noopRenderer(),
      bpm: noopRenderer(),
      ts: noopRenderer(),
    },
    1.5,
  );
}

/** Same camera setup `lib/preview/highway/index.ts:setupRenderer` uses. */
function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
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

  it('constructs with guitarSchema (no worldXOffset throw) and hit-tests all 6 lanes', () => {
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

    // guitarSchema.lanes = [open, green, red, yellow, blue, orange] -- 6 lanes.
    expect(lanesSeen).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it('throws when a schema lane is missing worldXOffset', () => {
    const brokenSchema = {
      ...guitarSchema,
      lanes: guitarSchema.lanes.map(l => {
        const {worldXOffset: _worldXOffset, ...rest} = l;
        return rest;
      }),
    };

    expect(
      () =>
        new InteractionManager(
          makeCamera(),
          makeReconciler(),
          1.5,
          () => 0,
          brokenSchema,
        ),
    ).toThrow(/missing worldXOffset/);
  });
});
