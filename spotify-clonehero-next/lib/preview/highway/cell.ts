import * as THREE from 'three';
import {Instrument} from '@eliwhite/scan-chart';
import type {ParsedChart} from '../chorus-chart-processing';
import {
  getHighwayTexture,
  createHighway,
  createPlainStrikeline,
  LANES_OFF_HIGHWAY_WIDTH,
  loadAndCreateHitBox,
} from './HighwayScene';
import {schemaForTrack} from '../../chart-edit/instruments';
import {AnimatedTextureManager, loadNoteTextures} from './TextureManager';
import {SceneReconciler} from './SceneReconciler';
import {NoteRenderer} from './NoteRenderer';
import {MarkerRenderer} from './MarkerRenderer';
import {trackToElements} from './trackToElements';
import {padLaneColors} from './notePlacement';
import type {Note, Track} from './types';

/**
 * The reusable, editor-agnostic core of a single highway scene: the textured
 * floor, the instrument hitbox (or a plain strikeline in lanes-off mode), the
 * note + marker renderers, and a `SceneReconciler` seeded with the track's
 * notes.
 *
 * This is the piece `setupRenderer.prepTrack` composes for its one scene and
 * that `multiCell.ts` composes once per grid cell. Editor-only layers
 * (`SceneOverlays`, `InteractionManager`, lyrics/waveform/grid) live in
 * `prepTrack`, not here — a comparison cell doesn't want them.
 */

/**
 * The two world-space clip planes every highway shares. `note` clips both the
 * bottom (near the strikeline) and the far top; `marker` clips only the top so
 * labels can extend down past the hitline. Numerically identical across cells,
 * so cells may share one set (clipping is evaluated per-render against each
 * cell's own materials).
 */
export interface HighwayClippingPlanes {
  note: THREE.Plane[];
  marker: THREE.Plane[];
}

export function createHighwayClippingPlanes(): HighwayClippingPlanes {
  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
  return {
    note: [highwayBeginningPlane, highwayEndPlane],
    marker: [highwayEndPlane],
  };
}

/**
 * The texture-dependent inputs a cell renders from. In `setupRenderer` these
 * are per-instance; in `multiCell.ts` one set is shared across every cell that
 * uses the same instrument + tomStyle (see `loadCellTextures`).
 *
 * `highwayTexture.offset.y` is mutated every frame to scroll the floor, so a
 * shared instance requires the offset to be re-set immediately before each
 * cell's own render (renders within a frame are sequential).
 */
export interface CellTextures {
  highwayTexture: THREE.Texture;
  getTextureForNote: (
    note: Note,
    opts: {inStarPower: boolean},
  ) => THREE.SpriteMaterial;
  animatedTextureManager: AnimatedTextureManager;
}

/**
 * Load one shareable texture set: the scrolling highway floor, the animated
 * note textures for `instrument` (registered into a fresh
 * `AnimatedTextureManager`), and the `getTextureForNote` lookup. `instrument`
 * is null for note-less scopes (vocals/global) — a no-op lookup is returned.
 */
export async function loadCellTextures(
  textureLoader: THREE.TextureLoader,
  instrument: Instrument | null,
  tomStyle: 'square' | 'round' = 'square',
): Promise<CellTextures> {
  const animatedTextureManager = new AnimatedTextureManager();
  const highwayTexture = await getHighwayTexture(textureLoader);
  const {getTextureForNote} = instrument
    ? await loadNoteTextures(
        textureLoader,
        instrument,
        animatedTextureManager,
        tomStyle,
      )
    : {getTextureForNote: () => new THREE.SpriteMaterial()};
  return {highwayTexture, getTextureForNote, animatedTextureManager};
}

/** The per-marker-kind renderers a highway scene registers. */
export interface CellMarkerRenderers {
  section: MarkerRenderer;
  lyric: MarkerRenderer;
  phraseStart: MarkerRenderer;
  phraseEnd: MarkerRenderer;
  bpm: MarkerRenderer;
  ts: MarkerRenderer;
}

/** The reusable scene core `buildHighwayCell` returns. */
export interface HighwayCellCore {
  /** The classic textured floor mesh (caller may toggle its visibility). */
  highway: THREE.Mesh;
  reconciler: SceneReconciler;
  noteRenderer: NoteRenderer;
  markerRenderers: CellMarkerRenderers;
}

export interface BuildHighwayCellParams {
  chart: ParsedChart;
  /** Null for scopes with no notes track (vocals/global). */
  track: Track | null;
  textureLoader: THREE.TextureLoader;
  textures: CellTextures;
  clippingPlanes: HighwayClippingPlanes;
  highwaySpeed: number;
  /** When false, render the neutral floor + strikeline and skip lanes/notes. */
  showDrumLanes: boolean;
}

/**
 * Build the highway floor + hitbox/strikeline + note/marker renderers +
 * reconciler into `scene`, seeding the reconciler with the track's notes.
 * Adds meshes to `scene` as a side effect and returns the handles the caller
 * needs for per-frame updates and teardown.
 */
export async function buildHighwayCell(
  scene: THREE.Scene,
  params: BuildHighwayCellParams,
): Promise<HighwayCellCore> {
  const {chart, track, textureLoader, textures, clippingPlanes, highwaySpeed} =
    params;
  const schema = track ? schemaForTrack(track, chart.drumType) : null;
  // Lanes require both the capability flag and an actual notes track — there's
  // nothing to draw lanes for on a vocals/global scope.
  const lanesActive = params.showDrumLanes && track != null;

  let highway: THREE.Mesh;
  if (!lanesActive) {
    // Lanes-off: the same textured floor, no hitbox, a plain strikeline bar.
    highway = createHighway(textures.highwayTexture, LANES_OFF_HIGHWAY_WIDTH);
    scene.add(highway);
    scene.add(createPlainStrikeline(LANES_OFF_HIGHWAY_WIDTH));
  } else {
    highway = createHighway(textures.highwayTexture, schema?.highwayWidth ?? 1);
    scene.add(highway);
    scene.add(
      await loadAndCreateHitBox(
        textureLoader,
        schema?.hitboxTexturePath ?? '/assets/preview/assets/isolated.png',
      ),
    );
  }

  const noteRenderer = new NoteRenderer(
    textures.getTextureForNote,
    clippingPlanes.note,
    schema ? padLaneColors(schema) : [],
  );

  const markerRenderers: CellMarkerRenderers = {
    section: new MarkerRenderer(clippingPlanes.marker, 'right', [0, 200, 40]),
    lyric: new MarkerRenderer(clippingPlanes.marker, 'left', [40, 120, 255]),
    phraseStart: new MarkerRenderer(
      clippingPlanes.marker,
      'left',
      [40, 120, 255],
    ),
    phraseEnd: new MarkerRenderer(
      clippingPlanes.marker,
      'left',
      [40, 120, 255],
    ),
    bpm: new MarkerRenderer(clippingPlanes.marker, 'left', [180, 40, 255]),
    ts: new MarkerRenderer(clippingPlanes.marker, 'right', [255, 80, 60]),
  };

  const reconciler = new SceneReconciler(
    scene,
    {
      note: noteRenderer,
      section: markerRenderers.section,
      lyric: markerRenderers.lyric,
      'phrase-start': markerRenderers.phraseStart,
      'phrase-end': markerRenderers.phraseEnd,
      bpm: markerRenderers.bpm,
      ts: markerRenderers.ts,
    },
    highwaySpeed,
  );

  // With lanes inactive, seed empty — HighwayEditor populates markers from the
  // full ParsedChart and skips notes when that capability is off, so drawing
  // notes here would briefly flash drum geometry on a lanes-off page.
  const elements = lanesActive && track ? trackToElements(track, chart) : [];
  reconciler.setElements(elements);

  return {highway, reconciler, noteRenderer, markerRenderers};
}
