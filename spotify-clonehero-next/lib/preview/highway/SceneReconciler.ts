import * as THREE from 'three';
import {HIGHWAY_DURATION_MS} from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A declarative description of an element on the highway. */
export interface ChartElement {
  /** Unique key for identity (survives re-renders). e.g., 'note:2880:yellowDrum' */
  key: string;
  /** Element kind -- determines which renderer handles it. */
  kind: string;
  /** Time position in ms (for windowing). */
  msTime: number;
  /** Optional end time for long-lived elements such as sustain notes. */
  endMsTime?: number;
  /** Arbitrary data passed to the renderer. */
  data: unknown;
}

/**
 * Pluggable renderer that knows how to create/recycle Three.js groups
 * for a particular element kind.
 *
 * `setHovered` and `setSelected` are in-place transitions: the renderer
 * mutates the existing group rather than recycling it. They are typed
 * optional only so test-fixture renderers that don't care about hover or
 * selection can omit them; every production renderer in this repo
 * implements both. If a renderer omits a hook and element data ever
 * carries `isHovered`/`isSelected` flags that change, the reconciler
 * falls back to recycle — that path exists for fixtures, not as a
 * runtime target.
 */
export interface ElementRenderer<T = unknown> {
  /** Create a new Three.js group for this element. */
  create(data: T, msTime: number): THREE.Group;
  /** Called when a group is recycled to the pool. Clean up children/materials. */
  recycle(group: THREE.Group): void;
  /** In-place hover transition. Renderer owns the visual. */
  setHovered?(group: THREE.Group, hovered: boolean): void;
  /** In-place selection transition. Renderer owns the visual. */
  setSelected?(group: THREE.Group, selected: boolean): void;
  /** Per-frame animation update for active groups. */
  update?(group: THREE.Group, currentTimeMs: number): void;
}

// ---------------------------------------------------------------------------
// SceneReconciler
// ---------------------------------------------------------------------------

/**
 * Generic, key-based scene reconciler for highway elements.
 *
 * Callers declare "here are the elements that should exist" via setElements().
 * The reconciler diffs against its internal state, and updateWindow() manages
 * which elements have active Three.js groups based on the visible time window.
 *
 * Inspired by React's reconciler: keys provide stable identity, the reconciler
 * handles the diff, and pooling amortises allocation costs.
 */
export class SceneReconciler {
  /**
   * Parent the reconciler adds and removes element groups under. Typed as
   * `Object3D` so a highway can be reconciled into a group inside a shared
   * scene as well as directly into a scene; the reconciler only calls
   * `.add()` / `.remove()`.
   */
  private root: THREE.Object3D;
  private renderers: Record<string, ElementRenderer>;
  private highwaySpeed: number;
  /**
   * Allowlist of element kinds this reconciler accepts, or null to accept
   * every kind. `setElements` drops anything outside the list before it is
   * stored, so a rejected kind is never sorted, windowed, positioned, or
   * hit-tested. The highway passes `HIGHWAY_ELEMENT_KINDS` (`cell.ts`) here;
   * that constant is the single place deciding what a highway draws.
   */
  private acceptedKinds: ReadonlySet<string> | null;

  /** Declared elements by key. */
  private elements = new Map<string, ChartElement>();
  /** Sorted by msTime for efficient windowing. */
  private sortedElements: ChartElement[] = [];
  /** Prefix maximum end time for finding long sustains behind the window. */
  private maxEndMsPrefix: number[] = [];
  /** Active (visible) groups by key. */
  private activeGroups = new Map<string, THREE.Group>();
  /**
   * Bumped on every structural change to `activeGroups` (add, delete, or
   * recycle-then-recreate at the same key). Consumers like
   * `InteractionManager` cache derived data keyed off active groups; size
   * alone isn't enough because a recycle + re-add at the same key leaves
   * the count untouched but the underlying THREE.Group/sprite differs.
   */
  private activeGroupsRevision = 0;

  /** Reusable set for updateWindow -- cleared and reused each frame. */
  private inWindowSet = new Set<string>();

  /**
   * Total number of `recycle()` calls dispatched to renderers since
   * construction (or the last `resetRecycleCount`). Used to validate the
   * "no recycle for hover/select/drag" invariant in tests and during
   * browser smoke checks. Counts every recycle path: removed elements,
   * changed elements, scrolled-out windowing, and dispose cleanup.
   */
  private recycleCount = 0;

  /** Currently selected element keys. */
  private selectedKeys = new Set<string>();
  /** Currently hovered element key. */
  private hoveredKey: string | null = null;

  constructor(
    root: THREE.Object3D,
    renderers: Record<string, ElementRenderer>,
    highwaySpeed: number,
    acceptedKinds?: ReadonlySet<string>,
  ) {
    this.root = root;
    this.renderers = renderers;
    this.highwaySpeed = highwaySpeed;
    this.acceptedKinds = acceptedKinds ?? null;
  }

  // -----------------------------------------------------------------------
  // Declarative API
  // -----------------------------------------------------------------------

  /**
   * Declare the full set of elements that should exist.
   * The reconciler diffs against its internal state and patches the root.
   * Only elements in the visible window get Three.js groups.
   *
   * Kinds outside `acceptedKinds` are dropped here, before any state is
   * recorded: callers may hand over the whole chart projection and let the
   * reconciler keep the subset its surface draws.
   */
  setElements(elements: ChartElement[]): void {
    const newMap = new Map<string, ChartElement>();
    for (const el of elements) {
      if (this.acceptedKinds && !this.acceptedKinds.has(el.kind)) continue;
      newMap.set(el.key, el);
    }

    // 1. Find removed: in old but not in new
    for (const [key, oldEl] of this.elements) {
      if (!newMap.has(key)) {
        const group = this.activeGroups.get(key);
        if (group) {
          this.root.remove(group);
          this.recycleGroup(oldEl.kind, group);
          this.activeGroups.delete(key);
          this.activeGroupsRevision++;
        }
      }
    }

    // 2. Find changed: same key, different data
    for (const [key, newEl] of newMap) {
      const oldEl = this.elements.get(key);
      if (oldEl && !this.dataEqual(oldEl, newEl)) {
        // Changed -- recycle old group; will be recreated by updateWindow
        const group = this.activeGroups.get(key);
        if (group) {
          this.root.remove(group);
          this.recycleGroup(oldEl.kind, group);
          this.activeGroups.delete(key);
          this.activeGroupsRevision++;
        }
      }
      // Unchanged: keep existing group (if any)
    }

    // 3. Update internal state. `updateWindow` walks `sortedElements` to
    // decide what gets a Three.js group, so it is derived from the deduped
    // map rather than the caller's raw array.
    this.elements = newMap;
    this.sortedElements = Array.from(newMap.values()).sort(
      (a, b) => a.msTime - b.msTime,
    );
    this.maxEndMsPrefix = [];
    let maxEndMs = -Infinity;
    for (const el of this.sortedElements) {
      maxEndMs = Math.max(maxEndMs, el.endMsTime ?? el.msTime);
      this.maxEndMsPrefix.push(maxEndMs);
    }
  }

  /**
   * Called every frame. Manages windowing: creates groups for elements
   * entering the visible window, recycles groups leaving it, and
   * repositions all visible groups.
   */
  updateWindow(currentTimeMs: number): void {
    const windowEndMs = currentTimeMs + HIGHWAY_DURATION_MS;

    // Include a margin below the strikeline so notes scroll off smoothly
    // instead of disappearing instantly. The clipping plane handles the
    // actual visual cutoff.
    const SCROLL_OFF_MARGIN_MS = 200;

    // Binary search for window start in sorted elements
    const windowStartMs = currentTimeMs - SCROLL_OFF_MARGIN_MS;
    let startIdx = this.binarySearchStart(windowStartMs);

    // A sustain remains visible after its note head passes the strikeline.
    // Use the prefix maximum rather than stopping at the immediately prior
    // head: an earlier long sustain can overlap even when a later short note
    // does not.
    if (startIdx > 0 && this.maxEndMsPrefix[startIdx - 1] >= windowStartMs) {
      let lo = 0;
      let hi = startIdx;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this.maxEndMsPrefix[mid] >= windowStartMs) hi = mid;
        else lo = mid + 1;
      }
      startIdx = lo;
    }

    // Track which keys are in the window this frame (reuse set to avoid allocation)
    const inWindow = this.inWindowSet;
    inWindow.clear();

    for (let i = startIdx; i < this.sortedElements.length; i++) {
      const el = this.sortedElements[i];
      if (el.msTime > windowEndMs) break;
      if ((el.endMsTime ?? el.msTime) < windowStartMs) continue;
      inWindow.add(el.key);

      const renderer = this.renderers[el.kind];
      if (!renderer) continue;
      let group = this.activeGroups.get(el.key);
      if (!group) {
        // Enter window -- create group
        group = this.acquireGroup(el.kind, el, renderer);
        this.root.add(group);
        this.activeGroups.set(el.key, group);
        this.activeGroupsRevision++;

        // Apply selection/hover state to newly created group via renderer hooks.
        if (this.selectedKeys.has(el.key)) {
          renderer.setSelected?.(group, true);
        }
        if (this.hoveredKey === el.key) {
          renderer.setHovered?.(group, true);
        }
      }

      // Reposition
      group.position.y = this.noteYPosition(el.msTime, currentTimeMs);
      renderer.update?.(group, currentTimeMs);
    }

    // Recycle groups that left the window
    for (const [key, group] of this.activeGroups) {
      if (!inWindow.has(key)) {
        this.root.remove(group);
        const el = this.elements.get(key);
        if (el) {
          this.recycleGroup(el.kind, group);
        }
        this.activeGroups.delete(key);
        this.activeGroupsRevision++;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Selection and hover
  // -----------------------------------------------------------------------

  /** Set which element keys are selected (for highlight rendering). */
  setSelectedKeys(keys: Set<string>): void {
    // Remove highlight from previously selected groups that are no longer selected
    for (const key of this.selectedKeys) {
      if (!keys.has(key)) {
        const group = this.activeGroups.get(key);
        if (group) {
          const el = this.elements.get(key);
          if (el) this.renderers[el.kind]?.setSelected?.(group, false);
        }
      }
    }
    // Add highlight to newly selected groups
    for (const key of keys) {
      if (!this.selectedKeys.has(key)) {
        const group = this.activeGroups.get(key);
        if (group) {
          const el = this.elements.get(key);
          if (el) this.renderers[el.kind]?.setSelected?.(group, true);
        }
      }
    }
    this.selectedKeys = new Set(keys);
  }

  /** Set which element key is hovered (for hover highlight). */
  setHoveredKey(key: string | null): void {
    if (this.hoveredKey === key) return;

    // Remove hover from old
    if (this.hoveredKey) {
      const oldGroup = this.activeGroups.get(this.hoveredKey);
      if (oldGroup) {
        const oldEl = this.elements.get(this.hoveredKey);
        if (oldEl) this.renderers[oldEl.kind]?.setHovered?.(oldGroup, false);
      }
    }
    // Add hover to new
    if (key) {
      const newGroup = this.activeGroups.get(key);
      if (newGroup) {
        const newEl = this.elements.get(key);
        if (newEl) this.renderers[newEl.kind]?.setHovered?.(newGroup, true);
      }
    }
    this.hoveredKey = key;
  }

  // -----------------------------------------------------------------------
  // Public accessors
  // -----------------------------------------------------------------------

  /** Get the group for a given key (for hit testing). */
  getGroupForKey(key: string): THREE.Group | null {
    return this.activeGroups.get(key) ?? null;
  }

  /** Get all active (visible) groups. */
  getActiveGroups(): Map<string, THREE.Group> {
    return this.activeGroups;
  }

  /**
   * Monotonically-increasing counter that bumps on every structural
   * change to the active-groups map. Use this to invalidate caches that
   * depend on the current set of active groups.
   */
  getActiveGroupsRevision(): number {
    return this.activeGroupsRevision;
  }

  /** Get all elements sorted by msTime (for hit testing by position). */
  getElements(): ChartElement[] {
    return this.sortedElements;
  }

  /** Get a single element by key. O(1) lookup. */
  getElement(key: string): ChartElement | undefined {
    return this.elements.get(key);
  }

  /** Check if a given key is selected. */
  isSelected(key: string): boolean {
    return this.selectedKeys.has(key);
  }

  /** Check if a given key is hovered. */
  isHovered(key: string): boolean {
    return this.hoveredKey === key;
  }

  /** Get the set of selected keys. */
  getSelectedKeys(): Set<string> {
    return this.selectedKeys;
  }

  /** Get the hovered key. */
  getHoveredKey(): string | null {
    return this.hoveredKey;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  dispose(): void {
    // Recycle all active groups
    for (const [key, group] of this.activeGroups) {
      this.root.remove(group);
      const el = this.elements.get(key);
      if (el) {
        this.recycleGroup(el.kind, group);
      }
    }
    this.activeGroups.clear();
    this.elements.clear();
    this.sortedElements = [];
    this.maxEndMsPrefix = [];
    this.selectedKeys.clear();
    this.hoveredKey = null;
  }

  /**
   * Number of `recycle()` calls dispatched since construction or the last
   * `resetRecycleCount()`. The plan-0040 invariant is "0 recycles during
   * hover, select, or drag" while the visible window is stable; tests pin
   * this and a temporary counter reset around an interaction sequence is
   * the cheapest way to validate it in the browser.
   */
  getRecycleCount(): number {
    return this.recycleCount;
  }

  /** Reset the recycle counter to 0. */
  resetRecycleCount(): void {
    this.recycleCount = 0;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Single funnel for renderer.recycle calls. Bumps the recycle counter
   * so callers can audit the "0 recycles for hover/select/drag" invariant.
   */
  private recycleGroup(kind: string, group: THREE.Group): void {
    this.renderers[kind].recycle(group);
    this.recycleCount++;
  }

  /**
   * Data equality check. Two elements are equal if they have
   * the same kind and equivalent data.
   *
   * msTime is intentionally excluded: a position-only change becomes a
   * reposition (handled by `updateWindow` via `group.position.y`) rather
   * than a recycle. Drag-induced and tempo-edit-induced msTime updates
   * therefore don't churn groups.
   *
   * Invariant: no renderer caches `msTime` outside `group.position.y`.
   * `NoteRenderer.create` reads `data.msLength` (in element data, not
   * msTime). A renderer that adds new msTime-derived state must either
   * recompute it in `updateWindow` or expose its own `setMsTime(group, ms)`
   * hook.
   *
   * Uses a two-level deep comparison to handle nested objects like
   * NoteElementData's `note` sub-object without full recursive deep-equal.
   */
  private dataEqual(a: ChartElement, b: ChartElement): boolean {
    if (a.kind !== b.kind) return false;
    if (a.data === b.data) return true;
    if (
      typeof a.data !== 'object' ||
      a.data === null ||
      typeof b.data !== 'object' ||
      b.data === null
    ) {
      return false;
    }

    const aObj = a.data as Record<string, unknown>;
    const bObj = b.data as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      const av = aObj[key];
      const bv = bObj[key];
      if (av === bv) continue;

      // Two-level deep: compare nested plain objects shallowly
      if (
        typeof av === 'object' &&
        av !== null &&
        typeof bv === 'object' &&
        bv !== null &&
        !Array.isArray(av)
      ) {
        const avObj = av as Record<string, unknown>;
        const bvObj = bv as Record<string, unknown>;
        const avKeys = Object.keys(avObj);
        const bvKeys = Object.keys(bvObj);
        if (avKeys.length !== bvKeys.length) return false;
        for (const k of avKeys) {
          if (avObj[k] !== bvObj[k]) return false;
        }
        continue;
      }

      return false;
    }
    return true;
  }

  /**
   * Binary search for the first element with msTime >= currentTimeMs.
   * Elements before this index are behind the camera.
   */
  private binarySearchStart(currentTimeMs: number): number {
    let lo = 0;
    let hi = this.sortedElements.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.sortedElements[mid].msTime < currentTimeMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /**
   * Computes the world-space Y for an element.
   * Matches the formula used by NotesManager and HighwayEditor:
   *   ((noteMs - currentMs) / 1000) * highwaySpeed - 1
   */
  private noteYPosition(noteMs: number, currentMs: number): number {
    return ((noteMs - currentMs) / 1000) * this.highwaySpeed - 1;
  }

  /** Create a new group via the renderer for the given element. */
  private acquireGroup(
    _kind: string,
    el: ChartElement,
    renderer: ElementRenderer,
  ): THREE.Group {
    return renderer.create(el.data, el.msTime);
  }
}
