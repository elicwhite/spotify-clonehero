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


/** Confidence ring colors by tier */
const CONFIDENCE_COLORS = {
  low: 0xef4444,     // red - conf < 0.5
  medium: 0xf59e0b,  // amber - conf < threshold
  mild: 0xf59e0b,    // amber - conf < 0.9
};

/**
 * Child indices within a note group:
 * [0] = main note sprite
 * [1] = sustain tail mesh (optional, guitar only)
 * [2] = selection highlight mesh (optional)
 * [3] = confidence indicator (optional)
 * [4] = review indicator (optional)
 */
const CHILD_SELECTION = 2;
const CHILD_CONFIDENCE = 3;
const CHILD_REVIEW = 4;

// ---------------------------------------------------------------------------
// NoteRenderer
// ---------------------------------------------------------------------------

/**
 * ElementRenderer for note chart elements.
 *
 * Handles creating note sprites (drums and guitar), sustain tails,
 * and overlay decorations (selection, hover, confidence, review).
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
  private selectionMaterial: THREE.MeshBasicMaterial | null = null;
  private hoverMaterial: THREE.MeshBasicMaterial | null = null;
  private reviewMaterial: THREE.MeshBasicMaterial | null = null;

  // Overlay state (set externally)
  private selectedNoteIds = new Set<string>();
  private hoveredNoteId: string | null = null;
  private confidenceMap: Map<string, number> | null = null;
  private showConfidence = false;
  private confidenceThreshold = 0.7;
  private reviewedNoteIds: Set<string> | null = null;

  /** True when overlay state has changed and all visible notes need updating. */
  private overlaysDirty = true;

  /** Shared geometry for highlight overlays. */
  private highlightGeometry: THREE.PlaneGeometry | null = null;

  constructor(
    getTextureForNote: (note: Note, opts: {inStarPower: boolean}) => THREE.SpriteMaterial,
    clippingPlanes: THREE.Plane[],
  ) {
    this.getTextureForNote = getTextureForNote;
    this.clippingPlanes = clippingPlanes;
  }

  // -----------------------------------------------------------------------
  // Overlay material accessors (instance-level, not module-level)
  // -----------------------------------------------------------------------

  private getSelectionMaterial(): THREE.MeshBasicMaterial {
    if (!this.selectionMaterial) {
      this.selectionMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.selectionMaterial.clippingPlanes = this.clippingPlanes;
    }
    return this.selectionMaterial;
  }

  private getHoverMaterial(): THREE.MeshBasicMaterial {
    if (!this.hoverMaterial) {
      this.hoverMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.hoverMaterial.clippingPlanes = this.clippingPlanes;
    }
    return this.hoverMaterial;
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
    this.selectionMaterial?.dispose();
    this.selectionMaterial = null;
    this.hoverMaterial?.dispose();
    this.hoverMaterial = null;
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
        // Don't dispose shared materials (selection, hover, review)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Overlay setters (called by the reconciler integration layer)
  // -----------------------------------------------------------------------

  setSelectedNoteIds(ids: Set<string>): void {
    this.selectedNoteIds = ids;
    this.overlaysDirty = true;
  }

  setHoveredNoteId(id: string | null): void {
    if (this.hoveredNoteId === id) return;
    this.hoveredNoteId = id;
    this.overlaysDirty = true;
  }

  setConfidenceData(
    confidenceMap: Map<string, number> | null,
    show: boolean,
    threshold: number,
  ): void {
    this.confidenceMap = confidenceMap;
    this.showConfidence = show;
    this.confidenceThreshold = threshold;
    this.overlaysDirty = true;
  }

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
   * Update overlay children (selection, confidence, review) on a note group.
   * Called for every active note group each frame via the reconciler's
   * updateWindow loop.
   */
  updateOverlays(
    group: THREE.Group,
    noteKey: string,
    data: NoteElementData,
  ): void {
    // noteKey is e.g. 'note:2880:yellowDrum' -- extract the noteId part
    // which is 'tick:type', e.g. '2880:yellowDrum'
    const id = noteKey.startsWith('note:') ? noteKey.slice(5) : noteKey;
    const isSelected = this.selectedNoteIds.has(id);
    const isHovered = this.hoveredNoteId === id;

    this.updateSelectionHighlight(group, data, isSelected, isHovered);
    this.updateConfidenceIndicator(group, data, id);
    this.updateReviewIndicator(group, id);
  }

  // -----------------------------------------------------------------------
  // Active sprites for raycasting
  // -----------------------------------------------------------------------

  /**
   * Extract the main sprite from a note group for raycasting.
   */
  static getSprite(group: THREE.Group): THREE.Sprite | null {
    if (group.children.length > 0 && group.children[0] instanceof THREE.Sprite) {
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

  private updateSelectionHighlight(
    group: THREE.Group,
    data: NoteElementData,
    isSelected: boolean,
    isHovered: boolean,
  ): void {
    const noteScale = data.isKick ? 0.045 : data.isOpen ? 0.11 : SCALE;
    const highlightW = data.isKick ? 0.9 : noteScale * 2.2;
    const highlightH = noteScale * 1.8;

    if (isSelected || isHovered) {
      let highlight: THREE.Mesh;

      if (
        group.children.length > CHILD_SELECTION &&
        group.children[CHILD_SELECTION] instanceof THREE.Mesh
      ) {
        highlight = group.children[CHILD_SELECTION] as THREE.Mesh;
      } else {
        while (group.children.length < CHILD_SELECTION) {
          const placeholder = new THREE.Object3D();
          placeholder.visible = false;
          group.add(placeholder);
        }
        highlight = new THREE.Mesh(
          this.getHighlightGeometry(),
          isHovered
            ? this.getHoverMaterial()
            : this.getSelectionMaterial(),
        );
        highlight.renderOrder = 5;
        group.add(highlight);
      }

      highlight.material = isHovered
        ? this.getHoverMaterial()
        : this.getSelectionMaterial();
      highlight.scale.set(highlightW, highlightH, 1);
      highlight.position.set(0, 0, -0.001);
      highlight.visible = true;
    } else {
      if (
        group.children.length > CHILD_SELECTION &&
        group.children[CHILD_SELECTION]
      ) {
        group.children[CHILD_SELECTION].visible = false;
      }
    }
  }

  private updateConfidenceIndicator(
    group: THREE.Group,
    data: NoteElementData,
    id: string,
  ): void {
    if (
      !this.showConfidence ||
      !this.confidenceMap ||
      this.confidenceMap.size === 0
    ) {
      if (
        group.children.length > CHILD_CONFIDENCE &&
        group.children[CHILD_CONFIDENCE]
      ) {
        group.children[CHILD_CONFIDENCE].visible = false;
      }
      return;
    }

    const conf = this.confidenceMap.get(id);
    if (conf === undefined || conf >= 0.9) {
      if (
        group.children.length > CHILD_CONFIDENCE &&
        group.children[CHILD_CONFIDENCE]
      ) {
        group.children[CHILD_CONFIDENCE].visible = false;
      }
      return;
    }

    const noteScale = data.isKick ? 0.045 : SCALE;
    const ringSize = noteScale * 2.8;
    let color: number;
    let opacity: number;

    if (conf < 0.5) {
      color = CONFIDENCE_COLORS.low;
      opacity = 0.7;
    } else if (conf < this.confidenceThreshold) {
      color = CONFIDENCE_COLORS.medium;
      opacity = 0.6;
    } else {
      color = CONFIDENCE_COLORS.mild;
      opacity = 0.3;
    }

    let ring: THREE.Mesh;

    if (
      group.children.length > CHILD_CONFIDENCE &&
      group.children[CHILD_CONFIDENCE] instanceof THREE.Mesh
    ) {
      ring = group.children[CHILD_CONFIDENCE] as THREE.Mesh;
    } else {
      while (group.children.length < CHILD_CONFIDENCE) {
        const placeholder = new THREE.Object3D();
        placeholder.visible = false;
        group.add(placeholder);
      }
      const ringGeom = new THREE.RingGeometry(
        ringSize * 0.4,
        ringSize * 0.5,
        24,
      );
      const ringMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      ringMat.clippingPlanes = this.clippingPlanes;
      ring = new THREE.Mesh(ringGeom, ringMat);
      ring.renderOrder = 5;
      group.add(ring);
    }

    (ring.material as THREE.MeshBasicMaterial).color.set(color);
    (ring.material as THREE.MeshBasicMaterial).opacity = opacity;
    ring.position.set(0, 0, 0.001);
    ring.visible = true;
  }

  private updateReviewIndicator(
    group: THREE.Group,
    id: string,
  ): void {
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
      indicator = new THREE.Mesh(
        dotGeom,
        this.getReviewMaterial(),
      );
      indicator.renderOrder = 6;
      group.add(indicator);
    }

    indicator.position.set(SCALE * 0.8, SCALE * 0.3, 0.001);
    indicator.visible = true;
  }

  private createSustain(
    group: THREE.Group,
    data: NoteElementData,
  ): THREE.Mesh {
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
