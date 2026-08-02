import * as THREE from 'three';
import type {ElementRenderer} from './SceneReconciler';
import {
  createHighwaySustainGeometry,
  FRETTED_SUSTAIN_WIDTH_MULTIPLIER,
  highwaySustainWorldHeight,
} from './sustainGeometry';
import type {
  HighwayFlameTextures,
  HighwaySustainTextures,
} from './TextureManager';
import {
  HIGHWAY_FLAME_DURATION_MS,
  HIGHWAY_FLAME_FRAME_DURATION_MS,
  HIGHWAY_OPEN_FLAME_DURATION_MS,
  OPEN_NOTE_ANCHOR_Y,
  SCALE,
  type Note,
} from './types';

// ---------------------------------------------------------------------------
// NoteElementData -- the data payload for note elements
// ---------------------------------------------------------------------------

export interface NoteElementData {
  /** The original scan-chart note object (needed for texture lookup). */
  note: Note;
  /** Pre-computed X position in world space. */
  xPosition: number;
  /** Whether this note falls inside a star power section. */
  inStarPower: boolean;
  /** True if this is a kick drum note. */
  isKick: boolean;
  /** True if this is an open guitar note. */
  isOpen: boolean;
  /** Lane index (for sustain colour lookup) -- -1 for kick/open. */
  lane: number;
  /** Schema/editor lane index, including the full-width Open/Kick lane. */
  editorLane?: number;
  /** Sustain length in ms. */
  msLength: number;
}

/**
 * Child indices within a note group:
 * [0] = main note sprite
 * [1] = sustain tail mesh (optional, guitar only)
 * [2] = selection highlight mesh (optional)
 */
const SELECTION_ROLE = 'selection-highlight';
const FLAME_ROLE = 'playline-flame';
const CHILD_SELECTION = 2;
const FLAME_PIVOT_Y = 0.2;
// The open guitar flame's white arch is the visual continuation of the fret's
// raised top curve, not the center of the source image. The source has enough
// transparent/flame detail below that curve that using .5 leaves the arch
// visibly low against the hitline.
const OPEN_FLAME_PIVOT_Y = 0.36;
const FLAME_HEIGHT = SCALE * 2.2;
// The source open flame is divided into five equal arches. Five times the
// authored guitar lane spacing makes those arch centers land on the five
// fret centers instead of stretching past the outer buttons.
const OPEN_FLAME_WIDTH = 0.193 * 5;
// `open_flame_drum.png` has four arches matching the four strip-lane drum
// hitline. Kick is the drum track's full-width note, so use that span.
const DRUM_OPEN_FLAME_WIDTH = 0.169 * 4;

/** Height of the horizontal kick bar sprite (vertically centered on the beat line). */
const KICK_SCALE = 0.045;
/**
 * Anchor for non-kick gem sprites: places the gem's visible bottom edge level
 * with the bottom edge of the kick bar (half a kick height below the beat
 * line), so gems appear to sit on the line instead of straddling it.
 * center.y is the normalized point (0 = bottom) that coincides with the beat
 * line; the extra half-kick compensates for transparent padding at the bottom
 * of the gem texture, which otherwise leaves the visible bottom on the line.
 */
const GEM_ANCHOR_Y = KICK_SCALE / SCALE;

// ---------------------------------------------------------------------------
// NoteRenderer
// ---------------------------------------------------------------------------

/**
 * ElementRenderer for note chart elements.
 *
 * Handles creating note sprites (drums and guitar), sustain tails,
 * and overlay decorations (selection, hover).
 */
export class NoteRenderer implements ElementRenderer<NoteElementData> {
  private getTextureForNote: (
    note: Note,
    opts: {inStarPower: boolean},
  ) => THREE.SpriteMaterial;
  private clippingPlanes: THREE.Plane[];
  /** Main note heads and sustain tails stop at the playline. */
  private noteSpriteClippingPlanes: THREE.Plane[];
  /** Sustain tail color per pad lane index, sourced from the active
   *  `InstrumentSchema`'s `lanes[].color` (five-fret only -- drums don't
   *  support sustain, so this stays empty for drum tracks). */
  private laneColors: string[];
  private fullWidthLaneColor: string;
  private fullWidthSustainWidthMultiplier: number;
  private highwaySpeed: number;
  private sustainTextures: HighwaySustainTextures | null;
  private flameTextures: HighwayFlameTextures | null;

  // Instance-level overlay materials (not module-level singletons).
  // Using instance fields ensures clippingPlanes reference stays valid
  // across renderer destruction/recreation (e.g., HMR, chart reload).
  //
  // Three shared highlight materials cover the three visible states:
  //   - hover-only       : opacity 0.25
  //   - selected-only    : opacity 0.35
  //   - selected+hovered : opacity 0.60
  // setHovered/setSelected swap a per-group highlight mesh's material
  // reference between these three (or hide the mesh when neither flag is
  // set). Geometry is shared.
  private highlightMaterialHover: THREE.MeshBasicMaterial | null = null;
  private highlightMaterialSelected: THREE.MeshBasicMaterial | null = null;
  private highlightMaterialBoth: THREE.MeshBasicMaterial | null = null;

  /** Shared geometry for highlight overlays. */
  private highlightGeometry: THREE.PlaneGeometry | null = null;

  constructor(
    getTextureForNote: (
      note: Note,
      opts: {inStarPower: boolean},
    ) => THREE.SpriteMaterial,
    clippingPlanes: THREE.Plane[],
    laneColors: string[] = [],
    fullWidthLaneColor = '#FFFFFF',
    fullWidthSustainWidthMultiplier = 1,
    highwaySpeed = 1.5,
    sustainTextures: HighwaySustainTextures | null = null,
    flameTextures: HighwayFlameTextures | null = null,
    noteSpriteClippingPlanes: THREE.Plane[] = clippingPlanes,
  ) {
    this.getTextureForNote = getTextureForNote;
    this.clippingPlanes = clippingPlanes;
    this.laneColors = laneColors;
    this.fullWidthLaneColor = fullWidthLaneColor;
    this.fullWidthSustainWidthMultiplier = fullWidthSustainWidthMultiplier;
    this.highwaySpeed = highwaySpeed;
    this.sustainTextures = sustainTextures;
    this.flameTextures = flameTextures;
    this.noteSpriteClippingPlanes = noteSpriteClippingPlanes;
  }

  // -----------------------------------------------------------------------
  // Overlay material accessors (instance-level, not module-level)
  // -----------------------------------------------------------------------

  private getHighlightMaterial(
    hovered: boolean,
    selected: boolean,
  ): THREE.MeshBasicMaterial | null {
    if (selected && hovered) {
      if (!this.highlightMaterialBoth) {
        this.highlightMaterialBoth = this.makeHighlightMaterial(0.6);
      }
      return this.highlightMaterialBoth;
    }
    if (selected) {
      if (!this.highlightMaterialSelected) {
        this.highlightMaterialSelected = this.makeHighlightMaterial(0.35);
      }
      return this.highlightMaterialSelected;
    }
    if (hovered) {
      if (!this.highlightMaterialHover) {
        this.highlightMaterialHover = this.makeHighlightMaterial(0.25);
      }
      return this.highlightMaterialHover;
    }
    return null;
  }

  private makeHighlightMaterial(opacity: number): THREE.MeshBasicMaterial {
    const m = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    m.clippingPlanes = this.clippingPlanes;
    return m;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Dispose all owned materials. Call when the renderer is torn down. */
  dispose(): void {
    this.highlightMaterialHover?.dispose();
    this.highlightMaterialHover = null;
    this.highlightMaterialSelected?.dispose();
    this.highlightMaterialSelected = null;
    this.highlightMaterialBoth?.dispose();
    this.highlightMaterialBoth = null;
    this.highlightGeometry?.dispose();
    this.highlightGeometry = null;
  }

  // -----------------------------------------------------------------------
  // ElementRenderer interface
  // -----------------------------------------------------------------------

  create(data: NoteElementData, msTime = data.note.msTime): THREE.Group {
    const group = new THREE.Group();
    // Scene-level groups use renderOrder as their sort bucket. Keep the full
    // note/effect group above the source-backed fret hitline group so flames,
    // sustains, and selection overlays are composited over the frets.
    group.renderOrder = 4;

    const material = this.getTextureForNote(data.note, {
      inStarPower: data.inStarPower,
    });
    const sprite = new THREE.Sprite(material);

    if (data.isKick) {
      sprite.center.set(0.5, 0.5);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(KICK_SCALE * aspectRatio, KICK_SCALE, KICK_SCALE);
      sprite.renderOrder = 1;
      group.position.x = 0;
    } else if (data.isOpen) {
      const openScale = 0.11;
      // open.webp has transparent padding below its visible bar. Align the
      // bar itself with the kick/fret-note hit line, not the image bounds.
      sprite.center.set(0.5, OPEN_NOTE_ANCHOR_Y);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(openScale * aspectRatio, openScale, openScale);
      // Full-width open bars sit behind all fret-note heads, like kicks.
      sprite.renderOrder = 1;
      group.position.x = 0;
    } else {
      sprite.center.set(0.5, GEM_ANCHOR_Y);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
      sprite.renderOrder = 4;
      group.position.x = data.xPosition;
    }

    sprite.position.x = 0;
    sprite.position.z = 0;
    sprite.material.clippingPlanes = this.noteSpriteClippingPlanes;
    sprite.material.depthTest = false;
    sprite.material.transparent = true;

    group.add(sprite);

    group.position.z = 0;

    // Cache highlight dimensions so setHovered/setSelected can size the
    // highlight mesh without re-reading note geometry.
    const noteScale = data.isKick ? KICK_SCALE : data.isOpen ? 0.11 : SCALE;
    // Bottom-anchored gems have their visual center above the beat line;
    // the highlight overlay follows that offset.
    const spriteYOffset =
      data.isKick || data.isOpen ? 0 : (0.5 - GEM_ANCHOR_Y) * SCALE;
    group.userData = {
      hovered: false,
      selected: false,
      spriteYOffset,
      highlightDims: {
        w: data.isKick ? 0.9 : noteScale * 2.2,
        h: noteScale * 1.8,
      },
    };

    // Sustain tail (five-fret notes, including full-width Open notes)
    if (data.msLength > 0 && !data.isKick && (data.isOpen || data.lane >= 0)) {
      this.createSustain(group, data);
    }

    this.createFlame(group, data, msTime);

    return group;
  }

  recycle(group: THREE.Group): void {
    // Remove and dispose all overlay children (indices 1+).
    // The main sprite at index 0 is kept but the group is being
    // discarded anyway (no pooling), so disposal is for cleanup only.
    while (group.children.length > 1) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      this.disposeGeometryTree(child);
    }
    // Reset transient hover/selection flags so a re-used group doesn't
    // carry state into a different element.
    const u = group.userData as {hovered?: boolean; selected?: boolean};
    u.hovered = false;
    u.selected = false;
  }

  // -----------------------------------------------------------------------
  // ElementRenderer hover/selection hooks
  // -----------------------------------------------------------------------

  /**
   * In-place hover transition. Toggles the per-group `userData.hovered`
   * flag and recomposes the highlight mesh's opacity additively with the
   * selected flag.
   */
  setHovered(group: THREE.Group, hovered: boolean): void {
    const u = group.userData as {hovered?: boolean; selected?: boolean};
    if (u.hovered === hovered) return;
    u.hovered = hovered;
    this.updateHighlightMesh(group);
  }

  /**
   * In-place selection transition. Toggles the per-group `userData.selected`
   * flag and recomposes the highlight mesh's opacity.
   */
  setSelected(group: THREE.Group, selected: boolean): void {
    const u = group.userData as {hovered?: boolean; selected?: boolean};
    if (u.selected === selected) return;
    u.selected = selected;
    this.updateHighlightMesh(group);
  }

  /**
   * Animate the one-shot flame at the fixed playline. The note group itself
   * keeps scrolling past the line, so the flame is counter-positioned to stay
   * anchored at world Y=-1 while the note's time window keeps it alive long
   * enough for all frames to play.
   */
  update(group: THREE.Group, currentTimeMs: number): void {
    const flame = group.children.find(
      child => child.userData?.['role'] === FLAME_ROLE,
    );
    if (!(flame instanceof THREE.Sprite)) return;

    const userData = group.userData as {
      flameMsTime?: number;
      flameOpen?: boolean;
    };
    const flameMsTime = userData.flameMsTime;
    if (flameMsTime == null) return;

    const elapsed = currentTimeMs - flameMsTime;
    const textures = userData.flameOpen
      ? this.flameTextures?.open
      : this.flameTextures?.hit;
    const duration = userData.flameOpen
      ? HIGHWAY_OPEN_FLAME_DURATION_MS
      : HIGHWAY_FLAME_DURATION_MS;
    if (!textures?.length || elapsed < 0 || elapsed >= duration) {
      flame.visible = false;
      return;
    }

    const frameIndex = Math.min(
      Math.floor(elapsed / HIGHWAY_FLAME_FRAME_DURATION_MS),
      textures.length - 1,
    );
    if (flame.material.map !== textures[frameIndex]) {
      flame.material.map = textures[frameIndex];
      flame.material.needsUpdate = true;
    }
    flame.position.y = -1 - group.position.y;
    flame.visible = true;
  }

  /**
   * Composite the highlight mesh's material from hovered + selected. The
   * three states (hover-only, selected-only, both) bind to three shared
   * materials at the corresponding opacity (0.25 / 0.35 / 0.60). Mesh is
   * hidden when neither flag is set.
   *
   * Lazy-create the highlight mesh on the first transition that needs it,
   * sized via group.userData.highlightDims captured at create() time.
   */
  private updateHighlightMesh(group: THREE.Group): void {
    const u = group.userData as {
      hovered?: boolean;
      selected?: boolean;
      spriteYOffset?: number;
      highlightDims?: {w: number; h: number};
    };
    const hovered = !!u.hovered;
    const selected = !!u.selected;
    const material = this.getHighlightMaterial(hovered, selected);

    const highlightChild = group.children.find(
      child => child.userData?.['role'] === SELECTION_ROLE,
    );
    let highlight =
      highlightChild instanceof THREE.Mesh ? highlightChild : null;

    // No mesh yet, and we don't need one — skip allocation.
    if (!highlight && !material) return;

    if (!highlight) {
      while (group.children.length < CHILD_SELECTION) {
        const placeholder = new THREE.Object3D();
        placeholder.visible = false;
        group.add(placeholder);
      }
      highlight = new THREE.Mesh(this.getHighlightGeometry(), material!);
      highlight.userData['role'] = SELECTION_ROLE;
      highlight.renderOrder = 5;
      const dims = u.highlightDims ?? {w: SCALE * 2.2, h: SCALE * 1.8};
      highlight.scale.set(dims.w, dims.h, 1);
      highlight.position.set(0, u.spriteYOffset ?? 0, -0.001);
      group.add(highlight);
      return;
    }

    if (!material) {
      highlight.visible = false;
      return;
    }
    highlight.material = material;
    highlight.visible = true;
  }

  // -----------------------------------------------------------------------
  // Active sprites for raycasting
  // -----------------------------------------------------------------------

  /**
   * Extract the main sprite from a note group for raycasting.
   */
  static getSprite(group: THREE.Group): THREE.Sprite | null {
    if (
      group.children.length > 0 &&
      group.children[0] instanceof THREE.Sprite
    ) {
      return group.children[0] as THREE.Sprite;
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getHighlightGeometry(): THREE.PlaneGeometry {
    if (!this.highlightGeometry) {
      this.highlightGeometry = new THREE.PlaneGeometry(1, 1);
    }
    return this.highlightGeometry;
  }

  private disposeGeometryTree(object: THREE.Object3D): void {
    if (object instanceof THREE.Mesh) {
      object.geometry?.dispose();
      // Don't dispose shared materials (the highlight material).
    }
    for (const child of object.children) {
      this.disposeGeometryTree(child);
    }
  }

  private createSustain(group: THREE.Group, data: NoteElementData): THREE.Mesh {
    const sustainWorldHeight = highwaySustainWorldHeight(
      data.msLength,
      this.highwaySpeed,
    );
    const color =
      data.lane >= 0 && data.lane < this.laneColors.length
        ? this.laneColors[data.lane]
        : this.fullWidthLaneColor;
    const sustainWidth = data.isOpen
      ? SCALE * this.fullWidthSustainWidthMultiplier
      : SCALE * FRETTED_SUSTAIN_WIDTH_MULTIPLIER;

    const texture = data.isOpen
      ? this.sustainTextures?.open
      : this.sustainTextures?.fretted[1];
    const mat = new THREE.MeshBasicMaterial({
      color,
      map: texture,
      side: THREE.DoubleSide,
    });
    mat.clippingPlanes = this.noteSpriteClippingPlanes;
    mat.depthTest = false;
    mat.transparent = true;

    const geometry = createHighwaySustainGeometry(
      sustainWidth,
      sustainWorldHeight,
      !data.isOpen,
    );
    const plane = new THREE.Mesh(geometry, mat);
    plane.position.z = 0;
    plane.position.y = 0.03 + sustainWorldHeight / 2;
    plane.renderOrder = 2;

    // The note group itself is sorted above the fret hitline so heads, flames,
    // and selection overlays remain on top. Put the sustain in an overriding
    // lower-order group so its tail passes underneath the fret buttons.
    const sustainLayer = new THREE.Group();
    sustainLayer.renderOrder = 2;
    sustainLayer.add(plane);
    group.add(sustainLayer);
    return plane;
  }

  private createFlame(
    group: THREE.Group,
    data: NoteElementData,
    msTime: number,
  ): void {
    const fullWidth = data.isOpen || data.isKick;
    const textures = fullWidth
      ? this.flameTextures?.open
      : this.flameTextures?.hit;
    if (!textures?.length || (!fullWidth && data.lane < 0)) return;

    const material = new THREE.SpriteMaterial({map: textures[0]});
    material.clippingPlanes = this.clippingPlanes;
    material.depthTest = false;
    material.transparent = true;

    const flame = new THREE.Sprite(material);
    flame.userData['role'] = FLAME_ROLE;
    if (fullWidth) {
      // The open flame is one complete five-arch sprite, not an animation
      // sheet. Preserve its source aspect ratio so each arch stays aligned
      // with the fret hitline instead of stretching vertically.
      // Kick flames use a separate four-lane source with its own existing
      // placement. Guitar/bass open flames are anchored at the fret crest so
      // the five white arches sit on the matching hitline curves.
      flame.center.set(0.5, data.isKick ? 0.5 : OPEN_FLAME_PIVOT_Y);
      const aspectRatio =
        flame.material.map!.image.width / flame.material.map!.image.height;
      const flameWidth = data.isKick ? DRUM_OPEN_FLAME_WIDTH : OPEN_FLAME_WIDTH;
      flame.scale.set(flameWidth, flameWidth / aspectRatio, 1);
    } else {
      flame.center.set(0.5, FLAME_PIVOT_Y);
      flame.scale.set(FLAME_HEIGHT, FLAME_HEIGHT, 1);
    }
    flame.position.z = 0;
    flame.renderOrder = 6;
    flame.visible = false;
    group.userData['flameMsTime'] = msTime;
    group.userData['flameOpen'] = fullWidth;
    group.add(flame);
  }
}
