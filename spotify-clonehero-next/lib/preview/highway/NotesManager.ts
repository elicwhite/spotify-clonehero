import * as THREE from 'three';
import {Instrument, noteTypes} from '@eliwhite/scan-chart';
import {interpretDrumNote} from '../../drum-mapping/noteToInstrument';
import {EventSequence} from './EventSequence';
import {AnimatedTextureManager, loadNoteTextures} from './TextureManager';
import {
  SCALE,
  HIGHWAY_DURATION_MS,
  GUITAR_LANE_COLORS,
  PAD_TO_HIGHWAY_LANE,
  calculateNoteXOffset,
  type Note,
  type Track,
  type PreparedNote,
} from './types';

// ---------------------------------------------------------------------------
// NotesDiff -- incremental update descriptor
// ---------------------------------------------------------------------------

/** Describes the differences between two sets of PreparedNotes. */
export interface NotesDiff {
  /** Notes present in the new set but not the old. */
  added: PreparedNote[];
  /** Indices in the old preparedNotes array to remove. */
  removed: number[];
  /** Notes whose position or visual properties changed. */
  moved: Array<{oldIndex: number; newNote: PreparedNote}>;
}

// ---------------------------------------------------------------------------
// NotesManager -- windowed rendering with sprite pool
// ---------------------------------------------------------------------------

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

/** Shared materials for overlay decorations */
let selectionMaterial: THREE.MeshBasicMaterial | null = null;
let hoverMaterial: THREE.MeshBasicMaterial | null = null;
let reviewMaterial: THREE.MeshBasicMaterial | null = null;

function getSelectionMaterial(clippingPlanes: THREE.Plane[]): THREE.MeshBasicMaterial {
  if (!selectionMaterial) {
    selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    selectionMaterial.clippingPlanes = clippingPlanes;
  }
  return selectionMaterial;
}

function getHoverMaterial(clippingPlanes: THREE.Plane[]): THREE.MeshBasicMaterial {
  if (!hoverMaterial) {
    hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    hoverMaterial.clippingPlanes = clippingPlanes;
  }
  return hoverMaterial;
}

function getReviewMaterial(clippingPlanes: THREE.Plane[]): THREE.MeshBasicMaterial {
  if (!reviewMaterial) {
    reviewMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    reviewMaterial.clippingPlanes = clippingPlanes;
  }
  return reviewMaterial;
}

/** Confidence ring colors by tier */
const CONFIDENCE_COLORS = {
  low: 0xef4444,     // red - conf < 0.5
  medium: 0xf59e0b,  // amber - conf < threshold
  mild: 0xf59e0b,    // amber - conf < 0.9
};

export class NotesManager {
  private scene: THREE.Scene;
  private instrument: Instrument;
  private highwaySpeed: number;
  private clippingPlanes: THREE.Plane[];

  /** Flattened, sorted array of all notes. */
  private preparedNotes: PreparedNote[] = [];
  /** Cursor for efficient windowed lookup. */
  private noteSequence!: EventSequence<PreparedNote>;

  /** Map from preparedNotes index -> active THREE.Group in the scene. */
  private activeNoteGroups = new Map<number, THREE.Group>();

  /** Pool of idle THREE.Group objects ready for reuse. */
  private groupPool: THREE.Group[] = [];

  /** Pre-loaded shared SpriteMaterial getter. */
  private getTextureForNote!: (
    note: Note,
    opts: {inStarPower: boolean},
  ) => THREE.SpriteMaterial;

  // -- Overlay state (set by HighwayEditor via public methods) --
  private selectedNoteIds = new Set<string>();
  private hoveredNoteId: string | null = null;
  private confidenceMap: Map<string, number> | null = null;
  private showConfidence = false;
  private confidenceThreshold = 0.7;
  private reviewedNoteIds: Set<string> | null = null;

  /** Shared geometry for highlight overlays. */
  private highlightGeometry: THREE.PlaneGeometry | null = null;
  /** Pool of confidence ring meshes. */
  private confidenceRingPool: THREE.Mesh[] = [];
  /** Pool of question-mark sprites for low-confidence notes. */
  private questionMarkPool: THREE.Sprite[] = [];

  constructor(
    scene: THREE.Scene,
    instrument: Instrument,
    highwaySpeed: number,
    clippingPlanes: THREE.Plane[],
  ) {
    this.scene = scene;
    this.instrument = instrument;
    this.highwaySpeed = highwaySpeed;
    this.clippingPlanes = clippingPlanes;
  }

  // -----------------------------------------------------------------------
  // Public overlay setters
  // -----------------------------------------------------------------------

  /** Set the IDs of currently selected notes. */
  setSelectedNoteIds(ids: Set<string>): void {
    this.selectedNoteIds = ids;
  }

  /** Set the ID of the currently hovered note (null to clear). */
  setHoveredNoteId(id: string | null): void {
    this.hoveredNoteId = id;
  }

  /** Update confidence display data. */
  setConfidenceData(
    confidenceMap: Map<string, number> | null,
    show: boolean,
    threshold: number,
  ): void {
    this.confidenceMap = confidenceMap;
    this.showConfidence = show;
    this.confidenceThreshold = threshold;
  }

  /** Set the IDs of reviewed notes. */
  setReviewedNoteIds(ids: Set<string> | null): void {
    this.reviewedNoteIds = ids;
  }

  // -----------------------------------------------------------------------
  // Public accessors for InteractionManager
  // -----------------------------------------------------------------------

  /**
   * Returns an array of the main note sprites for all currently active
   * (visible) note groups. Used by InteractionManager for raycasting.
   */
  getActiveSprites(): THREE.Sprite[] {
    const sprites: THREE.Sprite[] = [];
    for (const group of this.activeNoteGroups.values()) {
      if (group.children.length > 0 && group.children[0] instanceof THREE.Sprite) {
        sprites.push(group.children[0] as THREE.Sprite);
      }
    }
    return sprites;
  }

  /**
   * Given a THREE.Group (e.g. from a raycast hit on a child sprite),
   * returns the PreparedNote and its composite note ID, or null if not found.
   */
  getNoteForGroup(group: THREE.Group): {note: PreparedNote; id: string} | null {
    for (const [idx, g] of this.activeNoteGroups) {
      if (g === group) {
        const pn = this.preparedNotes[idx];
        return {note: pn, id: this.noteIdFromPrepared(pn)};
      }
    }
    return null;
  }

  /** Load textures and pre-compute note data. No sprites are created yet. */
  async prepare(
    textureLoader: THREE.TextureLoader,
    track: Track,
    animatedTextureManager?: AnimatedTextureManager,
  ) {
    const {getTextureForNote} = await loadNoteTextures(
      textureLoader,
      this.instrument,
      animatedTextureManager,
    );
    this.getTextureForNote = getTextureForNote;

    const isDrums = this.instrument === 'drums';
    const starPowerSections = track.starPowerSections;

    // Build a sorted list of star power section start times for binary search
    const spStarts = starPowerSections.map(s => s.msTime);
    const spEnds = starPowerSections.map(s => s.msTime + s.msLength);

    function inStarPowerSection(time: number): boolean {
      // Binary search: find the last section that starts <= time
      let lo = 0;
      let hi = spStarts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (spStarts[mid] <= time) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return idx >= 0 && time <= spEnds[idx];
    }

    // Flatten all note event groups into a single sorted array
    const prepared: PreparedNote[] = [];

    for (const group of track.noteEventGroups) {
      const time = group[0].msTime;
      const starPower = inStarPowerSection(time);

      for (const note of group) {
        if (isDrums) {
          const interpreted = interpretDrumNote(note);

          if (interpreted.isKick) {
            prepared.push({
              note,
              msTime: note.msTime,
              msLength: 0, // Drums don't have sustains
              xPosition: 0, // kick has no lane X offset -- centered via sprite center
              inStarPower: starPower,
              isKick: true,
              isOpen: false,
              lane: -1,
            });
          } else {
            const lane = PAD_TO_HIGHWAY_LANE[interpreted.pad] ?? -1;

            if (lane !== -1) {
              prepared.push({
                note,
                msTime: note.msTime,
                msLength: 0, // Drums don't have sustains
                xPosition: calculateNoteXOffset(this.instrument, lane),
                inStarPower: starPower,
                isKick: false,
                isOpen: false,
                lane,
              });
            }
          }
        } else {
          // Guitar / bass
          if (note.type === noteTypes.open) {
            prepared.push({
              note,
              msTime: note.msTime,
              msLength: note.msLength,
              xPosition: 0,
              inStarPower: starPower,
              isKick: false,
              isOpen: true,
              lane: -1,
            });
          } else {
            const lane =
              note.type === noteTypes.green
                ? 0
                : note.type === noteTypes.red
                  ? 1
                  : note.type === noteTypes.yellow
                    ? 2
                    : note.type === noteTypes.blue
                      ? 3
                      : note.type === noteTypes.orange
                        ? 4
                        : -1;

            if (lane !== -1) {
              prepared.push({
                note,
                msTime: note.msTime,
                msLength: note.msLength,
                xPosition: calculateNoteXOffset(this.instrument, lane),
                inStarPower: starPower,
                isKick: false,
                isOpen: false,
                lane,
              });
            }
          }
        }
      }
    }

    // Already sorted because noteEventGroups is sorted by time
    this.preparedNotes = prepared;
    this.noteSequence = new EventSequence(prepared);
  }

  // -----------------------------------------------------------------------
  // Incremental diff API
  // -----------------------------------------------------------------------

  /**
   * Compute the diff between two PreparedNote arrays.
   *
   * Notes are keyed by `tick:type` composite key. The diff identifies:
   * - Added notes (in newNotes but not oldNotes)
   * - Removed notes (in oldNotes but not newNotes)
   * - Moved notes (same key but different msTime, xPosition, or flags)
   */
  static computeDiff(
    oldNotes: PreparedNote[],
    newNotes: PreparedNote[],
  ): NotesDiff {
    const oldMap = new Map<string, {note: PreparedNote; index: number}>();
    for (let i = 0; i < oldNotes.length; i++) {
      const n = oldNotes[i];
      const key = `${n.note.tick ?? 0}:${n.note.type}`;
      oldMap.set(key, {note: n, index: i});
    }

    const newMap = new Map<string, {note: PreparedNote; index: number}>();
    for (let i = 0; i < newNotes.length; i++) {
      const n = newNotes[i];
      const key = `${n.note.tick ?? 0}:${n.note.type}`;
      newMap.set(key, {note: n, index: i});
    }

    const added: PreparedNote[] = [];
    const removed: number[] = [];
    const moved: Array<{oldIndex: number; newNote: PreparedNote}> = [];

    // Find removed and moved
    for (const [key, {note, index}] of oldMap) {
      const newEntry = newMap.get(key);
      if (!newEntry) {
        removed.push(index);
      } else if (
        newEntry.note.msTime !== note.msTime ||
        newEntry.note.xPosition !== note.xPosition ||
        newEntry.note.note.flags !== note.note.flags ||
        newEntry.note.inStarPower !== note.inStarPower
      ) {
        moved.push({oldIndex: index, newNote: newEntry.note});
      }
    }

    // Find added
    for (const [key, {note}] of newMap) {
      if (!oldMap.has(key)) {
        added.push(note);
      }
    }

    return {added, removed, moved};
  }

  /**
   * Apply a diff to the live scene incrementally.
   *
   * Removes deleted notes, updates moved notes, adds new notes,
   * then re-sorts the prepared notes array and rebuilds the
   * EventSequence cursor.
   */
  applyDiff(diff: NotesDiff): void {
    // 1. Remove deleted notes from the scene and preparedNotes
    // Sort removed indices in descending order so splicing doesn't shift indices
    const removedSet = new Set(diff.removed);

    // Remove active groups for deleted notes
    for (const index of diff.removed) {
      const group = this.activeNoteGroups.get(index);
      if (group) {
        this.scene.remove(group);
        this.recycleGroup(group);
        this.activeNoteGroups.delete(index);
      }
    }

    // 2. Handle moved notes (flags changed, position changed, etc.)
    // Update preparedNotes in-place; remove active groups so they get
    // recreated by updateDisplayedNotes.
    for (const {oldIndex, newNote} of diff.moved) {
      this.preparedNotes[oldIndex] = newNote;
      const group = this.activeNoteGroups.get(oldIndex);
      if (group) {
        this.scene.remove(group);
        this.recycleGroup(group);
        this.activeNoteGroups.delete(oldIndex);
      }
    }

    // If there were moved notes, clear ALL active groups to force a full
    // visible-window rebuild on the next updateDisplayedNotes call.
    // This avoids index/cursor misalignment issues.
    if (diff.moved.length > 0) {
      for (const [, group] of this.activeNoteGroups) {
        this.scene.remove(group);
        this.recycleGroup(group);
      }
      this.activeNoteGroups.clear();
    }

    // 3. Add new notes to preparedNotes
    for (const note of diff.added) {
      this.preparedNotes.push(note);
    }

    // 4. Remove deleted entries from preparedNotes
    // We must also remap activeNoteGroups since indices shift
    if (removedSet.size > 0) {
      // Build new array excluding removed indices
      const newPrepared: PreparedNote[] = [];
      // Map from old index -> new index
      const indexMap = new Map<number, number>();

      for (let i = 0; i < this.preparedNotes.length; i++) {
        if (!removedSet.has(i)) {
          indexMap.set(i, newPrepared.length);
          newPrepared.push(this.preparedNotes[i]);
        }
      }

      // Remap activeNoteGroups
      const remapped = new Map<number, THREE.Group>();
      for (const [oldIdx, group] of this.activeNoteGroups) {
        const newIdx = indexMap.get(oldIdx);
        if (newIdx !== undefined) {
          remapped.set(newIdx, group);
        }
      }

      this.preparedNotes = newPrepared;
      this.activeNoteGroups = remapped;
    }

    // 5. Re-sort by msTime (needed after adds/moves)
    if (diff.added.length > 0 || diff.moved.length > 0) {
      // We need to re-sort and remap active groups again
      const oldOrder = [...this.preparedNotes];
      const oldGroupsByNote = new Map<PreparedNote, THREE.Group>();
      for (const [idx, group] of this.activeNoteGroups) {
        oldGroupsByNote.set(oldOrder[idx], group);
      }

      this.preparedNotes.sort((a, b) => a.msTime - b.msTime);

      // Rebuild activeNoteGroups with new indices
      const remapped = new Map<number, THREE.Group>();
      for (let i = 0; i < this.preparedNotes.length; i++) {
        const group = oldGroupsByNote.get(this.preparedNotes[i]);
        if (group) {
          remapped.set(i, group);
        }
      }
      this.activeNoteGroups = remapped;
    }

    // 6. Rebuild EventSequence cursor (indices changed)
    this.noteSequence = new EventSequence(this.preparedNotes);
  }

  /** Read-only access to the current prepared notes array. */
  getPreparedNotes(): readonly PreparedNote[] {
    return this.preparedNotes;
  }

  /**
   * Called every frame. Adds/removes/repositions sprites so that only notes
   * within the visible time window are in the scene.
   */
  updateDisplayedNotes(currentTimeMs: number) {
    const renderEndTimeMs = currentTimeMs + HIGHWAY_DURATION_MS;
    const noteStartIndex =
      this.noteSequence.getEarliestActiveEventIndex(currentTimeMs);

    let maxNoteIndex = noteStartIndex - 1;

    // Update existing active notes -- reposition or remove
    for (const [noteIndex, group] of this.activeNoteGroups) {
      const pn = this.preparedNotes[noteIndex];
      if (
        noteIndex < noteStartIndex ||
        pn.msTime > renderEndTimeMs
      ) {
        // Off-screen -- recycle
        this.scene.remove(group);
        this.recycleGroup(group);
        this.activeNoteGroups.delete(noteIndex);
      } else {
        // Still visible -- reposition
        group.position.y = this.noteYPosition(pn.msTime, currentTimeMs, renderEndTimeMs);

        // Reposition sustain tail if present
        if (pn.msLength > 0 && group.children.length > 1) {
          const sustainMesh = group.children[1] as THREE.Mesh;
          const sustainWorldHeight = 2 * (pn.msLength / HIGHWAY_DURATION_MS);
          // Update geometry in case HIGHWAY_DURATION_MS or sizing changed
          // (for now it's constant, but the geometry was created with the
          // current value so this is a no-op repositioning)
          sustainMesh.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
        }

        // Update overlay decorations (selection, confidence, review)
        this.updateNoteOverlays(group, pn);

        if (noteIndex > maxNoteIndex) {
          maxNoteIndex = noteIndex;
        }
      }
    }

    // Add notes that should be visible but don't have an active group.
    // This covers both new notes scrolling in from the top AND notes that
    // were removed by applyDiff (moved/flag-changed) and need re-creation.
    for (
      let i = noteStartIndex;
      i < this.preparedNotes.length &&
      this.preparedNotes[i].msTime < renderEndTimeMs;
      i++
    ) {
      // Skip if already active
      if (this.activeNoteGroups.has(i)) continue;

      const pn = this.preparedNotes[i];
      const noteGroup = this.acquireGroup();

      // Configure the sprite
      const material = this.getTextureForNote(pn.note, {
        inStarPower: pn.inStarPower,
      });
      const sprite = this.ensureSprite(noteGroup, material);

      if (pn.isKick) {
        const kickScale = 0.045;
        sprite.center.set(0.5, 0.5);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(kickScale * aspectRatio, kickScale, kickScale);
        sprite.renderOrder = 1;
        noteGroup.position.x = 0;
      } else if (pn.isOpen) {
        const openScale = 0.11;
        sprite.center.set(0.5, 0.5);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(openScale * aspectRatio, openScale, openScale);
        sprite.renderOrder = 4;
        noteGroup.position.x = 0;
      } else {
        sprite.center.set(0.5, 0.5);
        const aspectRatio =
          sprite.material.map!.image.width / sprite.material.map!.image.height;
        sprite.scale.set(SCALE * aspectRatio, SCALE, SCALE);
        sprite.renderOrder = 4;
        noteGroup.position.x = pn.xPosition;
      }

      sprite.position.x = 0;
      sprite.position.z = 0;
      sprite.material.clippingPlanes = this.clippingPlanes;
      sprite.material.depthTest = false;
      sprite.material.transparent = true;

      noteGroup.position.y = this.noteYPosition(pn.msTime, currentTimeMs, renderEndTimeMs);
      noteGroup.position.z = 0;

      // Sustain tail (guitar only, non-kick, non-open with length > 0)
      if (pn.msLength > 0 && !pn.isKick && pn.lane >= 0) {
        const sustainMesh = this.ensureSustain(noteGroup, pn);
        sustainMesh.visible = true;
      } else {
        // Hide sustain if this pooled group had one from a previous use
        if (noteGroup.children.length > 1) {
          noteGroup.children[1].visible = false;
        }
      }

      // Update overlay decorations for new note
      this.updateNoteOverlays(noteGroup, pn);

      this.activeNoteGroups.set(i, noteGroup);
      this.scene.add(noteGroup);
    }
  }

  // -----------------------------------------------------------------------
  // Overlay decoration helpers
  // -----------------------------------------------------------------------

  /**
   * Compute a note ID string from a PreparedNote, matching the format used
   * by the editor commands (`tick:type`).
   */
  private static LANE_TO_DRUM_TYPE = ['redDrum', 'yellowDrum', 'blueDrum', 'greenDrum'];
  private noteIdFromPrepared(pn: PreparedNote): string {
    const drumType = pn.isKick ? 'kick' : (NotesManager.LANE_TO_DRUM_TYPE[pn.lane] ?? 'redDrum');
    return `${pn.note.tick ?? 0}:${drumType}`;
  }

  /**
   * Update overlay children (selection, confidence, review) on a note group.
   * Called for every active note group each frame.
   */
  private updateNoteOverlays(
    group: THREE.Group,
    pn: PreparedNote,
  ): void {
    const id = this.noteIdFromPrepared(pn);
    const isSelected = this.selectedNoteIds.has(id);
    const isHovered = this.hoveredNoteId === id;

    // -- Selection / hover highlight (child index 2) --
    this.updateSelectionHighlight(group, pn, isSelected, isHovered);

    // -- Confidence indicator (child index 3) --
    this.updateConfidenceIndicator(group, pn, id);

    // -- Review indicator (child index 4) --
    this.updateReviewIndicator(group, id);
  }

  private getHighlightGeometry(): THREE.PlaneGeometry {
    if (!this.highlightGeometry) {
      this.highlightGeometry = new THREE.PlaneGeometry(1, 1);
    }
    return this.highlightGeometry;
  }

  private updateSelectionHighlight(
    group: THREE.Group,
    pn: PreparedNote,
    isSelected: boolean,
    isHovered: boolean,
  ): void {
    // Determine desired highlight size based on note type.
    // Kick notes span the full highway width (0.9), so the highlight should too.
    const noteScale = pn.isKick ? 0.045 : pn.isOpen ? 0.11 : SCALE;
    const highlightW = pn.isKick ? 0.9 : noteScale * 2.2;
    const highlightH = noteScale * 1.8;

    if (isSelected || isHovered) {
      let highlight: THREE.Mesh;

      if (
        group.children.length > CHILD_SELECTION &&
        group.children[CHILD_SELECTION] instanceof THREE.Mesh
      ) {
        highlight = group.children[CHILD_SELECTION] as THREE.Mesh;
      } else {
        // Pad with nulls if needed so index is correct
        while (group.children.length < CHILD_SELECTION) {
          const placeholder = new THREE.Object3D();
          placeholder.visible = false;
          group.add(placeholder);
        }
        highlight = new THREE.Mesh(
          this.getHighlightGeometry(),
          isHovered
            ? getHoverMaterial(this.clippingPlanes)
            : getSelectionMaterial(this.clippingPlanes),
        );
        highlight.renderOrder = 5;
        group.add(highlight);
      }

      highlight.material = isHovered
        ? getHoverMaterial(this.clippingPlanes)
        : getSelectionMaterial(this.clippingPlanes);
      highlight.scale.set(highlightW, highlightH, 1);
      highlight.position.set(0, 0, -0.001);
      highlight.visible = true;
    } else {
      // Hide selection highlight if it exists
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
    pn: PreparedNote,
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

    // Determine color and ring size
    const noteScale = pn.isKick ? 0.045 : SCALE;
    const ringSize = noteScale * 2.8;
    let color: number;
    let opacity: number;
    let ringWidth: number;

    if (conf < 0.5) {
      color = CONFIDENCE_COLORS.low;
      opacity = 0.7;
      ringWidth = 0.003;
    } else if (conf < this.confidenceThreshold) {
      color = CONFIDENCE_COLORS.medium;
      opacity = 0.6;
      ringWidth = 0.002;
    } else {
      color = CONFIDENCE_COLORS.mild;
      opacity = 0.3;
      ringWidth = 0.001;
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
      // Use a ring geometry (torus-like plane)
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

    // Update ring properties
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
        getReviewMaterial(this.clippingPlanes),
      );
      indicator.renderOrder = 6;
      group.add(indicator);
    }

    // Position the dot at the top-right of the note
    indicator.position.set(SCALE * 0.8, SCALE * 0.3, 0.001);
    indicator.visible = true;
  }

  // -----------------------------------------------------------------------
  // Coordinate helpers
  // -----------------------------------------------------------------------

  /**
   * Computes the world-space Y for a note.
   *
   * IMPORTANT: This must produce the same Y that the HighwayEditor overlay
   * computes via `((ms - elapsedMs) / 1000) * highwaySpeed - 1`. We use
   * interpolate() for clarity but the algebra is identical:
   *
   *   interpolate(noteMs, currentMs, currentMs + HIGHWAY_DURATION_MS, -1, 1)
   *   = ((noteMs - currentMs) / HIGHWAY_DURATION_MS) * 2 - 1
   *
   * However the HighwayEditor uses:
   *   ((noteMs - currentMs) / 1000) * highwaySpeed - 1
   *
   * For these to agree we need:
   *   ((noteMs - currentMs) / HIGHWAY_DURATION_MS) * 2 = ((noteMs - currentMs) / 1000) * highwaySpeed
   *   => 2 / HIGHWAY_DURATION_MS = highwaySpeed / 1000
   *   => HIGHWAY_DURATION_MS = 2000 / highwaySpeed
   *
   * With highwaySpeed = 1.5, HIGHWAY_DURATION_MS = 1333.33.
   *
   * But we want HIGHWAY_DURATION_MS = 1500 for the buffer beyond clipping.
   * So instead of using interpolate(-1, 1) we directly compute using
   * highwaySpeed, matching the HighwayEditor formula exactly.
   */
  private noteYPosition(
    noteMs: number,
    _currentMs: number,
    _renderEndMs: number,
  ): number {
    return ((noteMs - _currentMs) / 1000) * this.highwaySpeed - 1;
  }

  // -----------------------------------------------------------------------
  // Sprite pool management
  // -----------------------------------------------------------------------

  /** Get an idle group from the pool or create a new one. */
  private acquireGroup(): THREE.Group {
    const group = this.groupPool.pop();
    if (group) {
      return group;
    }
    return new THREE.Group();
  }

  /** Return a group to the pool after removing it from the scene. */
  private recycleGroup(group: THREE.Group) {
    // Don't dispose materials/geometries -- they're shared or will be reused.
    // Just hide sustain children and push back.
    for (let i = 1; i < group.children.length; i++) {
      group.children[i].visible = false;
    }
    this.groupPool.push(group);
  }

  /**
   * Ensures the group has a Sprite as its first child, configured with
   * the given material. Reuses existing sprite if present.
   */
  private ensureSprite(
    group: THREE.Group,
    material: THREE.SpriteMaterial,
  ): THREE.Sprite {
    if (group.children.length > 0 && group.children[0] instanceof THREE.Sprite) {
      const sprite = group.children[0] as THREE.Sprite;
      sprite.material = material;
      sprite.visible = true;
      return sprite;
    }
    const sprite = new THREE.Sprite(material);
    group.add(sprite);
    return sprite;
  }

  /**
   * Ensures the group has a sustain-tail mesh as its second child.
   * Creates one if needed, or reconfigures the existing one.
   */
  private ensureSustain(
    group: THREE.Group,
    pn: PreparedNote,
  ): THREE.Mesh {
    const sustainWorldHeight = 2 * (pn.msLength / HIGHWAY_DURATION_MS);
    const color =
      pn.lane >= 0 && pn.lane < GUITAR_LANE_COLORS.length
        ? GUITAR_LANE_COLORS[pn.lane]
        : '#FFFFFF';
    const sustainWidth = pn.isOpen ? SCALE * 5 : SCALE * 0.3;

    if (
      group.children.length > 1 &&
      group.children[1] instanceof THREE.Mesh
    ) {
      const mesh = group.children[1] as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshBasicMaterial
      >;
      // Reconfigure geometry (dispose old, create new)
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(sustainWidth, sustainWorldHeight);
      (mesh.material as THREE.MeshBasicMaterial).color.set(color);
      mesh.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
      mesh.visible = true;
      return mesh;
    }

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
    plane.position.y = 0.03 + pn.msLength / HIGHWAY_DURATION_MS;
    plane.renderOrder = 2;
    group.add(plane);
    return plane;
  }
}
