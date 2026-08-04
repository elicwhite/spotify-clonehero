import {MarkerRenderer} from './MarkerRenderer';

/**
 * Process-wide count of live WebGL highway renderers -- every `setupRenderer`
 * handle plus every `setupStage` handle that has been created and not yet
 * destroyed.
 *
 * `MarkerRenderer`'s marker-texture cache is module-scoped and keyed only by
 * label content and state, so every live renderer's marker sprites share the
 * same `CanvasTexture` objects. A single renderer therefore must not clear it
 * on teardown: `/chart-review` keeps two `setupRenderer`s mounted at once
 * ("current on top, next pre-rendered behind"), and one of them closing would
 * dispose textures the other is still drawing with. The cache is cleared only
 * when the last live renderer goes away.
 */
let liveRendererCount = 0;

/** Register a newly created renderer or stage. */
export function acquireRenderer(): void {
  liveRendererCount++;
}

/**
 * Retire a renderer or stage. Clears the shared marker-texture cache only
 * when nothing is left to draw with it.
 */
export function releaseRenderer(): void {
  liveRendererCount = Math.max(0, liveRendererCount - 1);
  if (liveRendererCount === 0) {
    MarkerRenderer.clearTextureCache();
  }
}

/** Live renderer + stage count. Exposed for tests. */
export function getLiveRendererCount(): number {
  return liveRendererCount;
}
