import * as THREE from 'three';

/**
 * One highway's subtree inside a shared scene.
 *
 * Everything a single highway draws -- floor, hitbox/strikeline, reconciled
 * note and marker groups, scene overlays, waveform and grid surfaces -- is
 * added under a root rather than directly to the scene, so a stage can hold
 * several highways side by side in one `THREE.Scene` and render each through
 * its own camera.
 *
 * The root carries the two pieces of identity the stage needs:
 *
 * - `worldX`, the group's slot along X. The same number is handed to the
 *   root's `InteractionManager` as `rootWorldX`, which is what makes the
 *   schema's root-local lane geometry resolve correctly for a translated
 *   highway.
 * - `layerIndex`, the THREE layer the subtree is stamped onto by
 *   `syncLayers()`. Cameras `enable` their own index on top of layer 0, so a
 *   stamped object renders only in its own camera's pass while an object that
 *   has not been stamped yet stays on layer 0 and is drawn by every camera --
 *   visible in its own viewport, frustum-culled everywhere else. Stamping is
 *   therefore an optimization whose miss costs a culled draw call and never
 *   hides anything. It defaults to 0, the layer every camera draws, which is
 *   what a single-camera scene wants.
 */
export class HighwayRoot extends THREE.Group {
  readonly worldX: number;
  readonly layerIndex: number;

  constructor(worldX: number, layerIndex: number = 0) {
    super();
    this.worldX = worldX;
    this.layerIndex = layerIndex;
    this.position.x = worldX;
    this.name = `HighwayRoot(layer ${layerIndex})`;
  }

  /**
   * Stamp this root and every descendant onto `layerIndex`. Safe to call as
   * often as the stage likes: it is idempotent, and objects added since the
   * last call are the only ones whose mask actually changes.
   */
  syncLayers(): void {
    this.traverse(object => {
      object.layers.set(this.layerIndex);
    });
  }
}
