// ---------------------------------------------------------------------------
// highwayCamera -- the THREE camera that renders one highway
// ---------------------------------------------------------------------------
//
// `cameraFit.ts` works out the fit as pure numbers; this builds and fits the
// camera from them. The stage gives every highway one of these, and code
// outside the stage that has to know where the stage draws something (the
// video kit's overlays) builds the same camera instead of a copy of it.

import * as THREE from 'three';
import {computeHighwayCameraFit, HIGHWAY_CAMERA} from './cameraFit';

/**
 * A highway camera at world X `worldX`: `HIGHWAY_CAMERA`'s field of view,
 * position and pitch, square until `fitHighwayCamera` gives it a viewport.
 */
export function createHighwayCamera(worldX = 0): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(
    HIGHWAY_CAMERA.fovDeg,
    1 / 1,
    0.01,
    10,
  );
  camera.position.x = worldX;
  camera.position.z = HIGHWAY_CAMERA.z;
  camera.position.y = HIGHWAY_CAMERA.y;
  camera.rotation.x = THREE.MathUtils.degToRad(HIGHWAY_CAMERA.pitchDeg);
  return camera;
}

/**
 * Fit `camera` to a viewport of `width` x `height`: its aspect, and the fit
 * that keeps a highway `halfWidth` wide (world units) inside it.
 *
 * `setViewOffset` overwrites `camera.aspect` with `fullWidth / fullHeight`,
 * so the virtual frame is sized `aspect * 2` by `2`: it restates the aspect
 * unchanged, and its 2-unit height makes `offsetY` read directly in NDC.
 */
export function fitHighwayCamera(
  camera: THREE.PerspectiveCamera,
  viewport: {width: number; height: number},
  halfWidth: number,
): void {
  const aspect = viewport.width / viewport.height;
  const fit = computeHighwayCameraFit({aspect, halfWidth});
  camera.aspect = aspect;
  camera.fov = fit.fovDeg;
  if (fit.ndcShiftY !== 0) {
    camera.setViewOffset(aspect * 2, 2, 0, fit.ndcShiftY, aspect * 2, 2);
  } else {
    camera.clearViewOffset();
  }
  camera.updateProjectionMatrix();
}
