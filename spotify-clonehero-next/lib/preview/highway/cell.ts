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
import {
  schemaForTrack,
  type InstrumentSchema,
} from '../../chart-edit/instruments';
import {
  AnimatedTextureManager,
  loadHighwayFlameTextures,
  loadHighwayFretTextures,
  loadHighwaySustainTextures,
  loadNoteTextures,
  type HighwayFlameTextures,
  type HighwayFretTextures,
  type HighwaySustainTextures,
} from './TextureManager';
import {SceneReconciler, type ElementRenderer} from './SceneReconciler';
import {NoteRenderer} from './NoteRenderer';
import {trackToElements} from './trackToElements';
import {sustainStyleForSchema} from './notePlacement';
import type {Note, Track} from './types';

/**
 * The reusable, editor-agnostic core of a single highway scene: the textured
 * floor, the instrument hitbox (or a plain strikeline in lanes-off mode), the
 * note renderer, and a `SceneReconciler` seeded with the track's notes.
 *
 * This is the piece `setupRenderer.prepTrack` composes for its one scene.
 * Editor-only layers (`SceneOverlays`, `InteractionManager`,
 * lyrics/waveform/grid) live in `prepTrack`, not here.
 */

/**
 * The world-space clip planes every highway shares. `note` clips both the
 * bottom (near the strikeline) and the far top. Numerically identical across
 * cells, so cells may share one set (clipping is evaluated per-render against
 * each cell's own materials).
 */
export interface HighwayClippingPlanes {
  note: THREE.Plane[];
}

/**
 * The playline is at y=-1, but the classic highway floor continues another
 * tenth of a world unit below it. Five-fret hit flames are allowed to enter
 * that area, while main note heads and sustain tails get the original
 * playline clip separately. Drums intentionally keep their existing y=-1 clip
 * plane for every layer.
 */
const FIVE_FRET_NOTE_BOTTOM_CLIP_Y = -1.1;

export function noteClippingPlanesForTrack(
  track: Pick<Track, 'instrument'> | null,
  clippingPlanes: HighwayClippingPlanes,
): THREE.Plane[] {
  if (track?.instrument !== 'guitar' && track?.instrument !== 'bass') {
    return clippingPlanes.note;
  }

  return [
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -FIVE_FRET_NOTE_BOTTOM_CLIP_Y),
    ...clippingPlanes.note.slice(1),
  ];
}

export function createHighwayClippingPlanes(): HighwayClippingPlanes {
  const highwayBeginningPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1);
  const highwayEndPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.9);
  return {
    note: [highwayBeginningPlane, highwayEndPlane],
  };
}

/**
 * The texture-dependent inputs a cell renders from, one instance per
 * `setupRenderer` (see `loadCellTextures`).
 *
 * `highwayTexture.offset.y` is mutated every frame to scroll the floor, so
 * sharing one instance across cells would require the offset to be re-set
 * immediately before each cell's own render (renders within a frame are
 * sequential).
 */
export interface CellTextures {
  highwayTexture: THREE.Texture;
  sustainTextures: HighwaySustainTextures | null;
  flameTextures: HighwayFlameTextures | null;
  fretTextures: HighwayFretTextures | null;
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
  const [highwayTexture, sustainTextures, flameTextures, fretTextures] =
    await Promise.all([
      getHighwayTexture(textureLoader),
      instrument === 'guitar' || instrument === 'bass'
        ? loadHighwaySustainTextures(textureLoader, animatedTextureManager)
        : Promise.resolve(null),
      instrument === 'guitar' || instrument === 'bass' || instrument === 'drums'
        ? loadHighwayFlameTextures(textureLoader, animatedTextureManager)
        : Promise.resolve(null),
      instrument === 'guitar' || instrument === 'bass' || instrument === 'drums'
        ? loadHighwayFretTextures(textureLoader, animatedTextureManager)
        : Promise.resolve(null),
    ]);
  const {getTextureForNote} = instrument
    ? await loadNoteTextures(
        textureLoader,
        instrument,
        animatedTextureManager,
        tomStyle,
      )
    : {getTextureForNote: () => new THREE.SpriteMaterial()};
  return {
    highwayTexture,
    sustainTextures,
    flameTextures,
    fretTextures,
    getTextureForNote,
    animatedTextureManager,
  };
}

/**
 * Every texture set on one stage, loaded once each and shared.
 *
 * A stage draws its highways as separate passes over one canvas, and they all
 * show the same art — the same scrolling floor, the same flames, the same
 * fret buttons — while two difficulties of one instrument also share their
 * note sprites. A set per highway meant a private copy of every animated
 * texture, each redrawn into its own canvas and re-uploaded to the GPU every
 * frame, four times over for the same picture.
 *
 * Sharing is safe because nothing here is written to per highway. The floor's
 * scroll offset is derived from the frame's elapsed time, which every pass in
 * a frame shares, and a note's material is already shared by every note of
 * its type within a highway.
 *
 * The stage owns this and disposes it; a highway that goes away must not take
 * the art its neighbours are still drawing with.
 */
export class SharedCellTextures {
  private readonly manager = new AnimatedTextureManager();
  private highway: Promise<THREE.Texture> | null = null;
  private sustains: Promise<HighwaySustainTextures> | null = null;
  private flames: Promise<HighwayFlameTextures> | null = null;
  private frets: Promise<HighwayFretTextures> | null = null;
  private readonly notes = new Map<
    string,
    Promise<{getTextureForNote: CellTextures['getTextureForNote']}>
  >();
  private disposed = false;

  constructor(
    private readonly textureLoader: THREE.TextureLoader,
    private readonly tomStyle: 'square' | 'round' = 'square',
  ) {}

  /**
   * The set one highway needs. Gated by instrument exactly as a private set
   * was, so a highway is still handed `null` for art its instrument never
   * draws with.
   */
  async forInstrument(instrument: Instrument | null): Promise<CellTextures> {
    const fretted = instrument === 'guitar' || instrument === 'bass';
    const padded = fretted || instrument === 'drums';
    const [highwayTexture, sustainTextures, flameTextures, fretTextures] =
      await Promise.all([
        (this.highway ??= getHighwayTexture(this.textureLoader)),
        fretted
          ? (this.sustains ??= loadHighwaySustainTextures(
              this.textureLoader,
              this.manager,
            ))
          : null,
        padded
          ? (this.flames ??= loadHighwayFlameTextures(
              this.textureLoader,
              this.manager,
            ))
          : null,
        padded
          ? (this.frets ??= loadHighwayFretTextures(
              this.textureLoader,
              this.manager,
            ))
          : null,
      ]);
    const {getTextureForNote} = instrument
      ? await this.noteTextures(instrument)
      : {getTextureForNote: () => new THREE.SpriteMaterial()};
    return {
      highwayTexture,
      sustainTextures,
      flameTextures,
      fretTextures,
      getTextureForNote,
      animatedTextureManager: this.manager,
    };
  }

  private noteTextures(
    instrument: Instrument,
  ): Promise<{getTextureForNote: CellTextures['getTextureForNote']}> {
    const key = `${instrument}|${this.tomStyle}`;
    let loaded = this.notes.get(key);
    if (loaded === undefined) {
      loaded = loadNoteTextures(
        this.textureLoader,
        instrument,
        this.manager,
        this.tomStyle,
      );
      this.notes.set(key, loaded);
    }
    return loaded;
  }

  /** Advance every animated texture on the stage. Once a frame, not once a
   *  highway — they are the same textures. */
  tick(): void {
    if (!this.disposed) this.manager.tick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.dispose();
    // A load still in flight when the stage goes away still has to be handed
    // back, so dispose on arrival rather than dropping it.
    void this.highway?.then(texture => texture.dispose()).catch(() => {});
    this.highway = null;
    this.sustains = null;
    this.flames = null;
    this.frets = null;
    this.notes.clear();
  }
}

/**
 * What a highway draws: notes. Beat/measure grid lines come from
 * `GridOverlay`, which is geometry rather than an element kind. Every marker
 * kind — section, tempo, time-signature, lyric, phrase — belongs to the piano
 * roll, whose section strip, tempo lane, and lyrics row are where markers are
 * read and edited.
 *
 * This is the single enforcement point. It types the reconciler's renderer
 * map below (so a renderer for another kind cannot be registered) and is
 * handed to the reconciler as its accepted-kind allowlist (so an element of
 * another kind is never stored, windowed, or hit-tested), which lets callers
 * push the whole chart projection without filtering it first.
 */
export type HighwayElementKind = 'note';

export const HIGHWAY_ELEMENT_KINDS: ReadonlySet<HighwayElementKind> =
  new Set<HighwayElementKind>(['note']);

/** The reusable scene core `buildHighwayCell` returns. */
export interface HighwayCellCore {
  /** The classic textured floor mesh (caller may toggle its visibility). */
  highway: THREE.Mesh;
  reconciler: SceneReconciler;
  noteRenderer: NoteRenderer;
  /**
   * Remove the meshes this cell added to `root` (the floor plus the hitbox or
   * plain strikeline) and release their geometry, materials, and the textures
   * those materials loaded. The scrolling floor texture is not touched: it
   * belongs to `CellTextures`, so `disposeCellTextures` releases it.
   *
   * A stage keeps one long-lived context across highway churn, so a removed
   * highway's GPU memory is only reclaimed if the highway hands it back.
   */
  disposeMeshes(): void;
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
  /**
   * Lane geometry to draw when the scope has no track of its own — an empty
   * highway that should still look like one. Display only: it gives the
   * floor its frets and width, and never makes the lane editable.
   */
  neutralLaneSchema?: InstrumentSchema | null;
}

/**
 * Build the highway floor + hitbox/strikeline + note renderer +
 * reconciler into `root`, seeding the reconciler with the track's notes.
 * `root` is any `Object3D` — a scene for a single-highway renderer, or a
 * highway group inside a shared scene. Adds meshes to `root` as a side effect
 * and returns the handles the caller needs for per-frame updates and
 * teardown.
 */
export async function buildHighwayCell(
  root: THREE.Object3D,
  params: BuildHighwayCellParams,
): Promise<HighwayCellCore> {
  const {chart, track, textureLoader, textures, clippingPlanes, highwaySpeed} =
    params;
  const trackSchema = track ? schemaForTrack(track, chart.drumType) : null;
  // The geometry drawn, which is not the same question as which track is
  // editable: a scope with no track can still ask for lanes to draw.
  const schema = trackSchema ?? params.neutralLaneSchema ?? null;
  const noteClippingPlanes = noteClippingPlanesForTrack(track, clippingPlanes);
  const lanesActive = params.showDrumLanes && schema != null;
  const fretLanes = schema?.lanes
    .filter(lane => !lane.fullWidth)
    .sort((a, b) => a.index - b.index);
  const fretConfig =
    fretLanes && (fretLanes.length === 4 || fretLanes.length === 5)
      ? {
          laneXs: fretLanes.map(lane => lane.worldXOffset),
          laneColors: fretLanes.map(lane => lane.color),
          // Drum pads sit flat on the strikeline; the raised pick arc behind
          // the button belongs to the fretted instruments only.
          showPick: schema?.instrument !== 'drums',
        }
      : null;

  const ownedMeshes: THREE.Object3D[] = [];
  let highway: THREE.Mesh;
  if (!lanesActive) {
    // Lanes-off: the same textured floor, no hitbox, a plain strikeline bar.
    highway = createHighway(textures.highwayTexture, LANES_OFF_HIGHWAY_WIDTH);
    ownedMeshes.push(highway, createPlainStrikeline(LANES_OFF_HIGHWAY_WIDTH));
  } else {
    highway = createHighway(textures.highwayTexture, schema?.highwayWidth ?? 1);
    ownedMeshes.push(
      highway,
      await loadAndCreateHitBox(
        textureLoader,
        schema?.hitboxTexturePath ?? '/assets/preview/assets/isolated.png',
        textures.fretTextures,
        fretConfig,
      ),
    );
  }
  for (const mesh of ownedMeshes) root.add(mesh);

  const sustainStyle = schema
    ? sustainStyleForSchema(schema)
    : {padColors: [], fullWidthColor: '#FFFFFF', fullWidthWidthMultiplier: 1};
  const noteRenderer = new NoteRenderer(
    textures.getTextureForNote,
    noteClippingPlanes,
    sustainStyle.padColors,
    sustainStyle.fullWidthColor,
    sustainStyle.fullWidthWidthMultiplier,
    highwaySpeed,
    textures.sustainTextures,
    textures.flameTextures,
    clippingPlanes.note,
  );

  const renderers: Record<HighwayElementKind, ElementRenderer> = {
    note: noteRenderer,
  };

  const reconciler = new SceneReconciler(
    root,
    renderers,
    highwaySpeed,
    HIGHWAY_ELEMENT_KINDS,
  );

  // With lanes inactive, seed empty — HighwayEditor skips notes when that
  // capability is off, so drawing notes here would briefly flash drum geometry
  // on a lanes-off page.
  const elements = lanesActive && track ? trackToElements(track, chart) : [];
  reconciler.setElements(elements);

  function disposeMeshes(): void {
    for (const mesh of ownedMeshes) {
      root.remove(mesh);
      disposeObjectTree(mesh, textures.highwayTexture);
    }
    ownedMeshes.length = 0;
  }

  return {highway, reconciler, noteRenderer, disposeMeshes};
}

/**
 * Release the geometry, materials, and material textures of `object` and every
 * descendant. `sharedTexture` is left alone: the scrolling floor texture is
 * owned by `CellTextures`, not by the mesh that samples it.
 */
function disposeObjectTree(
  object: THREE.Object3D,
  sharedTexture: THREE.Texture,
): void {
  if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
    // Every sprite in the scene shares one module-scoped geometry inside
    // THREE, so only a mesh's own geometry may be released here.
    if (object instanceof THREE.Mesh) object.geometry?.dispose();
    const material = object.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    for (const mat of Array.isArray(material) ? material : [material]) {
      if (!mat) continue;
      const map = (mat as {map?: THREE.Texture | null}).map;
      if (map && map !== sharedTexture) map.dispose();
      mat.dispose();
    }
  }
  for (const child of [...object.children]) {
    disposeObjectTree(child, sharedTexture);
  }
}

/**
 * Release the textures one highway loaded for itself. Every `CellTextures` set
 * comes from its own `loadCellTextures` call, so nothing here is shared with
 * another highway.
 */
export function disposeCellTextures(textures: CellTextures): void {
  textures.animatedTextureManager.dispose();
  textures.highwayTexture.dispose();
}
