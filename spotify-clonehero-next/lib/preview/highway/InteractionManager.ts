import * as THREE from 'three';
import type {SceneReconciler} from './SceneReconciler';
import {NoteRenderer, type NoteElementData} from './NoteRenderer';
import {MarkerRenderer, type MarkerElementData} from './MarkerRenderer';
import {type HitResult, calculateNoteXOffset} from './types';

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
  private reconciler: SceneReconciler;
  private highwaySpeed: number;

  private raycaster = new THREE.Raycaster();
  /** Reusable vector to avoid per-frame allocations. */
  private ndcVec = new THREE.Vector2();
  /** Reusable plane for highway intersection. */
  private highwayPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  /** Reusable vector for intersection point. */
  private intersectionPoint = new THREE.Vector3();

  // Timing data for coordinate conversion
  private timedTempos: {
    tick: number;
    msTime: number;
    beatsPerMinute: number;
  }[] = [];
  private resolution = 480;

  /** Function to get current audio time in ms. */
  private getElapsedMs: () => number;

  /** Cached sprite list for raycasting. Rebuilt when active groups change. */
  private cachedSprites: THREE.Sprite[] = [];
  private cachedSpriteToKey = new Map<THREE.Sprite, string>();
  private cachedGroupCount = -1;

  constructor(
    camera: THREE.PerspectiveCamera,
    reconciler: SceneReconciler,
    highwaySpeed: number,
    getElapsedMs: () => number,
  ) {
    this.camera = camera;
    this.reconciler = reconciler;
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
    this.ndcVec.set((canvasX / canvasW) * 2 - 1, -(canvasY / canvasH) * 2 + 1);
    this.raycaster.setFromCamera(this.ndcVec, this.camera);

    // --- 1. Marker flag boxes (off-highway side rails) ---
    // The flag boxes sit outside the highway lanes, so they can't conflict
    // with notes. Picking them first means the side-mounted text always
    // responds to hover even if a note is at the same tick.
    const flagHit = this.hitTestMarkerFlags(
      canvasX,
      canvasY,
      canvasW,
      canvasH,
    );
    if (flagHit) return flagHit;

    // --- 2. Notes ---
    const noteHit = this.hitTestNotes();
    if (noteHit) return noteHit;

    // --- 3. Marker row lines (cross the highway) ---
    // Lines run through the same X range as notes; checked after notes so
    // an explicit click on a note still wins, but cursor on the line
    // anywhere else still picks the marker.
    const lineHit = this.hitTestMarkerLines(canvasY, canvasH);
    if (lineHit) return lineHit;

    // --- 4. Intersect the highway plane ---
    return this.hitTestHighway(gridDivision);
  }

  // -----------------------------------------------------------------------
  // Note hit testing
  // -----------------------------------------------------------------------

  private hitTestNotes(): HitResult {
    // Rebuild sprite cache only when active groups changed (after updateWindow)
    const activeGroups = this.reconciler.getActiveGroups();
    if (activeGroups.size !== this.cachedGroupCount) {
      this.cachedSprites.length = 0;
      this.cachedSpriteToKey.clear();
      for (const [key, group] of activeGroups) {
        const sprite = NoteRenderer.getSprite(group);
        if (sprite) {
          this.cachedSprites.push(sprite);
          this.cachedSpriteToKey.set(sprite, key);
        }
      }
      this.cachedGroupCount = activeGroups.size;
    }
    if (this.cachedSprites.length === 0) return null;

    const hits = this.raycaster.intersectObjects(this.cachedSprites, false);
    if (hits.length === 0) return null;

    const hitSprite = hits[0].object as THREE.Sprite;
    const key = this.cachedSpriteToKey.get(hitSprite);
    if (!key) return null;

    const el = this.reconciler.getElement(key);
    if (!el || el.kind !== 'note') return null;

    const data = el.data as NoteElementData;
    // Extract noteId from key: 'note:480:redDrum' -> '480:redDrum'
    const noteId = key.startsWith('note:') ? key.slice(5) : key;
    const tick = data.note.tick ?? 0;
    const lane = data.isKick ? 0 : data.lane + 1; // editor lane (0=kick)

    return {
      type: 'note',
      noteId,
      note: {
        note: data.note,
        msTime: el.msTime,
        msLength: data.msLength,
        xPosition: data.xPosition,
        inStarPower: data.inStarPower,
        isKick: data.isKick,
        isOpen: data.isOpen,
        lane: data.lane,
      },
      lane,
      tick,
    };
  }

  // -----------------------------------------------------------------------
  // Marker hit testing
  //
  // Markers are ChartElements in the reconciler with keys like
  // `section:{tick}`, `lyric:{tick}`, `phrase-start:{tick}`,
  // `phrase-end:{endTick}`. Each renders as a horizontal line across the
  // highway plus a side-mounted text flag. The flag is the actual click
  // target — we project its sprite to screen space (using its real scale,
  // anchor, and stack offset) and check whether the cursor is inside the
  // resulting box. The line beneath the flag also counts: a small
  // tolerance around the row's Y matches anywhere on the rule.
  //
  // Within the marker tier, lyric wins over phrase-* (smallest target),
  // then phrase-end, then phrase-start, then section. BPM/TS markers are
  // hit-tested separately by the editor today and are excluded here.
  // -----------------------------------------------------------------------

  /**
   * Tolerance in CSS pixels for the row line's Y. The line spans the
   * highway's full width, so cursor anywhere on the line within this
   * vertical tolerance counts as a marker hit.
   */
  private static readonly MARKER_LINE_TOLERANCE_PX = 8;

  private static readonly MARKER_PRIORITY: ReadonlyArray<string> = [
    'lyric:',
    'phrase-end:',
    'phrase-start:',
    'section:',
  ];

  /** Hit-test only the side-mounted flag boxes (off the highway). */
  private hitTestMarkerFlags(
    canvasX: number,
    canvasY: number,
    canvasW: number,
    canvasH: number,
  ): HitResult {
    if (this.timedTempos.length === 0) return null;

    const tempWorld = new THREE.Vector3();

    for (const prefix of InteractionManager.MARKER_PRIORITY) {
      for (const [key, group] of this.reconciler.getActiveGroups()) {
        if (!key.startsWith(prefix)) continue;

        const sprite = MarkerRenderer.getFlagSprite(group);
        if (!sprite) continue;

        // Sprite center in world space = group.position + sprite.position.
        sprite.getWorldPosition(tempWorld);
        const projected = tempWorld.project(this.camera);
        const spriteScreenX = ((projected.x + 1) / 2) * canvasW;
        const spriteScreenY = ((-projected.y + 1) / 2) * canvasH;

        // Sprite scale is in world units; convert to screen pixels by
        // projecting two world points along its width/height.
        const scaleW = sprite.scale.x;
        const scaleH = sprite.scale.y;
        const right = tempWorld
          .clone()
          .setX(tempWorld.x + scaleW / 2)
          .project(this.camera);
        const top = tempWorld
          .clone()
          .setY(tempWorld.y + scaleH / 2)
          .project(this.camera);
        const halfW = (((right.x - projected.x) * canvasW) / 2) | 0;
        const halfH = (((projected.y - top.y) * canvasH) / 2) | 0;

        // Sprite anchor (sprite.center): right side anchors at the left
        // edge of the box (center.x = 0.0), left side at the right edge
        // (center.x = 1.0). Translate the projected sprite-center pixel
        // into the box's pixel center.
        const anchorOffsetX = ((sprite.center.x - 0.5) * 2 * halfW) | 0;
        const boxCenterX = spriteScreenX - anchorOffsetX;
        const boxCenterY = spriteScreenY;

        if (
          Math.abs(canvasX - boxCenterX) > halfW ||
          Math.abs(canvasY - boxCenterY) > halfH
        ) {
          continue;
        }

        const hit = this.elementToMarkerHit(key, prefix);
        if (hit) return hit;
      }
    }
    return null;
  }

  /** Hit-test only the marker rule lines that cross the highway. */
  private hitTestMarkerLines(canvasY: number, canvasH: number): HitResult {
    if (this.timedTempos.length === 0) return null;

    const tempWorld = new THREE.Vector3();

    for (const prefix of InteractionManager.MARKER_PRIORITY) {
      for (const [key, group] of this.reconciler.getActiveGroups()) {
        if (!key.startsWith(prefix)) continue;

        tempWorld.set(0, group.position.y, 0);
        const projected = tempWorld.project(this.camera);
        const lineScreenY = ((-projected.y + 1) / 2) * canvasH;
        if (
          Math.abs(canvasY - lineScreenY) >
          InteractionManager.MARKER_LINE_TOLERANCE_PX
        ) {
          continue;
        }

        const hit = this.elementToMarkerHit(key, prefix);
        if (hit) return hit;
      }
    }
    return null;
  }

  private elementToMarkerHit(key: string, prefix: string): HitResult {
    const el = this.reconciler.getElement(key);
    if (!el) return null;
    const data = el.data as MarkerElementData;
    const tickStr = key.slice(prefix.length);
    const tick = parseInt(tickStr, 10);
    if (Number.isNaN(tick)) return null;

    switch (prefix) {
      case 'section:':
        return {type: 'section', tick, name: data.text};
      case 'lyric:':
        return {type: 'lyric', tick, text: data.text};
      case 'phrase-start:':
        return {type: 'phrase-start', tick};
      case 'phrase-end:':
        return {type: 'phrase-end', endTick: tick};
      default:
        return null;
    }
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

    // Check for kick notes at this position. Kick notes span the full
    // highway width, so a click anywhere on the highway at a kick's
    // tick position should select the kick note -- but only if the
    // click wasn't on a specific pad lane. Pad notes have higher
    // specificity; if the raycast missed a pad sprite, the user
    // probably intended to click empty highway, not a kick.
    if (lane === 0) {
      const kickHit = this.hitTestKickAtTick(tick, ms);
      if (kickHit) return kickHit;
    }

    return {
      type: 'highway',
      lane,
      tick,
      ms,
    };
  }

  /**
   * Check if there is a kick note at the given tick position.
   * Returns a note HitResult if found, null otherwise.
   */
  private hitTestKickAtTick(tick: number, ms: number): HitResult {
    const elements = this.reconciler.getElements();
    if (elements.length === 0) return null;
    // Tolerance: check notes within a small ms range around the click
    const tolerance = 15; // ms
    // Binary search for the first element >= ms - tolerance
    let lo = 0;
    let hi = elements.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (elements[mid].msTime < ms - tolerance) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < elements.length; i++) {
      const el = elements[i];
      if (el.msTime > ms + tolerance) break;
      if (el.kind !== 'note') continue;
      const data = el.data as NoteElementData;
      if (!data.isKick) continue;
      const noteId = `${data.note.tick ?? 0}:kick`;
      return {
        type: 'note',
        noteId,
        note: {
          note: data.note,
          msTime: el.msTime,
          msLength: data.msLength,
          xPosition: data.xPosition,
          inStarPower: data.inStarPower,
          isKick: data.isKick,
          isOpen: data.isOpen,
          lane: data.lane,
        },
        lane: 0,
        tick: data.note.tick ?? 0,
      };
    }
    return null;
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
      case 'lyric':
      case 'phrase-start':
      case 'phrase-end':
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
