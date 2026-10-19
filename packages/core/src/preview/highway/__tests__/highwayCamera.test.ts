/**
 * The camera every highway renders through (`highwayCamera.ts`): built from
 * `HIGHWAY_CAMERA`, and fitted to a viewport the way `cameraFit.ts` works it
 * out, so the strikeline lands where the fit says and the whole highway
 * stays inside a narrow viewport.
 */

import * as THREE from 'three';
import {
  HIGHWAY_CAMERA,
  STRIKELINE_WORLD_Y,
  strikelineInCameraSpace,
} from '../cameraFit';
import {createHighwayCamera, fitHighwayCamera} from '../highwayCamera';

/** NDC of the floor point (x, y) through `camera`. */
function ndcOf(
  camera: THREE.PerspectiveCamera,
  x: number,
  y: number,
): THREE.Vector3 {
  camera.updateMatrixWorld();
  return new THREE.Vector3(x, y, 0).project(camera);
}

const WIDE = {width: 1600, height: 900};
const NARROW = {width: 200, height: 900};
const GUITAR_HALF_WIDTH = 0.55;

describe('createHighwayCamera', () => {
  it('sits where HIGHWAY_CAMERA puts it, at the given world X', () => {
    const camera = createHighwayCamera(8);
    expect(camera.position.toArray()).toEqual([
      8,
      HIGHWAY_CAMERA.y,
      HIGHWAY_CAMERA.z,
    ]);
    expect(camera.rotation.x).toBeCloseTo(
      THREE.MathUtils.degToRad(HIGHWAY_CAMERA.pitchDeg),
    );
    expect(camera.fov).toBe(HIGHWAY_CAMERA.fovDeg);
  });
});

describe('fitHighwayCamera', () => {
  it('keeps the base camera in a wide viewport, the strikeline where cameraFit puts it', () => {
    const camera = createHighwayCamera();
    fitHighwayCamera(camera, WIDE, GUITAR_HALF_WIDTH);
    expect(camera.aspect).toBeCloseTo(WIDE.width / WIDE.height);
    expect(camera.fov).toBe(HIGHWAY_CAMERA.fovDeg);
    expect(camera.view?.enabled ?? false).toBe(false);

    const {depth, viewY} = strikelineInCameraSpace();
    const tan = Math.tan(THREE.MathUtils.degToRad(HIGHWAY_CAMERA.fovDeg / 2));
    const strikeline = ndcOf(camera, 0, STRIKELINE_WORLD_Y);
    expect(strikeline.x).toBeCloseTo(0, 9);
    expect(strikeline.y).toBeCloseTo(viewY / (depth * tan), 9);
  });

  it('widens a narrow viewport: the highway inside, the strikeline where a wide one has it', () => {
    const wide = createHighwayCamera();
    fitHighwayCamera(wide, WIDE, GUITAR_HALF_WIDTH);
    const narrow = createHighwayCamera();
    fitHighwayCamera(narrow, NARROW, GUITAR_HALF_WIDTH);

    expect(narrow.fov).toBeGreaterThan(HIGHWAY_CAMERA.fovDeg);
    expect(narrow.view?.enabled).toBe(true);
    expect(ndcOf(narrow, 0, STRIKELINE_WORLD_Y).y).toBeCloseTo(
      ndcOf(wide, 0, STRIKELINE_WORLD_Y).y,
      9,
    );
    const edge = ndcOf(narrow, GUITAR_HALF_WIDTH, STRIKELINE_WORLD_Y);
    expect(Math.abs(edge.x)).toBeLessThan(1);
  });

  it('drops the shift when refitted to a wide viewport', () => {
    const camera = createHighwayCamera();
    fitHighwayCamera(camera, NARROW, GUITAR_HALF_WIDTH);
    fitHighwayCamera(camera, WIDE, GUITAR_HALF_WIDTH);
    expect(camera.fov).toBe(HIGHWAY_CAMERA.fovDeg);
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});
