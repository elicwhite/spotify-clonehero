import * as THREE from 'three';
import type {ParsedChart} from '../chorus-chart-processing';
import {AudioManager} from '../audioManager';
import {MarkerRenderer} from './MarkerRenderer';
import type {NoteRenderer} from './NoteRenderer';
import type {SceneReconciler} from './SceneReconciler';
import {
  buildHighwayCell,
  createHighwayClippingPlanes,
  loadCellTextures,
  type CellTextures,
} from './cell';
import {computeCellViewport, cellTextureKey} from './multiCellLayout';
import type {Track} from './types';

// ---------------------------------------------------------------------------
// createHighwayGrid — many independent highway scenes, one WebGLRenderer.
// ---------------------------------------------------------------------------
//
// Every existing highway consumer (setupRenderer) owns a WebGLRenderer, a
// canvas, and a requestAnimationFrame loop. Ten of those on one page would
// mean ten WebGL contexts (browsers cap ~8–16), ten texture loads, and ten
// rAF loops. Instead this mounts ONE renderer on ONE canvas and draws each
// cell into its own scissored viewport, sharing texture sets across cells that
// use the same instrument + tomStyle.

const HIGHWAY_SPEED = 1.5;

export interface HighwayGridCell {
  /** DOM element whose bounding rect drives this cell's viewport each frame. */
  container: HTMLElement;
  chart: ParsedChart;
  /** Null for a scope with no notes track (vocals/global). */
  track: Track | null;
  /** Audio source this cell reads its clock from. All cells in a synced grid
   *  share one instance; distinct instances are allowed but untested. */
  audioManager: AudioManager;
  config?: {showDrumLanes?: boolean; tomStyle?: 'square' | 'round'};
}

export interface HighwayGrid {
  /** Resolves once every cell is built and the render loop is running.
   *  Rejects only on a fatal boot error (renderer/context creation). */
  ready: Promise<void>;
  /** Resize the shared canvas to the current viewport. Called on window
   *  resize automatically; exposed for callers that resize the canvas host
   *  by other means. Cell viewports are recomputed every frame from the DOM,
   *  so nothing else needs to happen here. */
  resize(): void;
  /** Tear down the renderer, every cell's scene, and shared textures.
   *  Idempotent and safe to call before `ready` resolves. */
  destroy(): void;
}

interface LiveCell {
  container: HTMLElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  audioManager: AudioManager;
  /** Shared with sibling cells of the same texture key; offset.y is re-set
   *  immediately before this cell's own render each frame. */
  highwayTexture: THREE.Texture;
  reconciler: SceneReconciler;
  noteRenderer: NoteRenderer;
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 10);
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);
  return camera;
}

/** ms position the highway should show, mirroring setupRenderer's per-frame
 *  latency compensation: apply audio `delay` only while actively playing so a
 *  paused/seeked highway sits exactly on the seek position. */
function cellElapsedMs(audioManager: AudioManager): number {
  const isPlaying = audioManager?.isPlaying && audioManager?.isInitialized;
  const syncMs = isPlaying ? (audioManager?.delay || 0) * 1000 : 0;
  const chartMs = (audioManager?.chartTime ?? 0) * 1000;
  return chartMs - syncMs;
}

export function createHighwayGrid(
  canvasContainer: HTMLElement,
  cells: HighwayGridCell[],
): HighwayGrid {
  let disposed = false;
  let renderer: THREE.WebGLRenderer | null = null;
  let liveCells: LiveCell[] = [];
  /** Distinct shared texture sets — ticked once per frame, disposed once. */
  let sharedTextureSets: CellTextures[] = [];
  let onWindowResize: (() => void) | null = null;

  function sizeCanvas() {
    if (!renderer) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  async function boot(): Promise<void> {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer = new THREE.WebGLRenderer({antialias: dpr < 2, alpha: true});
    renderer.setPixelRatio(dpr);
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Manual clear: one full-canvas clear per frame, then scissored per-cell
    // renders. Leaving autoClear on would clear per render() call and wipe
    // earlier cells' pixels.
    renderer.autoClear = false;

    // Fixed, viewport-sized canvas layered behind the scrolling DOM grid. Cell
    // viewports are recomputed every frame from each cell's getBoundingClientRect,
    // so there is no ResizeObserver and thus none of setupRenderer's
    // shrink/grow feedback loop — only a window-resize listener sizing the canvas.
    const canvas = renderer.domElement;
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.zIndex = '0';
    canvas.style.pointerEvents = 'none';
    canvasContainer.appendChild(canvas);
    sizeCanvas();

    onWindowResize = sizeCanvas;
    window.addEventListener('resize', onWindowResize);

    // Clipping planes are numerically identical for every cell (world-space
    // constants), so one set is shared across all of them.
    const clippingPlanes = createHighwayClippingPlanes();
    const textureLoader = new THREE.TextureLoader();

    // Load one texture set per distinct (instrument, tomStyle) and reuse it —
    // the AnimatedTextureManager pre-decodes every frame into per-instance
    // ImageBitmap caches, so ten independent copies is a real memory cliff.
    const textureSetByKey = new Map<string, CellTextures>();
    async function textureSetFor(cell: HighwayGridCell): Promise<CellTextures> {
      const tomStyle = cell.config?.tomStyle ?? 'square';
      const instrument = cell.track?.instrument ?? null;
      const key = cellTextureKey(instrument, tomStyle);
      const existing = textureSetByKey.get(key);
      if (existing) return existing;
      const loaded = await loadCellTextures(
        textureLoader,
        instrument,
        tomStyle,
      );
      textureSetByKey.set(key, loaded);
      return loaded;
    }

    const built: LiveCell[] = [];
    for (const cell of cells) {
      const textures = await textureSetFor(cell);
      if (disposed) return;

      const scene = new THREE.Scene();
      // Black fog fades far-end fragments toward the black canvas, matching
      // setupRenderer's highway gradient fade-in.
      scene.fog = new THREE.Fog(0x000000, 2.0, 2.5);

      const {reconciler, noteRenderer} = await buildHighwayCell(scene, {
        chart: cell.chart,
        track: cell.track,
        textureLoader,
        textures,
        clippingPlanes,
        highwaySpeed: HIGHWAY_SPEED,
        showDrumLanes: cell.config?.showDrumLanes ?? true,
      });
      if (disposed) return;

      built.push({
        container: cell.container,
        scene,
        camera: makeCamera(),
        audioManager: cell.audioManager,
        highwayTexture: textures.highwayTexture,
        reconciler,
        noteRenderer,
      });
    }

    liveCells = built;
    sharedTextureSets = [...textureSetByKey.values()];

    renderer.setAnimationLoop(renderFrame);
  }

  function renderFrame() {
    const r = renderer;
    if (!r) return;

    // Advance shared animated textures once per frame (not once per cell, or
    // they'd tick N× too fast). Gate on any cell actively playing.
    const anyPlaying = liveCells.some(
      c => c.audioManager?.isPlaying && c.audioManager?.isInitialized,
    );
    if (anyPlaying) {
      for (const set of sharedTextureSets) set.animatedTextureManager.tick();
    }

    // One full-canvas, scissor-off *transparent* clear so stale pixels don't
    // trail in the gutters between cells and the page background (not black)
    // shows through the gutters. Each cell then paints its own viewport opaque
    // black below.
    const canvasW = window.innerWidth;
    const canvasH = window.innerHeight;
    r.setScissorTest(false);
    r.setViewport(0, 0, canvasW, canvasH);
    r.setClearColor(0x000000, 0);
    r.clear();

    for (const cell of liveCells) {
      const rect = cell.container.getBoundingClientRect();
      const vp = computeCellViewport(rect, canvasW, canvasH);
      // Skip cells scrolled out of view or with no area.
      if (!vp.visible) continue;

      r.setViewport(vp.x, vp.y, vp.w, vp.h);
      r.setScissor(vp.x, vp.y, vp.w, vp.h);
      r.setScissorTest(true);

      // Opaque black background for this cell's viewport only. The highway
      // floor/notes don't cover the whole cell (its aspect ratio varies), so
      // without this the transparent canvas lets the white page show through.
      r.setClearColor(0x000000, 1);
      r.clear();

      cell.camera.aspect = vp.w / vp.h;
      cell.camera.updateProjectionMatrix();

      const elapsedMs = cellElapsedMs(cell.audioManager);
      // Scroll the shared floor texture; re-set every cell because siblings
      // share this texture instance and renders are sequential.
      cell.highwayTexture.offset.y = (elapsedMs / 1000) * HIGHWAY_SPEED;
      cell.reconciler.updateWindow(elapsedMs);

      try {
        r.render(cell.scene, cell.camera);
      } catch (e) {
        // A transient per-cell error (e.g. null material mid texture-swap)
        // must not kill the shared loop for the other cells.
        console.warn('Highway grid cell render error:', e);
      }
    }
  }

  const ready = boot().catch(e => {
    console.error('createHighwayGrid boot failed', e);
    throw e;
  });

  return {
    ready,
    resize: sizeCanvas,
    destroy() {
      disposed = true;
      if (onWindowResize) {
        window.removeEventListener('resize', onWindowResize);
        onWindowResize = null;
      }
      if (renderer) {
        renderer.setAnimationLoop(null);
        renderer.renderLists.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
        renderer = null;
      }
      for (const cell of liveCells) {
        cell.reconciler.dispose();
        cell.noteRenderer.dispose();
      }
      liveCells = [];
      for (const set of sharedTextureSets) {
        set.animatedTextureManager.dispose();
      }
      sharedTextureSets = [];
      // The marker-texture cache is module-scoped and shared by every cell —
      // clear it exactly once for the whole grid, never per cell (that would
      // nuke the other cells' still-live marker textures).
      MarkerRenderer.clearTextureCache();
    },
  };
}
