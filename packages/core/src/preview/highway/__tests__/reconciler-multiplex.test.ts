/**
 * Two `SceneReconciler`s driving two `HighwayRoot`s inside one `THREE.Scene`,
 * which is what a multi-highway stage is.
 *
 * The per-canvas renderer gave every reconciler a scene of its own, so cross
 * contamination was impossible by construction. On a stage the scene is
 * shared, and the only thing keeping one highway's churn out of another is
 * that each reconciler adds and removes under its own root. These tests pin
 * that: real THREE objects, no GL.
 */

import * as THREE from 'three';
import {HighwayRoot} from '../HighwayRoot';
import {
  SceneReconciler,
  type ChartElement,
  type ElementRenderer,
} from '../SceneReconciler';

/** Well inside the visible window (`HIGHWAY_DURATION_MS` is 1500). */
const IN_WINDOW_MS = 500;

function makeRenderer(): ElementRenderer {
  return {
    create: () => new THREE.Group(),
    recycle: () => {},
    setHovered: () => {},
    setSelected: () => {},
  };
}

function el(key: string, msTime: number): ChartElement {
  return {key, kind: 'note', msTime, data: {}};
}

interface Highway {
  root: HighwayRoot;
  reconciler: SceneReconciler;
}

function mountHighway(scene: THREE.Scene, slot: number): Highway {
  const root = new HighwayRoot(slot * 8, slot + 1);
  scene.add(root);
  const reconciler = new SceneReconciler(root, {note: makeRenderer()}, 1.5);
  return {root, reconciler};
}

describe('two reconcilers in one scene', () => {
  let scene: THREE.Scene;
  let a: Highway;
  let b: Highway;

  beforeEach(() => {
    scene = new THREE.Scene();
    a = mountHighway(scene, 0);
    b = mountHighway(scene, 1);
  });

  it('keeps the groups of each highway under its own root', () => {
    a.reconciler.setElements([el('note:0', IN_WINDOW_MS)]);
    b.reconciler.setElements([
      el('note:0', IN_WINDOW_MS),
      el('note:1', IN_WINDOW_MS + 10),
    ]);
    a.reconciler.updateWindow(0);
    b.reconciler.updateWindow(0);

    expect(a.root.children).toHaveLength(1);
    expect(b.root.children).toHaveLength(2);
    // The roots are the scene's only children: nothing was added to the scene
    // itself, which is what would leak one highway's groups into every
    // camera's pass.
    expect(scene.children).toEqual([a.root, b.root]);
  });

  it('leaves the sibling untouched when one highway churns', () => {
    a.reconciler.setElements([el('note:0', IN_WINDOW_MS)]);
    b.reconciler.setElements([el('note:0', IN_WINDOW_MS)]);
    a.reconciler.updateWindow(0);
    b.reconciler.updateWindow(0);

    const bChildren = [...b.root.children];
    const bRevision = b.reconciler.getActiveGroupsRevision();

    // A full replace, a scroll past the window, and a re-add on A only.
    a.reconciler.setElements([el('note:1', IN_WINDOW_MS)]);
    a.reconciler.updateWindow(0);
    a.reconciler.updateWindow(IN_WINDOW_MS + 10_000);
    a.reconciler.setElements([el('note:2', IN_WINDOW_MS)]);
    a.reconciler.updateWindow(0);

    expect(b.root.children).toEqual(bChildren);
    expect(b.reconciler.getActiveGroupsRevision()).toBe(bRevision);
    expect(b.reconciler.getElements()).toHaveLength(1);
  });

  it('leaves the sibling mounted when one highway is disposed', () => {
    a.reconciler.setElements([el('note:0', IN_WINDOW_MS)]);
    b.reconciler.setElements([el('note:0', IN_WINDOW_MS)]);
    a.reconciler.updateWindow(0);
    b.reconciler.updateWindow(0);

    const bChildren = [...b.root.children];
    a.reconciler.dispose();

    expect(a.root.children).toHaveLength(0);
    expect(b.root.children).toEqual(bChildren);
    expect(b.reconciler.getActiveGroups().size).toBe(1);
    // Removing the disposed highway's root is the stage's job, not the
    // reconciler's: dispose() must not touch the shared scene.
    expect(scene.children).toEqual([a.root, b.root]);
  });
});
