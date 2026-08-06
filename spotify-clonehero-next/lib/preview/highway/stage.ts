import {RefObject} from 'react';
import * as THREE from 'three';
import type {ParsedChart} from '../chorus-chart-processing';
import {ChartResponseEncore} from '../../chartSelection';
import {AudioManager} from '../audioManager';
import {
  schemaForTrack,
  drums4LaneSchema,
  type InstrumentSchema,
} from '../../chart-edit/instruments';
import {
  createWaveformSurface,
  createGridOverlay,
  LANES_OFF_HIGHWAY_WIDTH,
  type HighwayMode,
} from './HighwayScene';
import type {WaveformSurface, WaveformSurfaceConfig} from './WaveformSurface';
import type {GridOverlay, GridOverlayConfig} from './GridOverlay';
import {SceneOverlays, type OverlayState} from './SceneOverlays';
import {InteractionManager} from './InteractionManager';
import {SceneReconciler} from './SceneReconciler';
import {NoteRenderer} from './NoteRenderer';
import {LyricsOverlay} from './LyricsOverlay';
import {HighwayRoot} from './HighwayRoot';
import {
  buildHighwayCell,
  createHighwayClippingPlanes,
  disposeCellTextures,
  loadCellTextures,
  type CellTextures,
  type HighwayClippingPlanes,
} from './cell';
import {toGlRect, type HighwayRect, type StageLayout} from './layout';
import {computeHighwayCameraFit, HIGHWAY_CAMERA} from './cameraFit';
import {RenderGate} from './renderGate';
import type {Track} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Scroll speed shared by every highway in the stage. */
const HIGHWAY_SPEED = 1.5;

/**
 * Distance along X between adjacent highway roots, in world units.
 *
 * Not visually load-bearing -- the viewport/scissor rects are what the user
 * sees. The separation exists so the scene stays legible in devtools and so
 * an object that has not been layer-stamped yet falls outside every foreign
 * camera's frustum instead of drawing on top of a neighbour.
 */
const HIGHWAY_ROOT_SPACING = 8;

/** THREE has 32 layers, of which layer 0 is the shared "drawn everywhere" one. */
const MAX_HIGHWAY_LAYER = 31;

/**
 * How often the parked stage re-checks whether it owes a frame.
 *
 * Every push into the stage wakes the loop directly, so this poll exists only
 * for the one input that arrives with no push behind it: chart time moved
 * because something seeked `AudioManager` on its own (the transport's
 * section-jump buttons do exactly this). The piano roll runs the same poll at
 * the same rate for the same reason, so the two surfaces catch up together.
 */
const IDLE_POLL_MS = 120;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StageConfig {
  /** Which drum-tom art style to render: square (angular gem) or round. */
  tomStyle?: 'square' | 'round';
}

export interface AddHighwayOptions {
  /** `null` for scopes with no notes track (vocals/global). */
  track: Track | null;
  showDrumLanes: boolean;
}

/**
 * One highway inside the stage. This is today's per-renderer handle minus the
 * canvas-global members: lyrics and timing are chart-wide and live on the
 * stage.
 */
export interface StageHighwayHandle {
  /** This highway's camera, for overlay coordinate mapping. */
  getCamera(): THREE.PerspectiveCamera;
  /** World X of this highway's root, matching its `InteractionManager`. */
  getWorldX(): number;
  /** Set the overlay state for the current frame (read by the render loop). */
  setOverlayState(state: OverlayState): void;
  getInteractionManager(): Promise<InteractionManager | null>;
  getReconciler(): Promise<SceneReconciler>;
  setWaveformData(
    config: Omit<WaveformSurfaceConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void>;
  setGridData(
    config: Omit<GridOverlayConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void>;
  setHighwayMode(mode: HighwayMode): void;
}

export interface HighwayStage {
  /**
   * Mount a highway group. Never rebuilds the scene, the renderer, or the
   * WebGL context. Resolves once the highway's textures and scene core are
   * built.
   */
  addHighway(
    id: string,
    opts: AddHighwayOptions,
  ): Promise<StageHighwayHandle | null>;
  /** Unmount and dispose one highway group. Renderer and siblings untouched. */
  removeHighway(id: string): void;
  getHighway(id: string): StageHighwayHandle | null;
  /**
   * One-way layout push: React measures the canvas host and the stage obeys.
   * `order` names the highway ids left to right, so `layout.highways[i]` is
   * the rect for `order[i]`. Rects are paired to highways by id, never by
   * position, so a highway the caller has not mounted yet costs nothing but
   * its own rect. A mounted highway `order` does not name loses its rect and
   * stops drawing until a layout names it again.
   *
   * The stage retains the last layout and applies it to highways mounted
   * afterwards, exactly as it does with `setTimingData`. Mounting is async
   * and can land in any commit, so a highway added after the layout push --
   * which is every highway added after the editor's first frame -- would
   * otherwise hold no rect and draw nothing at all.
   *
   * The stage does not measure anything itself. The same `StageLayout` object
   * that positions the DOM interaction overlays sets the canvas size, the
   * GL viewport/scissor rects, and each camera's aspect, so DOM pixels and GL
   * pixels cannot drift apart.
   */
  setLayout(layout: StageLayout, order: readonly string[]): void;
  /** Chart-wide karaoke lyrics, drawn once for the whole strip. */
  setLyricsData(
    lyrics: {msTime: number; text: string; msLength?: number}[],
    vocalPhrases: {msTime: number; msLength: number}[],
  ): void;
  /** Chart-wide tempo map, fanned out to every highway. */
  setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void;
  startRender(): void;
  /**
   * Subscribe to WebGL context loss. One context backs the whole strip, so a
   * lost context blanks every highway at once: the stage stops its loop and
   * calls every listener, and the editor answers by destroying this stage and
   * building a new one, which re-adds every highway in the current visible
   * set. Returns an unsubscribe function.
   */
  onContextLost(listener: () => void): () => void;
  /** Idempotent; releases the GPU synchronously before returning. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface TimingData {
  timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[];
  resolution: number;
}

/** The stage-owned pieces every highway on it builds against. */
interface StageContext {
  scene: THREE.Scene;
  chart: ParsedChart;
  textureLoader: THREE.TextureLoader;
  clippingPlanes: HighwayClippingPlanes;
  tomStyle: 'square' | 'round';
  audioManager: AudioManager;
  /** Chart time minus audio delay, in ms. Shared by every highway. */
  getElapsedMs: () => number;
  /** The stage's tempo map, seeded into a highway as it finishes building. */
  getTiming: () => TimingData;
  /**
   * Tell the stage this highway's contents changed, so the loop draws again.
   * Cheap and coalescing -- see `RenderGate`.
   */
  wake: () => void;
}

function makeCamera(worldX: number): THREE.PerspectiveCamera {
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
 * One highway on the stage: its root group, its camera, its scene core, its
 * per-frame update, and its disposal. This object is the handle the editor
 * holds -- the stage hands out instances directly rather than wrapping a
 * record in a facade.
 *
 * The stage owns the renderer, the scene, the loop, and the layout; a
 * highway owns everything inside its own root. Nothing here reads React
 * state: `setOverlayState`, `setWaveformData`, `setGridData`,
 * `setHighwayMode`, and `rect` are all one-way pushes from above.
 */
class StageHighway implements StageHighwayHandle {
  readonly id: string;
  readonly root: HighwayRoot;
  readonly camera: THREE.PerspectiveCamera;
  /** Slot index this highway holds; freed on disposal. */
  readonly slot: number;
  /** Resolves once the scene core is built (or the highway was disposed). */
  readonly ready: Promise<void>;
  /** DOM-space rect from the last `setLayout`; null until one arrives. */
  rect: HighwayRect | null = null;

  /**
   * Half this highway's floor width in world units, from the track's schema.
   * Resolved in the constructor rather than in `build()`: a rect can be seeded
   * before the cell finishes building, and the camera fit needs the width the
   * moment the first rect lands.
   */
  private readonly halfWidth: number;
  /** The track's schema; null for scopes with no notes track. */
  private readonly schema: InstrumentSchema | null;

  private readonly ctx: StageContext;
  private disposed = false;

  private textures: CellTextures | null = null;
  /** Releases the cell's own floor / hitbox meshes; see `HighwayCellCore`. */
  private disposeCellMeshes: (() => void) | null = null;
  private reconciler: SceneReconciler | null = null;
  private noteRenderer: NoteRenderer | null = null;
  private sceneOverlays: SceneOverlays | null = null;
  private interactionManager: InteractionManager | null = null;
  private waveformSurface: WaveformSurface | null = null;
  private gridOverlay: GridOverlay | null = null;

  private overlayState: OverlayState | null = null;
  private highwayMode: HighwayMode = 'classic';

  /** Layer-stamp bookkeeping; see `HighwayRoot.syncLayers`. */
  private lastGroupsRevision = -1;
  private lastRootChildCount = -1;

  constructor(
    ctx: StageContext,
    id: string,
    slot: number,
    opts: AddHighwayOptions,
  ) {
    this.ctx = ctx;
    this.id = id;
    this.slot = slot;

    // Lanes-off scopes (vocals/global) draw the neutral floor at the drum
    // width, so they fit against that same width.
    this.schema = opts.track
      ? schemaForTrack(opts.track, ctx.chart.drumType)
      : null;
    this.halfWidth = (this.schema?.highwayWidth ?? LANES_OFF_HIGHWAY_WIDTH) / 2;

    const worldX = slot * HIGHWAY_ROOT_SPACING;
    const layerIndex = layerForSlot(slot);
    this.root = new HighwayRoot(worldX, layerIndex);
    this.camera = makeCamera(worldX);
    this.camera.layers.enable(0);
    this.camera.layers.enable(layerIndex);
    ctx.scene.add(this.root);

    this.ready = this.build(opts);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private async build(opts: AddHighwayOptions): Promise<void> {
    const {ctx} = this;
    const textures = await loadCellTextures(
      ctx.textureLoader,
      opts.track?.instrument ?? null,
      ctx.tomStyle,
    );
    if (this.disposed) {
      disposeCellTextures(textures);
      return;
    }
    this.textures = textures;

    const core = await buildHighwayCell(this.root, {
      chart: ctx.chart,
      track: opts.track,
      textureLoader: ctx.textureLoader,
      textures,
      clippingPlanes: ctx.clippingPlanes,
      highwaySpeed: HIGHWAY_SPEED,
      showDrumLanes: opts.showDrumLanes,
    });
    if (this.disposed) {
      core.reconciler.dispose();
      core.noteRenderer.dispose();
      core.disposeMeshes();
      return;
    }
    this.reconciler = core.reconciler;
    this.noteRenderer = core.noteRenderer;
    this.disposeCellMeshes = core.disposeMeshes;
    // Notes, selection, and hover are pushed straight into the reconciler by
    // the editor rather than through this handle, so the reconciler reports its
    // own mutations instead of the stage polling it every frame.
    core.reconciler.setChangeListener(ctx.wake);

    // SceneOverlays + InteractionManager exist for every highway -- they
    // power the cursor / ghost / hit-testing surface in both drum-editing
    // and lanes-off (lyrics) modes. With no track, geometry falls back to
    // the 4-lane drum schema: nothing renders through it, but both classes
    // need some valid lane geometry to construct.
    const overlaySchema = this.schema ?? drums4LaneSchema;
    this.sceneOverlays = new SceneOverlays(
      this.root,
      HIGHWAY_SPEED,
      ctx.clippingPlanes.note,
      overlaySchema,
    );
    this.interactionManager = new InteractionManager(
      this.camera,
      core.reconciler,
      HIGHWAY_SPEED,
      ctx.getElapsedMs,
      overlaySchema,
      this.root.worldX,
    );
    const timing = ctx.getTiming();
    if (timing.timedTempos.length > 0) {
      this.setTimingData(timing.timedTempos, timing.resolution);
    }
    this.root.syncLayers();
  }

  // -- Handle surface ------------------------------------------------------

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getWorldX(): number {
    return this.root.worldX;
  }

  setOverlayState(state: OverlayState): void {
    this.overlayState = state;
    this.ctx.wake();
  }

  async getInteractionManager(): Promise<InteractionManager | null> {
    await this.ready;
    return this.interactionManager;
  }

  async getReconciler(): Promise<SceneReconciler> {
    await this.ready;
    if (!this.reconciler) {
      throw new Error(`Highway "${this.id}" has no reconciler`);
    }
    return this.reconciler;
  }

  async setWaveformData(
    config: Omit<WaveformSurfaceConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    if (this.waveformSurface) {
      this.root.remove(this.waveformSurface.getMesh());
      this.waveformSurface.dispose();
      this.waveformSurface = null;
    }
    this.waveformSurface = createWaveformSurface(this.root, {
      ...config,
      // Slightly inset from the highway floor (0.9) so the gray plane
      // frames the waveform -- left/right edges stay visible at a glance.
      highwayWidth: 0.84,
      highwaySpeed: HIGHWAY_SPEED,
    });
    this.waveformSurface.setVisible(this.highwayMode === 'waveform');
    this.root.syncLayers();
    this.ctx.wake();
  }

  async setGridData(
    config: Omit<GridOverlayConfig, 'highwayWidth' | 'highwaySpeed'>,
  ): Promise<void> {
    await this.ready;
    if (this.disposed) return;
    if (this.gridOverlay) {
      this.root.remove(this.gridOverlay.getMesh());
      this.gridOverlay.dispose();
      this.gridOverlay = null;
    }
    this.gridOverlay = createGridOverlay(
      this.root,
      {
        ...config,
        highwayWidth: 0.9,
        highwaySpeed: HIGHWAY_SPEED,
      },
      this.ctx.clippingPlanes.note,
    );
    // Grid lines are highway rendering, visible in both modes.
    this.gridOverlay.setVisible(true);
    this.root.syncLayers();
    this.ctx.wake();
  }

  setHighwayMode(mode: HighwayMode): void {
    this.highwayMode = mode;
    this.waveformSurface?.setVisible(mode === 'waveform');
    // The classic floor stays visible in both modes: it is the gray plane
    // that frames the highway edges, and the waveform draws on top of it.
    this.gridOverlay?.setVisible(true);
    this.ctx.wake();
  }

  // -- Stage-internal ------------------------------------------------------

  setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void {
    this.sceneOverlays?.setTimingData(timedTempos, resolution);
    this.interactionManager?.setTimingData(timedTempos, resolution);
    this.ctx.wake();
  }

  /**
   * Set this highway's viewport rect, the camera aspect that matches it, and
   * the fit that keeps the whole highway inside that rect.
   *
   * `setViewOffset` overwrites `camera.aspect` with `fullWidth / fullHeight`,
   * so the virtual frame is sized `aspect * 2` by `2`: it restates the aspect
   * unchanged, and its 2-unit height makes `offsetY` read directly in NDC.
   */
  setRect(rect: HighwayRect | null): void {
    this.rect = rect;
    this.ctx.wake();
    if (rect && rect.width > 0 && rect.height > 0) {
      const aspect = rect.width / rect.height;
      const fit = computeHighwayCameraFit({aspect, halfWidth: this.halfWidth});
      this.camera.aspect = aspect;
      this.camera.fov = fit.fovDeg;
      if (fit.ndcShiftY !== 0) {
        this.camera.setViewOffset(
          aspect * 2,
          2,
          0,
          fit.ndcShiftY,
          aspect * 2,
          2,
        );
      } else {
        this.camera.clearViewOffset();
      }
      this.camera.updateProjectionMatrix();
    }
  }

  /** Everything this highway does per frame before its own render pass. */
  update(elapsedTime: number): void {
    const audioManager = this.ctx.audioManager;
    const isPlaying = audioManager?.isPlaying && audioManager?.isInitialized;
    if (isPlaying && this.textures) {
      // Update animated textures only during playback.
      this.textures.animatedTextureManager.tick();
    }
    if (this.textures) {
      // Scroll the highway floor. Re-set per pass because the passes within a
      // frame are sequential and each highway owns its own offset.
      this.textures.highwayTexture.offset.y =
        (elapsedTime / 1000) * HIGHWAY_SPEED;
    }
    this.reconciler?.updateWindow(elapsedTime);
    if (this.waveformSurface && this.highwayMode === 'waveform') {
      // The waveform indexes into raw PCM, so it needs audio time: chart time
      // plus chart delay (charts with a song.ini delay start their audio late
      // relative to tick 0).
      const chartDelayMs = (audioManager?.chartDelay ?? 0) * 1000;
      this.waveformSurface.update(elapsedTime + chartDelayMs);
    }
    this.gridOverlay?.update(elapsedTime);
    if (this.sceneOverlays && this.overlayState) {
      this.sceneOverlays.update(elapsedTime, this.overlayState);
    }

    // Layer stamping is add-time, and both the reconciler and SceneOverlays
    // add groups lazily. The revision catches recycled groups; the child count
    // catches the overlays' lazy adds.
    const revision = this.reconciler?.getActiveGroupsRevision() ?? -1;
    const childCount = this.root.children.length;
    if (
      revision !== this.lastGroupsRevision ||
      childCount !== this.lastRootChildCount
    ) {
      this.lastGroupsRevision = revision;
      this.lastRootChildCount = childCount;
      this.root.syncLayers();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.sceneOverlays?.dispose();
    this.interactionManager?.dispose();
    this.reconciler?.dispose();
    this.noteRenderer?.dispose();
    this.waveformSurface?.dispose();
    this.gridOverlay?.dispose();
    // The context outlives every highway on it, so the cell's own floor /
    // hitbox meshes and its texture set have to be handed back explicitly --
    // nothing reclaims them on removal otherwise.
    this.disposeCellMeshes?.();
    if (this.textures) disposeCellTextures(this.textures);
    this.disposeCellMeshes = null;
    this.sceneOverlays = null;
    this.interactionManager = null;
    this.reconciler = null;
    this.noteRenderer = null;
    this.waveformSurface = null;
    this.gridOverlay = null;
    this.textures = null;
    this.ctx.scene.remove(this.root);
  }
}

/**
 * Layer this slot's subtree is stamped onto. Layer 0 stays the shared "drawn
 * everywhere" one, so slots map onto 1..31. Slots are recycled on removal and
 * `MAX_HIGHWAYS` is far below the ceiling, so this throws rather than wrapping:
 * two highways sharing a layer would draw into each other's viewports.
 */
function layerForSlot(slot: number): number {
  if (slot + 1 > MAX_HIGHWAY_LAYER) {
    throw new Error(`Highway slot ${slot} has no THREE layer available`);
  }
  return slot + 1;
}

/**
 * Build the whole side-by-side highway strip: one `WebGLRenderer`, one canvas,
 * one `THREE.Scene`, one animation loop, and N highway roots rendered through
 * N per-viewport cameras into scissored slices of that one canvas.
 *
 * `sizingRef` seeds the canvas size before React's first measurement lands;
 * `canvasHostRef` receives the canvas element. `_metadata` is part of the
 * stage's identity -- the editor rebuilds the stage when it changes -- but
 * nothing inside reads it.
 */
export function setupStage(
  _metadata: ChartResponseEncore,
  chart: ParsedChart,
  sizingRef: RefObject<HTMLDivElement | null>,
  canvasHostRef: RefObject<HTMLDivElement | null>,
  audioManager: AudioManager,
  config: StageConfig = {},
): HighwayStage {
  const tomStyle = config.tomStyle ?? 'square';

  const scene = new THREE.Scene();
  // Black fog fades far-end fragments toward black against the black canvas
  // background, matching Clone Hero / YARG's gradient fade-in at the top of
  // the highway. Distances are measured from a camera at (z=0.8, y=-1.3),
  // which every highway camera reproduces at its own X, so the falloff is
  // identical in every viewport.
  scene.fog = new THREE.Fog(0x000000, 2.0, 2.5);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({
    antialias: dpr < 2, // skip antialias on high-DPI screens where it's unnecessary
  });
  renderer.setPixelRatio(dpr);
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // The canvas is inline by default; the baseline gap below it overflows the
  // container by a few pixels, which can spawn a scrollbar and put the
  // measuring ResizeObserver into a shrink/grow feedback loop.
  renderer.domElement.style.display = 'block';
  canvasHostRef.current?.children.item(0)?.remove();
  canvasHostRef.current?.appendChild(renderer.domElement);

  const textureLoader = new THREE.TextureLoader();
  const clippingPlanes = createHighwayClippingPlanes();

  let canvasWidth = sizingRef.current?.offsetWidth ?? window.innerWidth;
  let canvasHeight = sizingRef.current?.offsetHeight ?? window.innerHeight;
  renderer.setSize(canvasWidth, canvasHeight);

  const highways = new Map<string, StageHighway>();
  const usedSlots = new Set<number>();

  let lyricsOverlay: LyricsOverlay | null = null;
  let timing: TimingData = {timedTempos: [], resolution: 480};
  /**
   * The last `setLayout` push, retained so a highway mounted after it still
   * gets its rect. Null until React measures the canvas host.
   */
  let layoutState: {layout: StageLayout; order: readonly string[]} | null =
    null;

  /** Set once `destroy()` runs, so a late async `startRender` is a no-op. */
  let destroyed = false;
  /**
   * Guards the synchronous disposal block against running twice. Highway
   * visibility churn can tear the stage down more than once in the same tick,
   * and a second `dispose()` / `forceContextLoss()` on an already-lost WebGL
   * context is undefined behavior in some browsers.
   */
  let disposedSync = false;
  /**
   * Set when the browser drops the WebGL context. Rendering into a lost
   * context throws every frame, and `forceContextLoss()` on an already-lost
   * context is undefined behavior in some browsers, so both are skipped.
   */
  let contextLost = false;
  const contextLostListeners = new Set<() => void>();

  function handleContextLost(event: Event): void {
    // Cancelling the default keeps the canvas reusable, so the replacement
    // stage can attach its own renderer to a fresh context.
    event.preventDefault();
    if (contextLost) return;
    contextLost = true;
    stopIdlePoll();
    looping = false;
    renderer.setAnimationLoop(null);
    for (const listener of Array.from(contextLostListeners)) {
      try {
        listener();
      } catch (e) {
        console.warn('Highway stage context-loss listener failed:', e);
      }
    }
  }

  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

  // Seed the karaoke overlay from the chart's default vocal part. The editor
  // re-pushes the active part immediately; this only avoids a blank first
  // frame on a chart that already has lyrics.
  const seedVocals = chart.vocalTracks?.parts?.['vocals'];
  const seedLyrics = seedVocals?.notePhrases.flatMap(p => p.lyrics) ?? [];
  if (seedLyrics.length > 0) {
    lyricsOverlay = new LyricsOverlay(
      seedLyrics,
      seedVocals?.notePhrases ?? [],
      canvasWidth,
      canvasHeight,
    );
  }

  function getElapsedMs(): number {
    const currentMs = (audioManager?.chartTime ?? 0) * 1000;
    const delay = (audioManager?.delay || 0) * 1000;
    return currentMs - delay;
  }

  /**
   * Decides which frames are worth drawing. Every push below funnels into
   * `wake()`; the loop itself only keeps drawing on its own while chart time is
   * moving.
   */
  const gate = new RenderGate();
  /** Whether the rAF loop is currently armed. */
  let looping = false;
  /** The low-rate poll that stands in while the loop is parked. */
  let idleTimer: ReturnType<typeof setInterval> | null = null;

  function stopIdlePoll(): void {
    if (idleTimer === null) return;
    clearInterval(idleTimer);
    idleTimer = null;
  }

  /** Arm the rAF loop, if it is not already running and still can be. */
  function arm(): void {
    if (destroyed || contextLost || looping) return;
    stopIdlePoll();
    looping = true;
    renderer.setAnimationLoop(animation);
  }

  /**
   * Ask for a frame. O(1) and coalescing: any number of calls between two
   * frames cost one frame, and none of them draw synchronously.
   */
  function wake(): void {
    gate.wake();
    arm();
  }

  const context: StageContext = {
    scene,
    chart,
    textureLoader,
    clippingPlanes,
    tomStyle,
    audioManager,
    getElapsedMs,
    getTiming: () => timing,
    wake,
  };

  /**
   * This id's rect under the retained layout, or null when no layout has
   * arrived yet or the last one did not name it. First occurrence wins, which
   * is the same id a duplicated `order` resolves to in `setLayout`.
   */
  function rectForId(id: string): HighwayRect | null {
    if (!layoutState) return null;
    const index = layoutState.order.indexOf(id);
    if (index < 0) return null;
    return layoutState.layout.highways[index] ?? null;
  }

  function claimSlot(): number {
    let slot = 0;
    while (usedSlots.has(slot)) slot++;
    usedSlots.add(slot);
    return slot;
  }

  async function addHighway(
    id: string,
    opts: AddHighwayOptions,
  ): Promise<StageHighwayHandle | null> {
    const existing = highways.get(id);
    if (existing) return existing;
    if (destroyed) return null;

    const highway = new StageHighway(context, id, claimSlot(), opts);
    highways.set(id, highway);
    // Seed from the retained layout: React pushes a layout once per commit,
    // and a highway that mounts after that push gets no further one.
    highway.setRect(rectForId(id));

    await highway.ready;
    // The scene core lands asynchronously, long after the push that asked for
    // it, so the finished highway asks for its own first frame.
    wake();
    return highway.isDisposed ? null : highway;
  }

  function disposeHighway(highway: StageHighway): void {
    highway.dispose();
    usedSlots.delete(highway.slot);
  }

  function removeHighway(id: string): void {
    const highway = highways.get(id);
    if (!highway) return;
    highways.delete(id);
    disposeHighway(highway);
    wake();
  }

  function setLayout(layout: StageLayout, order: readonly string[]): void {
    layoutState = {layout, order: Array.from(order)};
    wake();
    if (layout.measured) {
      canvasWidth = layout.canvas.width;
      canvasHeight = layout.canvas.height;
      renderer.setSize(canvasWidth, canvasHeight);
      lyricsOverlay?.resize(canvasWidth, canvasHeight);
    }

    const named = new Set<string>();
    for (let i = 0; i < order.length; i++) {
      const highway = highways.get(order[i]);
      if (!highway || named.has(highway.id)) continue;
      named.add(highway.id);
      highway.setRect(layout.highways[i] ?? null);
    }
    // A highway this layout does not name has no place on the canvas, so it
    // draws nothing rather than keeping a rect that now belongs to a sibling.
    for (const highway of highways.values()) {
      if (!named.has(highway.id)) highway.setRect(null);
    }
  }

  function setLyricsData(
    lyrics: {msTime: number; text: string; msLength?: number}[],
    vocalPhrases: {msTime: number; msLength: number}[],
  ): void {
    wake();
    if (lyricsOverlay) {
      lyricsOverlay.setLyrics(lyrics, vocalPhrases);
      return;
    }
    if (lyrics.length === 0) return;
    lyricsOverlay = new LyricsOverlay(
      lyrics,
      vocalPhrases,
      canvasWidth,
      canvasHeight,
    );
  }

  function setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void {
    timing = {timedTempos, resolution};
    for (const highway of highways.values()) {
      highway.setTimingData(timedTempos, resolution);
    }
    wake();
  }

  /**
   * The chart time this frame would draw at, and whether audio is advancing.
   *
   * Audio latency compensation only applies during active playback. When
   * paused, the highway shows the exact seek position without offset --
   * otherwise resuming creates a visible jump-back.
   */
  function frameTime(): {elapsedMs: number; isPlaying: boolean} {
    const isPlaying = Boolean(
      audioManager?.isPlaying && audioManager?.isInitialized,
    );
    const syncMs = isPlaying ? (audioManager?.delay || 0) * 1000 : 0;
    const chartMs = (audioManager?.chartTime ?? 0) * 1000;
    return {elapsedMs: chartMs - syncMs, isPlaying};
  }

  function animation(): void {
    const {elapsedMs, isPlaying} = frameTime();
    const decision = gate.evaluate({
      nowMs: performance.now(),
      elapsedMs,
      isPlaying,
    });
    if (decision.render) draw(elapsedMs);
    if (!decision.keepAwake) {
      // THREE re-arms its own rAF immediately after this callback returns, so
      // parking has to wait for the stack to unwind or the cancel would race
      // ahead of the request it is meant to cancel.
      queueMicrotask(park);
    }
  }

  /**
   * Stop the rAF loop and hand over to the low-rate poll. Only ever called
   * once the gate has confirmed the next frame would be identical to the last.
   */
  function park(): void {
    if (!looping) return;
    looping = false;
    renderer.setAnimationLoop(null);
    if (destroyed || contextLost || idleTimer !== null) return;
    idleTimer = setInterval(idlePoll, IDLE_POLL_MS);
  }

  function idlePoll(): void {
    const {elapsedMs, isPlaying} = frameTime();
    if (gate.reasonToRender({nowMs: performance.now(), elapsedMs, isPlaying})) {
      arm();
    }
  }

  function draw(elapsedTime: number): void {
    try {
      // Clear the whole canvas once, before any scissor is in force: with
      // scissor testing on, a clear only touches the scissor rect, leaving
      // the inter-highway gaps and any dead edge strip filled with stale,
      // driver-dependent pixels.
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      renderer.setScissor(0, 0, canvasWidth, canvasHeight);
      renderer.clear();

      renderer.autoClear = false;
      renderer.setScissorTest(true);
      // Pass order is irrelevant: every pass is independently scissored into
      // its own slice of the canvas.
      for (const highway of highways.values()) {
        highway.update(elapsedTime);
        const rect = highway.rect;
        if (!rect || rect.width <= 0 || rect.height <= 0) continue;
        const gl = toGlRect(rect, canvasHeight);
        renderer.setViewport(gl.x, gl.y, gl.width, gl.height);
        renderer.setScissor(gl.x, gl.y, gl.width, gl.height);
        renderer.render(scene, highway.camera);
      }

      // Chart-wide chrome: one karaoke line across the whole strip.
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      const overlay = lyricsOverlay;
      if (overlay?.update(elapsedTime) === true) {
        renderer.render(overlay.scene, overlay.camera);
      }
    } catch (e) {
      // Log but don't stop the loop -- transient errors (e.g. a null material
      // during a texture swap) should not permanently kill the renderer.
      console.warn('Highway stage render error:', e);
    } finally {
      renderer.autoClear = true;
    }
  }

  function startRender(): void {
    wake();
  }

  function onContextLost(listener: () => void): () => void {
    contextLostListeners.add(listener);
    return () => {
      contextLostListeners.delete(listener);
    };
  }

  function destroy(): void {
    destroyed = true;
    // Everything below is synchronous: an editor unmount must cancel the RAF
    // loop and release the GPU context before this call returns, not after
    // some later microtask. Guarded so a second destroy() is a no-op instead
    // of double-disposing the renderer.
    if (disposedSync) return;
    disposedSync = true;
    contextLostListeners.clear();
    renderer.domElement.removeEventListener(
      'webglcontextlost',
      handleContextLost,
    );
    stopIdlePoll();
    looping = false;
    renderer.setAnimationLoop(null);
    renderer.renderLists.dispose();
    renderer.dispose();
    if (!contextLost) renderer.forceContextLoss();
    renderer.domElement.remove();
    for (const highway of Array.from(highways.values())) {
      disposeHighway(highway);
    }
    highways.clear();
    lyricsOverlay?.dispose();
    lyricsOverlay = null;
  }

  return {
    addHighway,
    removeHighway,
    getHighway: (id: string) => highways.get(id) ?? null,
    setLayout,
    setLyricsData,
    setTimingData,
    startRender,
    onContextLost,
    destroy,
  };
}
