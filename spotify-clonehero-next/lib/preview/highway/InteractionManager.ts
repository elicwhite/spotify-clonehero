import * as THREE from 'three';
import type {SceneReconciler} from './SceneReconciler';
import {NoteRenderer, type NoteElementData} from './NoteRenderer';
import {MarkerRenderer, type MarkerElementData} from './MarkerRenderer';
import {type HitResult} from './types';
import {parseMarkerKey} from './markerKeys';
import {snapTickToGrid} from '@/lib/chart-edit';
import type {InstrumentSchema} from '@/lib/chart-edit/instruments/types';

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
  private schema: InstrumentSchema;

  /**
   * Editor lane → world X position, carried wholesale from the schema
   * (array order matches `schema.lanes` order, which is also the "editor
   * lane" numbering `typeToLane`/`laneToType` use). The renderer's
   * `calculateNoteXOffset` is what each lane's `worldXOffset` mirrors.
   */
  private laneXPositions: number[];

  /**
   * Editor lane the schema's full-width note (kick for drums, open for
   * five-fret) occupies. Full-width notes render in the highway's center
   * (world X 0) rather than in a pad-lane slot, but `worldXToLane` still
   * resolves clicks there to *some* array index — this is the one the
   * schema assigns it, derived (not assumed to be a fixed number) so a
   * schema lane reorder can't silently desync this.
   */
  private fullWidthLane: number;

  /** Half the highway's visual width, from `schema.highwayWidth`. */
  private highwayHalfWidth: number;

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

  /**
   * Cached sprite lists for raycasting. Rebuilt when the reconciler's
   * active-groups revision changes. Notes and markers are cached
   * separately so each hit-test pass only raycasts against its own kind.
   *
   * Tracking by revision (not size) is required: when a hovered marker's
   * data changes, the reconciler recycles the old group and `updateWindow`
   * re-creates a new one at the same key, so the size returns to its
   * prior value and a size-only check would happily reuse a stale sprite
   * reference. The revision bumps on every add/delete, so any in-place
   * replacement still invalidates the cache.
   */
  private cachedNoteSprites: THREE.Sprite[] = [];
  private cachedNoteSpriteToKey = new Map<THREE.Sprite, string>();
  private cachedMarkerSprites: THREE.Sprite[] = [];
  private cachedMarkerSpriteToKey = new Map<THREE.Sprite, string>();
  private cachedGroupsRevision = -1;

  constructor(
    camera: THREE.PerspectiveCamera,
    reconciler: SceneReconciler,
    highwaySpeed: number,
    getElapsedMs: () => number,
    schema: InstrumentSchema,
  ) {
    this.camera = camera;
    this.reconciler = reconciler;
    this.highwaySpeed = highwaySpeed;
    this.getElapsedMs = getElapsedMs;
    this.schema = schema;
    this.laneXPositions = schema.lanes.map(l => {
      if (l.worldXOffset === undefined) {
        throw new Error(
          `${schema.instrument} schema lane ${l.index} (${l.label}) is missing worldXOffset`,
        );
      }
      return l.worldXOffset;
    });
    this.fullWidthLane = schema.lanes.findIndex(l => l.fullWidth);
    this.highwayHalfWidth = schema.highwayWidth / 2;
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

    this.rebuildSpriteCachesIfNeeded();

    // --- 1. Marker flag boxes (off-highway side rails) ---
    // The flag boxes sit outside the highway lanes, so they can't conflict
    // with notes. Picking them first means the side-mounted text always
    // responds to hover even if a note is at the same tick.
    const flagHit = this.hitTestMarkerFlags();
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

  /**
   * Rebuild the per-kind sprite caches when the reconciler's active-groups
   * revision has advanced. Cheap to run on a hit (early exit), so
   * `hitTest()` calls it unconditionally on entry.
   */
  private rebuildSpriteCachesIfNeeded(): void {
    const revision = this.reconciler.getActiveGroupsRevision();
    if (revision === this.cachedGroupsRevision) return;

    this.cachedNoteSprites.length = 0;
    this.cachedNoteSpriteToKey.clear();
    this.cachedMarkerSprites.length = 0;
    this.cachedMarkerSpriteToKey.clear();

    for (const [key, group] of this.reconciler.getActiveGroups()) {
      if (key.startsWith('note:')) {
        const sprite = NoteRenderer.getSprite(group);
        if (sprite) {
          this.cachedNoteSprites.push(sprite);
          this.cachedNoteSpriteToKey.set(sprite, key);
        }
      } else if (InteractionManager.markerPriority(key) >= 0) {
        const sprite = MarkerRenderer.getFlagSprite(group);
        if (sprite) {
          this.cachedMarkerSprites.push(sprite);
          this.cachedMarkerSpriteToKey.set(sprite, key);
        }
      }
    }

    this.cachedGroupsRevision = revision;
  }

  /**
   * Index of `key`'s prefix in MARKER_PRIORITY. Lower = higher priority.
   * Returns -1 if the key isn't a marker.
   */
  private static markerPriority(key: string): number {
    for (let i = 0; i < InteractionManager.MARKER_PRIORITY.length; i++) {
      if (key.startsWith(InteractionManager.MARKER_PRIORITY[i])) return i;
    }
    return -1;
  }

  // -----------------------------------------------------------------------
  // Note hit testing
  // -----------------------------------------------------------------------

  private hitTestNotes(): HitResult {
    if (this.cachedNoteSprites.length === 0) return null;

    const hits = this.raycaster.intersectObjects(this.cachedNoteSprites, false);
    if (hits.length === 0) return null;

    const hitSprite = hits[0].object as THREE.Sprite;
    const key = this.cachedNoteSpriteToKey.get(hitSprite);
    if (!key) return null;

    const el = this.reconciler.getElement(key);
    if (!el || el.kind !== 'note') return null;

    const data = el.data as NoteElementData;
    // Extract noteId from key: 'note:480:redDrum' -> '480:redDrum'
    const noteId = key.startsWith('note:') ? key.slice(5) : key;
    const tick = data.note.tick ?? 0;
    // `data.lane` is the pad-color index (0=red..3=green), which the schema
    // now assigns the identical editor lane numbers to; kick alone needs
    // translating to its (schema-derived) editor lane.
    const lane = data.isKick || data.isOpen ? this.fullWidthLane : data.lane;

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
  // target — Three.js's sprite raycaster catches a hit anywhere inside the
  // billboarded quad. The line beneath the flag also counts: a small
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

  /**
   * Hit-test only the side-mounted flag boxes (off the highway).
   *
   * Sprite raycasting uses Three.js's built-in `Sprite.raycast`, which
   * tests against the screen-aligned billboard quad with the sprite's
   * `center` anchor and `scale` applied — matching what the user sees.
   * That avoids the perspective + billboard subtleties of projecting
   * world-space corners back to screen pixels.
   *
   * Among hit sprites, pick the one with the highest priority
   * (lyric > phrase-end > phrase-start > section). Distance order from
   * the raycaster isn't reliable for picking between stacked markers
   * because all flag sprites share the same depth.
   */
  private hitTestMarkerFlags(): HitResult {
    if (this.cachedMarkerSprites.length === 0) return null;

    const hits = this.raycaster.intersectObjects(
      this.cachedMarkerSprites,
      false,
    );
    if (hits.length === 0) return null;

    let bestKey: string | null = null;
    let bestPriority = Infinity;
    for (const hit of hits) {
      const key = this.cachedMarkerSpriteToKey.get(hit.object as THREE.Sprite);
      if (!key) continue;
      const priority = InteractionManager.markerPriority(key);
      if (priority < 0) continue;
      if (priority < bestPriority) {
        bestKey = key;
        bestPriority = priority;
      }
    }
    if (!bestKey) return null;
    return this.elementToMarkerHit(bestKey);
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

        const hit = this.elementToMarkerHit(key);
        if (hit) return hit;
      }
    }
    return null;
  }

  private elementToMarkerHit(key: string): HitResult {
    const el = this.reconciler.getElement(key);
    if (!el) return null;
    const data = el.data as MarkerElementData;
    const parsed = parseMarkerKey(key);
    if (!parsed) return null;

    switch (parsed.kind) {
      case 'section':
        return {type: 'section', tick: parsed.tick, name: data.text};
      case 'lyric':
        return {type: 'lyric', tick: parsed.tick, text: data.text};
      case 'phrase-start':
        return {type: 'phrase-start', tick: parsed.tick};
      case 'phrase-end':
        return {type: 'phrase-end', endTick: parsed.tick};
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
    if (Math.abs(hit.x) > this.highwayHalfWidth) return null;

    const lane = this.worldXToLane(hit.x);
    const ms = this.worldYToMs(hit.y);
    const tick = this.msToTickSnapped(ms, gridDivision);

    // Check for kick notes at this position. Kick notes span the full
    // highway width, so a click anywhere on the highway at a kick's
    // tick position should select the kick note -- but only if the
    // click wasn't on a specific pad lane. Pad notes have higher
    // specificity; if the raycast missed a pad sprite, the user
    // probably intended to click empty highway, not a kick.
    if (lane === this.fullWidthLane) {
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
        lane: this.fullWidthLane,
        tick: data.note.tick ?? 0,
      };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Coordinate helpers (public, for React to use directly)
  // -----------------------------------------------------------------------

  /**
   * Map a canvas-pixel position to an editor lane index (schema order —
   * see `drums4LaneSchema` in `lib/chart-edit/instruments/drums.ts`).
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
    for (let i = 0; i < this.laneXPositions.length; i++) {
      const dist = Math.abs(worldX - this.laneXPositions[i]);
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
    return snapTickToGrid(this.msToTickRaw(ms), this.resolution, gridDivision);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    // No resources to release -- all objects are lightweight and GC'd.
  }
}
