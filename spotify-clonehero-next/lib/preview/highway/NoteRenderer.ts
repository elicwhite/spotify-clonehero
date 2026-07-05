import * as THREE from 'three';
import type {ElementRenderer} from './SceneReconciler';
import {
  SCALE,
  GUITAR_LANE_COLORS,
  HIGHWAY_DURATION_MS,
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
  /** Sustain length in ms. */
  msLength: number;
}

/**
 * Child indices within a note group:
 * [0] = main note sprite
 * [1] = sustain tail mesh (optional, guitar only)
 * [2] = selection highlight mesh (optional)
 * [3] = reserved (was confidence indicator; kept so review stays at [4])
 * [4] = review indicator (optional)
 */
const CHILD_SELECTION = 2;
const CHILD_REVIEW = 4;

// ---------------------------------------------------------------------------
// NoteRenderer
// ---------------------------------------------------------------------------

/**
 * ElementRenderer for note chart elements.
 *
 * Handles creating note sprites (drums and guitar), sustain tails,
 * and overlay decorations (selection, hover, review).
 */
export class NoteRenderer implements ElementRenderer<NoteElementData> {
  private getTextureForNote: (
    note: Note,
    opts: {inStarPower: boolean},
  ) => THREE.SpriteMaterial;
  private clippingPlanes: THREE.Plane[];

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
  // set). Geometry is shared. The reviewMaterial is a separate decoration.
  private highlightMaterialHover: THREE.MeshBasicMaterial | null = null;
  private highlightMaterialSelected: THREE.MeshBasicMaterial | null = null;
  private highlightMaterialBoth: THREE.MeshBasicMaterial | null = null;
  private reviewMaterial: THREE.MeshBasicMaterial | null = null;

  // Overlay state (set externally) — hover/selection now live in the
  // SceneReconciler and dispatch via setHovered/setSelected hooks.
  private reviewedNoteIds: Set<string> | null = null;

  /**
   * True when review overlay state has changed and all visible notes need
   * updating. Hover/selection don't set this — they update the affected
   * group in place via setHovered/setSelected.
   */
  private overlaysDirty = true;

  /** Shared geometry for highlight overlays. */
  private highlightGeometry: THREE.PlaneGeometry | null = null;

  constructor(
    getTextureForNote: (
      note: Note,
      opts: {inStarPower: boolean},
    ) => THREE.SpriteMaterial,
    clippingPlanes: THREE.Plane[],
  ) {
    this.getTextureForNote = getTextureForNote;
    this.clippingPlanes = clippingPlanes;
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

  private getReviewMaterial(): THREE.MeshBasicMaterial {
    if (!this.reviewMaterial) {
      this.reviewMaterial = new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.reviewMaterial.clippingPlanes = this.clippingPlanes;
    }
    return this.reviewMaterial;
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
    this.reviewMaterial?.dispose();
    this.reviewMaterial = null;
    this.highlightGeometry?.dispose();
    this.highlightGeometry = null;
  }

  // -----------------------------------------------------------------------
  // ElementRenderer interface
  // -----------------------------------------------------------------------

  create(data: NoteElementData): THREE.Group {
    const group = new THREE.Group();

    const material = this.getTextureForNote(data.note, {
      inStarPower: data.inStarPower,
    });
    const sprite = new THREE.Sprite(material);

    if (data.isKick) {
      const kickScale = 0.045;
      sprite.center.set(0.5, 0.5);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(kickScale * aspectRatio, kickScale, kickScale);
      sprite.renderOrder = 1;
      group.position.x = 0;
    } else if (data.isOpen) {
      const openScale = 0.11;
      sprite.center.set(0.5, 0.5);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(openScale * aspectRatio, openScale, openScale);
      sprite.renderOrder = 4;
      group.position.x = 0;
    } else {
      sprite.center.set(0.5, 0.5);
      const aspectRatio =
        sprite.material.map!.image.width / sprite.material.map!.image.height;
      sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
      sprite.renderOrder = 4;
      group.position.x = data.xPosition;
    }

    sprite.position.x = 0;
    sprite.position.z = 0;
    sprite.material.clippingPlanes = this.clippingPlanes;
    sprite.material.depthTest = false;
    sprite.material.transparent = true;

    group.add(sprite);

    group.position.z = 0;

    // Cache highlight dimensions so setHovered/setSelected can size the
    // highlight mesh without re-reading note geometry.
    const noteScale = data.isKick ? 0.045 : data.isOpen ? 0.11 : SCALE;
    group.userData = {
      hovered: false,
      selected: false,
      highlightDims: {
        w: data.isKick ? 0.9 : noteScale * 2.2,
        h: noteScale * 1.8,
      },
    };

    // Sustain tail (guitar only, non-kick, non-open with length > 0)
    if (data.msLength > 0 && !data.isKick && data.lane >= 0) {
      this.createSustain(group, data);
    }

    return group;
  }

  recycle(group: THREE.Group): void {
    // Remove and dispose all overlay children (indices 1+).
    // The main sprite at index 0 is kept but the group is being
    // discarded anyway (no pooling), so disposal is for cleanup only.
    while (group.children.length > 1) {
      const child = group.children[group.children.length - 1];
      group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        // Don't dispose shared materials (highlight, review).
      }
    }
    // Reset transient hover/selection flags so a re-used group doesn't
    // carry state into a different element.
    const u = group.userData as {hovered?: boolean; selected?: boolean};
    u.hovered = false;
    u.selected = false;
  }

  // -----------------------------------------------------------------------
  // Overlay setters (called by the reconciler integration layer)
  // -----------------------------------------------------------------------

  setReviewedNoteIds(ids: Set<string> | null): void {
    this.reviewedNoteIds = ids;
    this.overlaysDirty = true;
  }

  /**
   * Returns true if overlay state has changed since the last
   * call to consumeOverlaysDirty(). Used by the render loop
   * to skip per-note overlay updates when nothing changed.
   */
  consumeOverlaysDirty(): boolean {
    const dirty = this.overlaysDirty;
    this.overlaysDirty = false;
    return dirty;
  }

  /** Mark overlays as dirty (e.g. when new notes enter the window). */
  markOverlaysDirty(): void {
    this.overlaysDirty = true;
  }

  // -----------------------------------------------------------------------
  // Overlay updates (called each frame for visible groups)
  // -----------------------------------------------------------------------

  /**
   * Update the review overlay child on a note group. Hover and selection
   * visuals are owned by setHovered/setSelected hooks which mutate the
   * highlight mesh in place; this path only repaints the review decoration.
   *
   * Called for every active note group each frame via the reconciler's
   * updateWindow loop.
   */
  updateOverlays(group: THREE.Group, noteKey: string): void {
    // noteKey is e.g. 'note:2880:yellowDrum' -- extract the noteId part
    // which is 'tick:type', e.g. '2880:yellowDrum'
    const id = noteKey.startsWith('note:') ? noteKey.slice(5) : noteKey;
    this.updateReviewIndicator(group, id);
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
      highlightDims?: {w: number; h: number};
    };
    const hovered = !!u.hovered;
    const selected = !!u.selected;
    const material = this.getHighlightMaterial(hovered, selected);

    let highlight: THREE.Mesh | null = null;
    if (
      group.children.length > CHILD_SELECTION &&
      group.children[CHILD_SELECTION] instanceof THREE.Mesh
    ) {
      highlight = group.children[CHILD_SELECTION] as THREE.Mesh;
    }

    // No mesh yet, and we don't need one — skip allocation.
    if (!highlight && !material) return;

    if (!highlight) {
      while (group.children.length < CHILD_SELECTION) {
        const placeholder = new THREE.Object3D();
        placeholder.visible = false;
        group.add(placeholder);
      }
      highlight = new THREE.Mesh(this.getHighlightGeometry(), material!);
      highlight.renderOrder = 5;
      const dims = u.highlightDims ?? {w: SCALE * 2.2, h: SCALE * 1.8};
      highlight.scale.set(dims.w, dims.h, 1);
      highlight.position.set(0, 0, -0.001);
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

  private updateReviewIndicator(group: THREE.Group, id: string): void {
    if (!this.reviewedNoteIds || !this.reviewedNoteIds.has(id)) {
      if (
        group.children.length > CHILD_REVIEW &&
        group.children[CHILD_REVIEW]
      ) {
        group.children[CHILD_REVIEW].visible = false;
      }
      return;
    }

    let indicator: THREE.Mesh;

    if (
      group.children.length > CHILD_REVIEW &&
      group.children[CHILD_REVIEW] instanceof THREE.Mesh
    ) {
      indicator = group.children[CHILD_REVIEW] as THREE.Mesh;
    } else {
      while (group.children.length < CHILD_REVIEW) {
        const placeholder = new THREE.Object3D();
        placeholder.visible = false;
        group.add(placeholder);
      }
      const dotGeom = new THREE.CircleGeometry(0.008, 12);
      indicator = new THREE.Mesh(dotGeom, this.getReviewMaterial());
      indicator.renderOrder = 6;
      group.add(indicator);
    }

    indicator.position.set(SCALE * 0.8, SCALE * 0.3, 0.001);
    indicator.visible = true;
  }

  private createSustain(group: THREE.Group, data: NoteElementData): THREE.Mesh {
    const sustainWorldHeight = 2 * (data.msLength / HIGHWAY_DURATION_MS);
    const color =
      data.lane >= 0 && data.lane < GUITAR_LANE_COLORS.length
        ? GUITAR_LANE_COLORS[data.lane]
        : '#FFFFFF';
    const sustainWidth = data.isOpen ? SCALE * 5 : SCALE * 0.3;

    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
    });
    mat.clippingPlanes = this.clippingPlanes;
    mat.depthTest = false;
    mat.transparent = true;

    const geometry = new THREE.PlaneGeometry(sustainWidth, sustainWorldHeight);
    const plane = new THREE.Mesh(geometry, mat);
    plane.position.z = 0;
    plane.position.y = 0.03 + data.msLength / HIGHWAY_DURATION_MS;
    plane.renderOrder = 2;
    group.add(plane);
    return plane;
  }
}
