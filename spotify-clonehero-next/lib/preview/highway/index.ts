import {RefObject} from 'react';
import * as THREE from 'three';
import type {ParsedChart} from '../chorus-chart-processing';
import {ChartResponseEncore} from '../../chartSelection';
import {AudioManager} from '../audioManager';
import {
  getHighwayTexture,
  createHighway,
  createDrumHighway,
  loadAndCreateHitBox,
  loadAndCreateDrumHitBox,
  createWaveformSurface,
  createGridOverlay,
  type HighwayMode,
} from './HighwayScene';
import type {WaveformSurface} from './WaveformSurface';
import type {WaveformSurfaceConfig} from './WaveformSurface';
import type {GridOverlay} from './GridOverlay';
import type {GridOverlayConfig} from './GridOverlay';
import {AnimatedTextureManager, loadNoteTextures} from './TextureManager';
import {SceneOverlays, type OverlayState} from './SceneOverlays';
import {InteractionManager} from './InteractionManager';
import {SceneReconciler, type ChartElement} from './SceneReconciler';
import {NoteRenderer} from './NoteRenderer';
import {MarkerRenderer} from './MarkerRenderer';
import {trackToElements} from './trackToElements';
import {chartToElements} from './chartToElements';
import {LyricsOverlay} from './LyricsOverlay';
import type {Track} from './types';

// Re-export public types, constants, and utilities
export {type SelectedTrack, type Song, type HitResult, type PreparedNote, SCALE, NOTE_SPAN_WIDTH, PAD_TO_HIGHWAY_LANE, calculateNoteXOffset} from './types';
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

let instanceCounter = 0;

// ---------------------------------------------------------------------------
// Interpolation helper (maps a value from one range to another)
// ---------------------------------------------------------------------------
function interpolate(
  val: number,
  fromStart: number,
  fromEnd: number,
  toStart: number,
  toEnd: number,
): number {
  return (
    ((val - fromStart) / (fromEnd - fromStart)) * (toEnd - toStart) + toStart
  );
}

// ---------------------------------------------------------------------------
// setupRenderer (public API -- signature unchanged)
// ---------------------------------------------------------------------------

export const setupRenderer = (
  metadata: ChartResponseEncore,
  chart: ParsedChart,
  sizingRef: RefObject<HTMLDivElement>,
  ref: RefObject<HTMLDivElement>,
  audioManager: AudioManager,
) => {
  instanceCounter++;
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

  ref.current?.children.item(0)?.remove();
  ref.current?.appendChild(renderer.domElement);

  const textureLoader = new THREE.TextureLoader();

  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
  const clippingPlanes = [highwayBeginningPlane, highwayEndPlane];

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
    prepTrack(track: Track) {
      const scene = new THREE.Scene();
      trackPromise = prepTrack(scene, track);
      return trackPromise;
    },

    async startRender() {
      const {scene, highwayTexture, animatedTextureManager, sceneOverlays, reconciler, noteRenderer} =
        await trackPromise;

      await startRender(
        scene,
        highwayTexture,
        metadata.song_length || 60 * 5 * 1000,
        animatedTextureManager,
        sceneOverlays,
        reconciler,
        noteRenderer,
      );
    },

    destroy: async () => {
      destroyed = true;
      window.removeEventListener('resize', onResize, false);
      renderer.setAnimationLoop(null);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      // Dispose animated textures if track was prepared
      if (trackPromise) {
        try {
          const {animatedTextureManager, sceneOverlays, interactionManager, reconciler, noteRenderer: nr} = await trackPromise;
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
    async setWaveformData(config: Omit<WaveformSurfaceConfig, 'highwayWidth' | 'highwaySpeed'>): Promise<void> {
      const {scene} = await trackPromise;

      // Dispose previous waveform surface if any
      if (waveformSurface) {
        scene.remove(waveformSurface.getMesh());
        waveformSurface.dispose();
        waveformSurface = null;
      }

      const fullConfig: WaveformSurfaceConfig = {
        ...config,
        highwayWidth: 0.9, // drum highway width
        highwaySpeed,
      };
      waveformSurface = createWaveformSurface(scene, fullConfig);

      // Apply current mode
      if (highwayMode === 'waveform') {
        waveformSurface.setVisible(true);
        if (classicHighwayMesh) classicHighwayMesh.visible = false;
      }
    },

    /**
     * Set up the grid overlay layer. Must be called after prepTrack.
     * Only applicable for drum tracks.
     */
    async setGridData(config: Omit<GridOverlayConfig, 'highwayWidth' | 'highwaySpeed'>): Promise<void> {
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
      gridOverlay = createGridOverlay(scene, fullConfig, clippingPlanes);

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
      if (classicHighwayMesh) classicHighwayMesh.visible = !isWaveform;
    },

    /** Get the current highway mode. */
    getHighwayMode(): HighwayMode {
      return highwayMode;
    },
  };

  return methods;

  async function prepTrack(scene: THREE.Scene, track: Track) {
    const {highwayTexture} = await initPromise;

    if (track.instrument === 'drums') {
      const drumHighway = createDrumHighway(highwayTexture);
      scene.add(drumHighway);
      classicHighwayMesh = drumHighway;
      scene.add(await loadAndCreateDrumHitBox(textureLoader));
    } else {
      scene.add(createHighway(highwayTexture));
      scene.add(await loadAndCreateHitBox(textureLoader));
    }

    const animatedTextureManager = new AnimatedTextureManager();

    // Load textures (shared between NotesManager and NoteRenderer)
    const {getTextureForNote} = await loadNoteTextures(
      textureLoader,
      track.instrument,
      animatedTextureManager,
    );

    // Create NoteRenderer for the reconciler
    const noteRenderer = new NoteRenderer(getTextureForNote, clippingPlanes);

    // Create marker renderers for all marker types
    const sectionRenderer = new MarkerRenderer(clippingPlanes, 'right', [0, 200, 40]);
    const lyricRenderer = new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]);
    const phraseStartRenderer = new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]);
    const phraseEndRenderer = new MarkerRenderer(clippingPlanes, 'left', [40, 120, 255]);
    const bpmRenderer = new MarkerRenderer(clippingPlanes, 'left', [180, 40, 255]);
    const tsRenderer = new MarkerRenderer(clippingPlanes, 'right', [255, 80, 60]);

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

    // Convert track to elements and set on the reconciler
    // (notes only -- chartToElements requires the full ParsedChart,
    // which is provided by useEditCommands when the chart loads)
    const elements = trackToElements(track);
    reconciler.setElements(elements);

    // Create SceneOverlays for drum tracks (editor use)
    const sceneOverlays = track.instrument === 'drums'
      ? new SceneOverlays(scene, highwaySpeed, clippingPlanes)
      : null;

    // Create InteractionManager for drum tracks (editor use)
    const getElapsedMs = () => {
      const currentMs = (audioManager?.chartTime ?? 0) * 1000;
      const delay = (audioManager?.delay || 0) * 1000;
      return currentMs - delay;
    };
    const interactionManager = track.instrument === 'drums'
      ? new InteractionManager(
          camera,
          reconciler,
          highwaySpeed,
          getElapsedMs,
        )
      : null;

    // Create lyrics overlay if chart has lyrics
    const vocals = chart.vocalTracks.parts.vocals;
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
    noteRenderer: NoteRenderer,
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
      const prevActiveCount = reconciler.getActiveGroups().size;
      reconciler.updateWindow(elapsedTime);
      // Mark overlays dirty when notes enter/leave the window
      if (reconciler.getActiveGroups().size !== prevActiveCount) {
        noteRenderer.markOverlaysDirty();
      }

      // Update note overlays only when overlay state changed (selection, hover, etc.)
      if (noteRenderer.consumeOverlaysDirty()) {
        for (const [key, group] of reconciler.getActiveGroups()) {
          const el = reconciler.getElement(key);
          if (el && el.kind === 'note') {
            noteRenderer.updateOverlays(group, key, el.data as import('./NoteRenderer').NoteElementData);
          }
        }
      }

      // Scroll waveform and grid surfaces (always, so they stay in sync when paused)
      if (waveformSurface && highwayMode === 'waveform') {
        waveformSurface.update(elapsedTime);
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
