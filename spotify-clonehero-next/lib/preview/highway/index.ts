import {RefObject} from 'react';
import * as THREE from 'three';
import type {ParsedChart} from '../chorus-chart-processing';
import {ChartResponseEncore} from '../../chartSelection';
import {AudioManager} from '../audioManager';
import {
  getHighwayTexture,
  createHighway,
  createPlainStrikeline,
  LANES_OFF_HIGHWAY_WIDTH,
  loadAndCreateHitBox,
  createWaveformSurface,
  createGridOverlay,
  type HighwayMode,
} from './HighwayScene';
import {schemaForTrack, drums4LaneSchema} from '../../chart-edit/instruments';
import type {WaveformSurface} from './WaveformSurface';
import type {WaveformSurfaceConfig} from './WaveformSurface';
import type {GridOverlay} from './GridOverlay';
import type {GridOverlayConfig} from './GridOverlay';
import {AnimatedTextureManager, loadNoteTextures} from './TextureManager';
import {SceneOverlays, type OverlayState} from './SceneOverlays';
import {InteractionManager} from './InteractionManager';
import {SceneReconciler} from './SceneReconciler';
import {NoteRenderer} from './NoteRenderer';
import {MarkerRenderer} from './MarkerRenderer';
import {trackToElements} from './trackToElements';
import {padLaneColors} from './notePlacement';
import {LyricsOverlay} from './LyricsOverlay';
import type {Track} from './types';

// Re-export public types, constants, and utilities
export {
  type SelectedTrack,
  type Song,
  type HitResult,
  type PreparedNote,
  SCALE,
  NOTE_SPAN_WIDTH,
  calculateNoteXOffset,
} from './types';
export {NotesManager, type NotesDiff} from './NotesManager';
export {areAnimationsSupported} from './TextureManager';
export {SceneOverlays, type OverlayState} from './SceneOverlays';
export {InteractionManager} from './InteractionManager';
export {type HighwayMode} from './HighwayScene';
export {SceneReconciler, type ChartElement} from './SceneReconciler';
export {NoteRenderer} from './NoteRenderer';
export {MarkerRenderer} from './MarkerRenderer';
export {trackToElements} from './trackToElements';
export {chartToElements} from './chartToElements';
export {LyricsOverlay} from './LyricsOverlay';

// ---------------------------------------------------------------------------
// setupRenderer (public API -- signature unchanged)
// ---------------------------------------------------------------------------

export interface RendererConfig {
  /** When false, render a neutral floor + skip the drum hitbox + skip drum
   *  note rendering. Defaults to true (drum-edit). */
  showDrumLanes?: boolean;
  /** Which drum-tom art style to render: square (angular gem, default) or
   *  round (circular head). Cymbals and kick have only one style.
   *  TODO: surface as a user preference. */
  tomStyle?: 'square' | 'round';
}

export const setupRenderer = (
  metadata: ChartResponseEncore,
  chart: ParsedChart,
  sizingRef: RefObject<HTMLDivElement>,
  ref: RefObject<HTMLDivElement>,
  audioManager: AudioManager,
  config: RendererConfig = {},
) => {
  const showDrumLanes = config.showDrumLanes ?? true;
  const tomStyle = config.tomStyle ?? 'square';
  const highwaySpeed = 1.5;

  const camera = new THREE.PerspectiveCamera(90, 1 / 1, 0.01, 10);
  camera.position.z = 0.8;
  camera.position.y = -1.3;
  camera.rotation.x = THREE.MathUtils.degToRad(60);

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderer = new THREE.WebGLRenderer({
    antialias: dpr < 2, // skip antialias on high-DPI screens where it's unnecessary
  });
  renderer.setPixelRatio(dpr);
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /** Lyrics overlay (Clone Hero-style karaoke at top of screen). */
  let lyricsOverlay: LyricsOverlay | null = null;
  /** Set to true when destroy() is called, prevents late async startRender. */
  let destroyed = false;

  function setSize() {
    const width = sizingRef.current?.offsetWidth ?? window.innerWidth;
    const height = sizingRef.current?.offsetHeight ?? window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    lyricsOverlay?.resize(width, height);
  }
  setSize();

  function onResize() {
    setSize();
  }
  window.addEventListener('resize', onResize, false);
  // Window resize misses layout-driven size changes (e.g. a sibling pane
  // opening next to the highway), so also watch the sizing container itself.
  const resizeObserver = new ResizeObserver(onResize);
  if (sizingRef.current) {
    resizeObserver.observe(sizingRef.current);
  }

  // The canvas is inline by default; the baseline gap below it overflows the
  // container by a few pixels, which can spawn a scrollbar and put the
  // ResizeObserver into a shrink/grow feedback loop.
  renderer.domElement.style.display = 'block';
  ref.current?.children.item(0)?.remove();
  ref.current?.appendChild(renderer.domElement);

  const textureLoader = new THREE.TextureLoader();

  // highwayBeginningPlane (normal +Y, const 1) clips y < -1 — the bottom
  // of the highway near the strikeline / hitline. Notes need this so they
  // disappear when they cross the hitline.
  // highwayEndPlane (normal -Y, const 0.9) clips y > 0.9 — the far end
  // (top of the visible highway). Both notes and markers want this so
  // nothing bleeds out the top.
  // Markers (BPM, time-signature, section, lyric, phrase-start/end) keep
  // only the top clip so their labels can extend past the hitline to the
  // bottom edge of the canvas instead of being chopped at y=-1.
  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
  const noteClippingPlanes = [highwayBeginningPlane, highwayEndPlane];
  const markerClippingPlanes = [highwayEndPlane];

  async function initialize() {
    const highwayTexture: THREE.Texture =
      await getHighwayTexture(textureLoader);

    return {
      highwayTexture,
    };
  }

  const initPromise = initialize();
  let trackPromise: ReturnType<typeof prepTrack>;

  /** Mutable overlay state updated by the editor, read each frame. */
  let overlayState: OverlayState | null = null;

  /** Waveform/grid surface instances (only for drum tracks). */
  let waveformSurface: WaveformSurface | null = null;
  let gridOverlay: GridOverlay | null = null;
  /** Current highway display mode. */
  let highwayMode: HighwayMode = 'classic';
  /** Reference to the classic highway mesh (for toggling visibility). */
  let classicHighwayMesh: THREE.Mesh | null = null;

  const methods = {
    /**
     * `track` is `null` for scopes with no notes track (vocals/global —
     * add-lyrics). Lanes, hitbox, and note textures are all skipped in
     * that case; only the neutral floor + markers render.
     */
    prepTrack(track: Track | null) {
      const scene = new THREE.Scene();
      // Black fog fades far-end fragments toward black against the black
      // canvas background, matching Clone Hero / YARG's gradient fade-in
      // at the top of the highway. Distances measured from the camera at
      // (z=0.8, y=-1.3): strikeline ~0.85, mid-highway ~1.53, 3/4 up
      // ~1.97, top edge ~2.34. Fade is concentrated in the upper third
      // so the rest of the highway stays fully opaque. Built-in
      // materials (SpriteMaterial, MeshBasicMaterial, etc.) default to
      // fog: true; nothing else to wire up.
      scene.fog = new THREE.Fog(0x000000, 2.0, 2.5);
      trackPromise = prepTrack(scene, track);
      return trackPromise;
    },

    async startRender() {
      const {
        scene,
        highwayTexture,
        animatedTextureManager,
        sceneOverlays,
        reconciler,
      } = await trackPromise;

      await startRender(
        scene,
        highwayTexture,
        metadata.song_length || 60 * 5 * 1000,
        animatedTextureManager,
        sceneOverlays,
        reconciler,
      );
    },

    destroy: async () => {
      destroyed = true;
      window.removeEventListener('resize', onResize, false);
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      // Dispose animated textures if track was prepared
      if (trackPromise) {
        try {
          const {
            animatedTextureManager,
            sceneOverlays,
            interactionManager,
            reconciler,
            noteRenderer: nr,
          } = await trackPromise;
          animatedTextureManager.dispose();
          sceneOverlays?.dispose();
          interactionManager?.dispose();
          reconciler.dispose();
          nr.dispose();
          MarkerRenderer.clearTextureCache();
        } catch {
          // Ignore errors during cleanup
        }
      }
      // Dispose waveform/grid surfaces
      waveformSurface?.dispose();
      waveformSurface = null;
      gridOverlay?.dispose();
      gridOverlay = null;
      classicHighwayMesh = null;
      lyricsOverlay?.dispose();
      lyricsOverlay = null;
    },
    /** Expose the camera for overlay coordinate mapping (unprojection). */
    getCamera() {
      return camera;
    },
    /** Expose the highway speed constant. */
    getHighwaySpeed() {
      return highwaySpeed;
    },

    // -- Editor overlay integration --

    /**
     * Set the overlay state for the current frame. Called by HighwayEditor
     * whenever overlay-relevant state changes. The render loop reads this
     * every frame.
     */
    setOverlayState(state: OverlayState): void {
      overlayState = state;
    },

    /**
     * Update timing data for SceneOverlays and InteractionManager tick-to-ms conversion.
     * Call when tempos or resolution change.
     */
    async setTimingData(
      timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
      resolution: number,
    ): Promise<void> {
      const {sceneOverlays, interactionManager} = await trackPromise;
      sceneOverlays?.setTimingData(timedTempos, resolution);
      interactionManager?.setTimingData(timedTempos, resolution);
    },

    /**
     * Get the InteractionManager for hit-testing and coordinate conversion.
     */
    async getInteractionManager(): Promise<InteractionManager | null> {
      const {interactionManager} = await trackPromise;
      return interactionManager;
    },

    /**
     * Get the SceneReconciler for declarative element management.
     */
    async getReconciler(): Promise<SceneReconciler> {
      const {reconciler} = await trackPromise;
      return reconciler;
    },

    /**
     * Get the NoteRenderer for overlay state management.
     */
    async getNoteRenderer(): Promise<NoteRenderer> {
      const {noteRenderer} = await trackPromise;
      return noteRenderer;
    },

    // -- Waveform / Grid surface integration --

    /**
     * Set up the waveform surface layer. Must be called after prepTrack.
     * Only applicable for drum tracks.
     */
    async setWaveformData(
      config: Omit<WaveformSurfaceConfig, 'highwayWidth' | 'highwaySpeed'>,
    ): Promise<void> {
      const {scene} = await trackPromise;

      // Dispose previous waveform surface if any
      if (waveformSurface) {
        scene.remove(waveformSurface.getMesh());
        waveformSurface.dispose();
        waveformSurface = null;
      }

      const fullConfig: WaveformSurfaceConfig = {
        ...config,
        // Slightly inset from the highway floor (0.9) so the gray plane
        // frames the waveform — left/right edges of the highway stay
        // visible at a glance.
        highwayWidth: 0.84,
        highwaySpeed,
      };
      waveformSurface = createWaveformSurface(scene, fullConfig);

      // Apply current mode. Keep the classic highway mesh visible
      // beneath the waveform surface so the highway's left/right edges
      // remain framed even while the waveform is showing.
      if (highwayMode === 'waveform') {
        waveformSurface.setVisible(true);
      }
    },

    /**
     * Set up the grid overlay layer. Must be called after prepTrack.
     * Only applicable for drum tracks.
     */
    async setGridData(
      config: Omit<GridOverlayConfig, 'highwayWidth' | 'highwaySpeed'>,
    ): Promise<void> {
      const {scene} = await trackPromise;

      // Dispose previous grid overlay if any
      if (gridOverlay) {
        scene.remove(gridOverlay.getMesh());
        gridOverlay.dispose();
        gridOverlay = null;
      }

      const fullConfig: GridOverlayConfig = {
        ...config,
        highwayWidth: 0.9,
        highwaySpeed,
      };
      gridOverlay = createGridOverlay(scene, fullConfig, noteClippingPlanes);

      // Grid lines always visible (both classic and waveform modes)
      gridOverlay.setVisible(true);
    },

    /**
     * Toggle between waveform and classic highway modes.
     */
    setHighwayMode(mode: HighwayMode): void {
      highwayMode = mode;
      const isWaveform = mode === 'waveform';

      if (waveformSurface) waveformSurface.setVisible(isWaveform);
      if (gridOverlay) gridOverlay.setVisible(true); // always show grid lines
      // Classic highway mesh stays visible in both modes — it provides the
      // gray plane background that frames the highway edges. The waveform
      // surface renders on top of it.
      if (classicHighwayMesh) classicHighwayMesh.visible = true;
    },

    /** Get the current highway mode. */
    getHighwayMode(): HighwayMode {
      return highwayMode;
    },

    /**
     * Push fresh karaoke lyrics + vocal phrases. Called whenever the
     * editor's `parsedChart` updates (lyric flag drag, lyric edit, etc.).
     * Lazy-creates the overlay when the original chart had no lyrics but
     * the user has added at least one — mirrors the prepTrack path.
     */
    async setLyricsData(
      lyrics: {msTime: number; text: string; msLength?: number}[],
      vocalPhrases: {msTime: number; msLength: number}[],
    ): Promise<void> {
      // Wait for prepTrack to finish so we don't race the initial overlay
      // construction. We don't need the resolved value, only the timing.
      await trackPromise;
      if (lyricsOverlay) {
        lyricsOverlay.setLyrics(lyrics, vocalPhrases);
        return;
      }
      if (lyrics.length === 0) return;
      const width = sizingRef.current?.offsetWidth ?? window.innerWidth;
      const height = sizingRef.current?.offsetHeight ?? window.innerHeight;
      lyricsOverlay = new LyricsOverlay(lyrics, vocalPhrases, width, height);
    },
  };

  return methods;

  async function prepTrack(scene: THREE.Scene, track: Track | null) {
    const {highwayTexture} = await initPromise;
    const schema = track ? schemaForTrack(track, chart.drumType) : null;
    // Lanes require both the capability flag and an actual notes track —
    // there's nothing to draw lanes for on a vocals/global scope.
    const lanesActive = showDrumLanes && track != null;

    if (!lanesActive) {
      // Lanes-off mode: the same textured highway floor, but no instrument
      // hitbox and no drum geometry. A plain bar marks the strikeline in
      // the hitbox's place.
      const highway = createHighway(highwayTexture, LANES_OFF_HIGHWAY_WIDTH);
      scene.add(highway);
      classicHighwayMesh = highway;
      scene.add(createPlainStrikeline(LANES_OFF_HIGHWAY_WIDTH));
    } else {
      const highway = createHighway(highwayTexture, schema?.highwayWidth ?? 1);
      scene.add(highway);
      classicHighwayMesh = highway;
      scene.add(
        await loadAndCreateHitBox(
          textureLoader,
          schema?.hitboxTexturePath ?? '/assets/preview/assets/isolated.png',
        ),
      );
    }

    const animatedTextureManager = new AnimatedTextureManager();

    // Load textures (shared between NotesManager and NoteRenderer). Skipped
    // entirely when there's no track (vocals/global scope) — no notes will
    // ever be rendered, so there's no instrument to load textures for.
    const {getTextureForNote} = track
      ? await loadNoteTextures(
          textureLoader,
          track.instrument,
          animatedTextureManager,
          tomStyle,
        )
      : {getTextureForNote: () => new THREE.SpriteMaterial()};

    // Create NoteRenderer for the reconciler
    const noteRenderer = new NoteRenderer(
      getTextureForNote,
      noteClippingPlanes,
      schema ? padLaneColors(schema) : [],
    );

    // Create marker renderers for all marker types
    const sectionRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'right',
      [0, 200, 40],
    );
    const lyricRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'left',
      [40, 120, 255],
    );
    const phraseStartRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'left',
      [40, 120, 255],
    );
    const phraseEndRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'left',
      [40, 120, 255],
    );
    const bpmRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'left',
      [180, 40, 255],
    );
    const tsRenderer = new MarkerRenderer(
      markerClippingPlanes,
      'right',
      [255, 80, 60],
    );

    // Create SceneReconciler with all renderers
    const reconciler = new SceneReconciler(
      scene,
      {
        note: noteRenderer,
        section: sectionRenderer,
        lyric: lyricRenderer,
        'phrase-start': phraseStartRenderer,
        'phrase-end': phraseEndRenderer,
        bpm: bpmRenderer,
        ts: tsRenderer,
      },
      highwaySpeed,
    );

    // Convert track to elements and set on the reconciler. With lanes
    // inactive (no track, or `showDrumLanes` off — e.g. add-lyrics), seed
    // the reconciler empty — HighwayEditor will populate markers from the
    // full ParsedChart and skip notes when that capability is off, so
    // drawing notes here would briefly flash drum geometry on a lanes-off
    // page.
    const elements = lanesActive && track ? trackToElements(track, chart) : [];
    reconciler.setElements(elements);

    // SceneOverlays + InteractionManager are created for any track — they
    // power the cursor / ghost / hit-testing surface for both drum-edit
    // and lanes-off (lyrics) modes. Drum-specific render paths inside them
    // simply have nothing to draw when no drum notes are present. With no
    // track (vocals/global scope), geometry falls back to the 4-lane drum
    // schema — lanesActive is false there so nothing actually renders using
    // it, but the classes still need *some* valid lane geometry to construct.
    const overlaySchema = schema ?? drums4LaneSchema;
    const sceneOverlays = new SceneOverlays(
      scene,
      highwaySpeed,
      noteClippingPlanes,
      overlaySchema,
    );

    const getElapsedMs = () => {
      const currentMs = (audioManager?.chartTime ?? 0) * 1000;
      const delay = (audioManager?.delay || 0) * 1000;
      return currentMs - delay;
    };
    const interactionManager = new InteractionManager(
      camera,
      reconciler,
      highwaySpeed,
      getElapsedMs,
      overlaySchema,
    );

    // Create lyrics overlay if chart has lyrics
    const vocals = chart.vocalTracks.parts['vocals'];
    const chartLyrics = vocals?.notePhrases.flatMap(p => p.lyrics) ?? [];
    if (chartLyrics.length > 0) {
      const width = sizingRef.current?.offsetWidth ?? window.innerWidth;
      const height = sizingRef.current?.offsetHeight ?? window.innerHeight;
      lyricsOverlay = new LyricsOverlay(
        chartLyrics,
        vocals?.notePhrases ?? [],
        width,
        height,
      );
    }

    return {
      scene,
      highwayTexture,
      animatedTextureManager,
      sceneOverlays,
      interactionManager,
      reconciler,
      noteRenderer,
    };
  }

  async function startRender(
    scene: THREE.Scene,
    highwayTexture: THREE.Texture,
    songLength: number,
    animatedTextureManager: AnimatedTextureManager,
    sceneOverlays: SceneOverlays | null,
    reconciler: SceneReconciler,
  ) {
    if (destroyed) return;
    renderer.setAnimationLoop(animation);

    function animation() {
      // Only apply audio latency compensation during active playback.
      // When paused, the highway should show the exact seek position
      // without offset — otherwise resuming creates a visible jump-back.
      const isPlaying = audioManager?.isPlaying && audioManager?.isInitialized;
      const SYNC_MS = isPlaying ? (audioManager?.delay || 0) * 1000 : 0;
      const chartMs = (audioManager?.chartTime ?? 0) * 1000;
      const elapsedTime = chartMs - SYNC_MS;

      if (
        audioManager != null &&
        audioManager.isPlaying &&
        audioManager.isInitialized
      ) {
        // Update animated textures only during playback
        animatedTextureManager.tick();
      }

      // Scroll the highway background texture (always, so it stays in sync after seeking)
      const scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed;
      if (highwayTexture) {
        highwayTexture.offset.y = -1 * scrollPosition;
      }

      // Update note positions via the reconciler (windowing + repositioning)
      reconciler.updateWindow(elapsedTime);

      // Scroll waveform and grid surfaces (always, so they stay in sync when paused)
      if (waveformSurface && highwayMode === 'waveform') {
        // The waveform indexes into raw PCM, so it needs audio time:
        // chart time + chart delay (charts with a song.ini delay start
        // their audio late relative to tick 0).
        const chartDelayMs = (audioManager?.chartDelay ?? 0) * 1000;
        waveformSurface.update(elapsedTime + chartDelayMs);
      }
      if (gridOverlay) {
        gridOverlay.update(elapsedTime);
      }

      // Update scene overlays every frame (works whether playing or paused)
      if (sceneOverlays && overlayState) {
        sceneOverlays.update(elapsedTime, overlayState);
      }

      try {
        renderer.render(scene, camera);

        // Render lyrics overlay on top (second pass, no depth clear)
        if (lyricsOverlay?.update(elapsedTime)) {
          renderer.autoClear = false;
          renderer.render(lyricsOverlay.scene, lyricsOverlay.camera);
          renderer.autoClear = true;
        }
      } catch (e) {
        // Log but don't stop the loop — transient errors (e.g., null material
        // during texture swap) should not permanently kill the renderer.
        console.warn('Highway render error:', e);
      }
    }
  }
};
