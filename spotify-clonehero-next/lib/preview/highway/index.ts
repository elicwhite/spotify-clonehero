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
import {NotesManager} from './NotesManager';
import {AnimatedTextureManager} from './TextureManager';
import {SceneOverlays, type OverlayState} from './SceneOverlays';
import {InteractionManager} from './InteractionManager';
import type {Track} from './types';

// Re-export public types, constants, and utilities
export {type SelectedTrack, type Song, type HitResult, type PreparedNote, SCALE, NOTE_SPAN_WIDTH, PAD_TO_HIGHWAY_LANE, calculateNoteXOffset} from './types';
export {NotesManager, type NotesDiff} from './NotesManager';
export {areAnimationsSupported} from './TextureManager';
export {SceneOverlays, type OverlayState, type SectionData} from './SceneOverlays';
export {InteractionManager} from './InteractionManager';
export {type HighwayMode} from './HighwayScene';

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

  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.localClippingEnabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  function setSize() {
    const width = sizingRef.current?.offsetWidth ?? window.innerWidth;
    const height = sizingRef.current?.offsetHeight ?? window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
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
      console.log('track', track);
      return trackPromise;
    },

    async startRender() {
      const {scene, notesManager, highwayTexture, animatedTextureManager, sceneOverlays} =
        await trackPromise;

      await startRender(
        scene,
        highwayTexture,
        notesManager,
        metadata.song_length || 60 * 5 * 1000,
        animatedTextureManager,
        sceneOverlays,
      );
    },

    destroy: async () => {
      console.log('Tearing down the renderer');
      window.removeEventListener('resize', onResize, false);
      renderer.setAnimationLoop(null);
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      // Dispose animated textures if track was prepared
      if (trackPromise) {
        try {
          const {animatedTextureManager, sceneOverlays, interactionManager} = await trackPromise;
          animatedTextureManager.dispose();
          sceneOverlays?.dispose();
          interactionManager?.dispose();
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
     * Get the NotesManager for setting selection/confidence/review state.
     */
    async getNotesManager(): Promise<NotesManager> {
      const {notesManager} = await trackPromise;
      return notesManager;
    },

    /**
     * Get the InteractionManager for hit-testing and coordinate conversion.
     */
    async getInteractionManager(): Promise<InteractionManager | null> {
      const {interactionManager} = await trackPromise;
      return interactionManager;
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

    const notesManager = new NotesManager(
      scene,
      track.instrument,
      highwaySpeed,
      clippingPlanes,
    );
    await notesManager.prepare(textureLoader, track, animatedTextureManager);

    // Create SceneOverlays for drum tracks (editor use)
    const sceneOverlays = track.instrument === 'drums'
      ? new SceneOverlays(scene, highwaySpeed, clippingPlanes)
      : null;

    // Create InteractionManager for drum tracks (editor use)
    const getElapsedMs = () => {
      const currentMs = (audioManager?.currentTime ?? 0) * 1000;
      const delay = (audioManager?.delay || 0) * 1000;
      return currentMs - delay;
    };
    const interactionManager = track.instrument === 'drums'
      ? new InteractionManager(
          camera,
          notesManager,
          sceneOverlays,
          highwaySpeed,
          getElapsedMs,
        )
      : null;

    return {
      scene,
      highwayTexture,
      notesManager,
      animatedTextureManager,
      sceneOverlays,
      interactionManager,
    };
  }

  async function startRender(
    scene: THREE.Scene,
    highwayTexture: THREE.Texture,
    notesManager: NotesManager,
    songLength: number,
    animatedTextureManager: AnimatedTextureManager,
    sceneOverlays: SceneOverlays | null,
  ) {
    renderer.setAnimationLoop(animation);

    function animation() {
      const SYNC_MS = (audioManager?.delay || 0) * 1000;
      const durationMs = (audioManager?.duration ?? Infinity) * 1000;
      const rawMs = (audioManager?.currentTime ?? 0) * 1000;
      const currentMs = Math.min(rawMs, durationMs);
      const elapsedTime = currentMs - SYNC_MS;

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

      // Always update note positions (editor needs this when paused too)
      notesManager.updateDisplayedNotes(elapsedTime);

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
      } catch (e) {
        // Log but don't stop the loop — transient errors (e.g., null material
        // during texture swap) should not permanently kill the renderer.
        console.warn('Highway render error:', e);
      }
    }
  }
};
