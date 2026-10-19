/**
 * `HighwayRoot`'s two jobs, both load-bearing for the stage:
 *
 * 1. It translates its subtree to `worldX`, so several highways can sit side
 *    by side in one scene.
 * 2. `syncLayers()` stamps that subtree onto the root's layer, and the stage's
 *    cameras `enable` their own index on top of layer 0 rather than `set`
 *    it. That combination is what makes a missed stamp benign: an unstamped
 *    object stays on layer 0 and is drawn by every camera, so it is never
 *    invisible in its own viewport -- only wastefully culled elsewhere. The
 *    inverted form (`camera.layers.set(i)`) would hide unstamped objects
 *    everywhere, which is the bug this test exists to prevent.
 */

import * as THREE from 'three';
import {HighwayRoot} from '../HighwayRoot';

function makeCameraFor(root: HighwayRoot): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera();
  camera.layers.enable(0);
  camera.layers.enable(root.layerIndex);
  return camera;
}

describe('HighwayRoot', () => {
  it('positions its subtree at worldX', () => {
    const root = new HighwayRoot(8, 1);
    expect(root.worldX).toBe(8);
    expect(root.position.x).toBe(8);

    const mesh = new THREE.Mesh();
    mesh.position.x = 0.45;
    root.add(mesh);
    root.updateMatrixWorld(true);

    const world = new THREE.Vector3();
    mesh.getWorldPosition(world);
    expect(world.x).toBeCloseTo(8.45);
  });

  it('stamps every descendant, including ones added after the first sync', () => {
    const root = new HighwayRoot(0, 3);
    const early = new THREE.Mesh();
    const nested = new THREE.Group();
    const deep = new THREE.Sprite();
    nested.add(deep);
    root.add(early, nested);

    root.syncLayers();
    expect(early.layers.isEnabled(3)).toBe(true);
    expect(early.layers.isEnabled(0)).toBe(false);
    expect(deep.layers.isEnabled(3)).toBe(true);

    // SceneOverlays and the reconciler both add groups lazily, long after the
    // root is mounted.
    const late = new THREE.Mesh();
    root.add(late);
    expect(late.layers.isEnabled(3)).toBe(false);
    root.syncLayers();
    expect(late.layers.isEnabled(3)).toBe(true);
    expect(late.layers.isEnabled(0)).toBe(false);
  });

  it('draws a stamped object only in its own camera', () => {
    const a = new HighwayRoot(0, 1);
    const b = new HighwayRoot(8, 2);
    const cameraA = makeCameraFor(a);
    const cameraB = makeCameraFor(b);

    const meshA = new THREE.Mesh();
    a.add(meshA);
    a.syncLayers();
    const meshB = new THREE.Mesh();
    b.add(meshB);
    b.syncLayers();

    expect(meshA.layers.test(cameraA.layers)).toBe(true);
    expect(meshA.layers.test(cameraB.layers)).toBe(false);
    expect(meshB.layers.test(cameraB.layers)).toBe(true);
    expect(meshB.layers.test(cameraA.layers)).toBe(false);
  });

  it('draws an unstamped object in every camera, never in none', () => {
    const a = new HighwayRoot(0, 1);
    const b = new HighwayRoot(8, 2);
    const cameraA = makeCameraFor(a);
    const cameraB = makeCameraFor(b);

    // Added after the last syncLayers: still on layer 0.
    const missed = new THREE.Mesh();
    a.add(missed);

    expect(missed.layers.test(cameraA.layers)).toBe(true);
    expect(missed.layers.test(cameraB.layers)).toBe(true);
  });
});
