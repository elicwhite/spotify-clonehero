import * as THREE from 'three';
import {NotesManager} from './NotesManager';
import {SceneOverlays} from './SceneOverlays';
import {
  type HitResult,
  calculateNoteXOffset,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HIGHWAY_HALF_WIDTH = 0.45;

/** Editor lanes: 0=kick, 1=red, 2=yellow, 3=blue, 4=green. */
const LANE_X_POSITIONS = [
  0, // kick -- centered
  ...Array.from({length: 4}, (_, i) => calculateNoteXOffset('drums', i)),
];

// ---------------------------------------------------------------------------
// InteractionManager
// ---------------------------------------------------------------------------

/**
 * Handles hit-testing and coordinate conversion for the highway scene.
 *
 * React sends mouse coordinates, InteractionManager raycasts through the
 * Three.js scene and returns what's under the cursor (note, section, or
 * empty highway). React decides what to do with the result.
 */
export class InteractionManager {
  private camera: THREE.PerspectiveCamera;
  private notesManager: NotesManager;
  private sceneOverlays: SceneOverlays | null;
  private highwaySpeed: number;

  private raycaster = new THREE.Raycaster();
  /** Reusable vector to avoid per-frame allocations. */
  private ndcVec = new THREE.Vector2();
  /** Reusable plane for highway intersection. */
  private highwayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  /** Reusable vector for intersection point. */
  private intersectionPoint = new THREE.Vector3();

  // Timing data for coordinate conversion
  private timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[] = [];
  private resolution = 480;

  /** Function to get current audio time in ms. */
  private getElapsedMs: () => number;

  constructor(
    camera: THREE.PerspectiveCamera,
    notesManager: NotesManager,
    sceneOverlays: SceneOverlays | null,
    highwaySpeed: number,
    getElapsedMs: () => number,
  ) {
    this.camera = camera;
    this.notesManager = notesManager;
    this.sceneOverlays = sceneOverlays;
    this.highwaySpeed = highwaySpeed;
    this.getElapsedMs = getElapsedMs;
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /** Update timing data for tick/ms conversion. */
  setTimingData(
    timedTempos: {tick: number; msTime: number; beatsPerMinute: number}[],
    resolution: number,
  ): void {
    this.timedTempos = timedTempos;
    this.resolution = resolution;
  }

  // -----------------------------------------------------------------------
  // Hit testing
  // -----------------------------------------------------------------------

  /**
   * Perform a raycast hit-test at the given canvas-relative pixel coordinates.
   *
   * Priority order: notes > sections > highway plane.
   * Returns null if the ray misses the highway entirely.
   *
   * @param canvasX  X pixel offset from the left edge of the canvas/div
   * @param canvasY  Y pixel offset from the top edge of the canvas/div
   * @param canvasW  Width of the canvas/div in CSS pixels
   * @param canvasH  Height of the canvas/div in CSS pixels
   * @param gridDivision  Grid snap division (0 = no snapping)
   */
  hitTest(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
    gridDivision: number = 0,
  ): HitResult {
    // Convert canvas coords to NDC (-1 to +1)
    this.ndcVec.set(
      (canvasX / canvasW) * 2 - 1,
      -(canvasY / canvasH) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndcVec, this.camera);

    // --- 1. Check note sprites (highest priority) ---
    const noteHit = this.hitTestNotes();
    if (noteHit) return noteHit;

    // --- 2. Check section banners ---
    const sectionHit = this.hitTestSections(canvasX, canvasY, canvasW, canvasH);
    if (sectionHit) return sectionHit;

    // --- 3. Intersect the highway plane ---
    return this.hitTestHighway(gridDivision);
  }

  // -----------------------------------------------------------------------
  // Note hit testing
  // -----------------------------------------------------------------------

  private hitTestNotes(): HitResult {
    const sprites = this.notesManager.getActiveSprites();
    if (sprites.length === 0) return null;

    const hits = this.raycaster.intersectObjects(sprites, false);
    if (hits.length === 0) return null;

    // The hit is on a sprite, whose parent is the note's THREE.Group
    const hitObject = hits[0].object;
    const noteGroup = hitObject.parent as THREE.Group;
    const result = this.notesManager.getNoteForGroup(noteGroup);
    if (!result) return null;

    return {
      type: 'note',
      noteId: result.id,
      note: result.note,
      lane: result.note.lane === -1 ? 0 : result.note.lane + 1, // editor lane (0=kick)
      tick: result.note.note.tick ?? 0,
    };
  }

  // -----------------------------------------------------------------------
  // Section hit testing
  //
  // Sections are rendered as flat quads at known Y positions. Rather than
  // raycasting against the banner meshes (which are pooled and swapped
  // frequently), we use the same world-space Y tolerance approach used
  // by the old HighwayEditor.tsx -- project each section's world Y to
  // screen space and check pixel distance.
  // -----------------------------------------------------------------------

  /** Tolerance in CSS pixels for section banner hit detection. */
  private static readonly SECTION_HIT_TOLERANCE_PX = 14;

  private hitTestSections(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
  ): HitResult {
    if (!this.sceneOverlays || this.timedTempos.length === 0) return null;

    const elapsedMs = this.getElapsedMs();
    const sections = this.lastSections;
    if (!sections || sections.length === 0) return null;

    const tempWorld = new THREE.Vector3();

    for (const section of sections) {
      const sectionMs = this.tickToMs(section.tick);
      const worldY = this.msToWorldY(sectionMs, elapsedMs);

      // Quick cull: skip if off-screen in world space
      if (worldY < -1.2 || worldY > 1.1) continue;

      // Project to screen space
      tempWorld.set(0, worldY, 0);
      const projected = tempWorld.project(this.camera);
      const screenY = ((-projected.y + 1) / 2) * canvasH;

      if (Math.abs(screenY - canvasY) <= InteractionManager.SECTION_HIT_TOLERANCE_PX) {
        return {
          type: 'section',
          tick: section.tick,
          name: section.name,
        };
      }
    }

    return null;
  }

  /** Sections data, updated from HighwayEditor when overlay state changes. */
  private lastSections: {tick: number; name: string}[] = [];

  /** Update the sections list for section hit-testing. */
  setSections(sections: {tick: number; name: string}[]): void {
    this.lastSections = sections;
  }

  // -----------------------------------------------------------------------
  // Highway plane hit testing
  // -----------------------------------------------------------------------

  private hitTestHighway(gridDivision: number): HitResult {
    const hit = this.raycaster.ray.intersectPlane(
      this.highwayPlane,
      this.intersectionPoint,
    );
    if (!hit) return null;

    // Check if intersection is within highway bounds
    if (Math.abs(hit.x) > HIGHWAY_HALF_WIDTH) return null;

    const lane = this.worldXToLane(hit.x);
    const ms = this.worldYToMs(hit.y);
    const tick = this.msToTickSnapped(ms, gridDivision);

    return {
      type: 'highway',
      lane,
      tick,
      ms,
    };
  }

  // -----------------------------------------------------------------------
  // Coordinate helpers (public, for React to use directly)
  // -----------------------------------------------------------------------

  /**
   * Map a canvas-pixel position to an editor lane index (0=kick, 1-4=pads).
   */
  screenToLane(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
  ): number {
    const world = this.screenToWorldPoint(canvasX, canvasY, canvasW, canvasH);
    if (!world) return 0;
    return this.worldXToLane(world.x);
  }

  /**
   * Map a canvas-pixel position to a millisecond timestamp.
   */
  screenToMs(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
  ): number {
    const world = this.screenToWorldPoint(canvasX, canvasY, canvasW, canvasH);
    if (!world) return 0;
    return this.worldYToMs(world.y);
  }

  /**
   * Map a canvas-pixel position to a tick value, snapped to grid.
   */
  screenToTick(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
    gridDivision: number = 0,
  ): number {
    const ms = this.screenToMs(canvasX, canvasY, canvasW, canvasH);
    return this.msToTickSnapped(ms, gridDivision);
  }

  /**
   * Determine the CSS cursor style based on a HitResult and tool mode.
   */
  getCursor(hit: HitResult, toolMode: string): string {
    if (!hit) {
      switch (toolMode) {
        case 'place':
        case 'bpm':
        case 'timesig':
        case 'section':
          return 'crosshair';
        case 'erase':
          return 'pointer';
        default:
          return 'default';
      }
    }

    switch (hit.type) {
      case 'note':
        switch (toolMode) {
          case 'cursor':
            return 'pointer';
          case 'erase':
            return 'pointer';
          default:
            return 'crosshair';
        }
      case 'section':
        return toolMode === 'cursor' ? 'pointer' : 'crosshair';
      case 'highway':
        switch (toolMode) {
          case 'place':
          case 'bpm':
          case 'timesig':
          case 'section':
            return 'crosshair';
          case 'erase':
            return 'pointer';
          default:
            return 'default';
        }
    }
  }

  // -----------------------------------------------------------------------
  // Internal coordinate conversion
  // -----------------------------------------------------------------------

  /**
   * Unproject a canvas-pixel coordinate to a 3D point on the highway plane (z=0).
   */
  private screenToWorldPoint(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
  ): THREE.Vector3 | null {
    const ndcX = (canvasX / canvasW) * 2 - 1;
    const ndcY = -(canvasY / canvasH) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const result = new THREE.Vector3();
    return raycaster.ray.intersectPlane(this.highwayPlane, result);
  }

  /** Find the closest lane index for a world X coordinate. */
  private worldXToLane(worldX: number): number {
    let bestLane = 0;
    let bestDist = Infinity;
    for (let i = 0; i < LANE_X_POSITIONS.length; i++) {
      const dist = Math.abs(worldX - LANE_X_POSITIONS[i]);
      if (dist < bestDist) {
        bestDist = dist;
        bestLane = i;
      }
    }
    return bestLane;
  }

  /** Convert a world Y coordinate to a millisecond timestamp. */
  private worldYToMs(worldY: number): number {
    // worldY = ((noteMs - elapsedMs) / 1000) * highwaySpeed - 1
    // Solve: noteMs = ((worldY + 1) / highwaySpeed) * 1000 + elapsedMs
    const elapsedMs = this.getElapsedMs();
    return ((worldY + 1) / this.highwaySpeed) * 1000 + elapsedMs;
  }

  /** Convert a world Y coordinate back relative to elapsed time. */
  private msToWorldY(ms: number, elapsedMs: number): number {
    return ((ms - elapsedMs) / 1000) * this.highwaySpeed - 1;
  }

  // -----------------------------------------------------------------------
  // Timing helpers
  // -----------------------------------------------------------------------

  private tickToMs(tick: number): number {
    if (this.timedTempos.length === 0) return 0;
    let idx = 0;
    for (let i = 1; i < this.timedTempos.length; i++) {
      if (this.timedTempos[i].tick <= tick) idx = i;
      else break;
    }
    const tempo = this.timedTempos[idx];
    return (
      tempo.msTime +
      ((tick - tempo.tick) * 60000) / (tempo.beatsPerMinute * this.resolution)
    );
  }

  private msToTickRaw(ms: number): number {
    if (this.timedTempos.length === 0) return 0;
    let idx = 0;
    for (let i = 1; i < this.timedTempos.length; i++) {
      if (this.timedTempos[i].msTime <= ms) idx = i;
      else break;
    }
    const tempo = this.timedTempos[idx];
    return Math.round(
      tempo.tick +
        ((ms - tempo.msTime) * tempo.beatsPerMinute * this.resolution) / 60000,
    );
  }

  private msToTickSnapped(ms: number, gridDivision: number): number {
    const raw = this.msToTickRaw(ms);
    if (gridDivision === 0) return Math.max(0, raw);
    const gridSize = Math.round(this.resolution / gridDivision);
    if (gridSize <= 0) return Math.max(0, raw);
    return Math.max(0, Math.round(raw / gridSize) * gridSize);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    // No resources to release -- all objects are lightweight and GC'd.
  }
}
