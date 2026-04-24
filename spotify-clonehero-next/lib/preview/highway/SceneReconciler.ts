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
  /** Arbitrary data passed to the renderer. */
  data: unknown;
}

/**
 * Pluggable renderer that knows how to create/recycle Three.js groups
 * for a particular element kind.
 */
export interface ElementRenderer<T = unknown> {
  /** Create a new Three.js group for this element. */
  create(data: T, msTime: number): THREE.Group;
  /** Called when a group is recycled to the pool. Clean up children/materials. */
  recycle(group: THREE.Group): void;
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
  private scene: THREE.Scene;
  private renderers: Record<string, ElementRenderer>;
  private highwaySpeed: number;

  /** Declared elements by key. */
  private elements = new Map<string, ChartElement>();
  /** Sorted by msTime for efficient windowing. */
  private sortedElements: ChartElement[] = [];
  /** Active (visible) groups by key. */
  private activeGroups = new Map<string, THREE.Group>();

  /** Reusable set for updateWindow -- cleared and reused each frame. */
  private inWindowSet = new Set<string>();

  /** Currently selected element keys. */
  private selectedKeys = new Set<string>();
  /** Currently hovered element key. */
  private hoveredKey: string | null = null;

  /** Callbacks for selection/hover visual updates. */
  private onSelectionChange:
    | ((key: string, group: THREE.Group, selected: boolean) => void)
    | null = null;
  private onHoverChange:
    | ((key: string, group: THREE.Group, hovered: boolean) => void)
    | null = null;

  constructor(
    scene: THREE.Scene,
    renderers: Record<string, ElementRenderer>,
    highwaySpeed: number,
  ) {
    this.scene = scene;
    this.renderers = renderers;
    this.highwaySpeed = highwaySpeed;
  }

  // -----------------------------------------------------------------------
  // Declarative API
  // -----------------------------------------------------------------------

  /**
   * Declare the full set of elements that should exist.
   * The reconciler diffs against its internal state and patches the scene.
   * Only elements in the visible window get Three.js groups.
   */
  setElements(elements: ChartElement[]): void {
    const newMap = new Map<string, ChartElement>();
    for (const el of elements) {
      newMap.set(el.key, el);
    }

    // 1. Find removed: in old but not in new
    for (const [key, oldEl] of this.elements) {
      if (!newMap.has(key)) {
        const group = this.activeGroups.get(key);
        if (group) {
          this.scene.remove(group);
          this.renderers[oldEl.kind].recycle(group);
          this.activeGroups.delete(key);
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
          this.scene.remove(group);
          this.renderers[oldEl.kind].recycle(group);
          this.activeGroups.delete(key);
        }
      }
      // Unchanged: keep existing group (if any)
    }

    // 3. Update internal state
    this.elements = newMap;
    this.sortedElements = elements.slice().sort((a, b) => a.msTime - b.msTime);
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
    const startIdx = this.binarySearchStart(
      currentTimeMs - SCROLL_OFF_MARGIN_MS,
    );

    // Track which keys are in the window this frame (reuse set to avoid allocation)
    const inWindow = this.inWindowSet;
    inWindow.clear();

    for (let i = startIdx; i < this.sortedElements.length; i++) {
      const el = this.sortedElements[i];
      if (el.msTime > windowEndMs) break;
      inWindow.add(el.key);

      let group = this.activeGroups.get(el.key);
      if (!group) {
        // Enter window -- create group
        const renderer = this.renderers[el.kind];
        if (!renderer) continue;
        group = this.acquireGroup(el.kind, el, renderer);
        this.scene.add(group);
        this.activeGroups.set(el.key, group);

        // Apply selection/hover state to newly created group
        if (this.selectedKeys.has(el.key)) {
          this.onSelectionChange?.(el.key, group, true);
        }
        if (this.hoveredKey === el.key) {
          this.onHoverChange?.(el.key, group, true);
        }
      }

      // Reposition
      group.position.y = this.noteYPosition(el.msTime, currentTimeMs);
    }

    // Recycle groups that left the window
    for (const [key, group] of this.activeGroups) {
      if (!inWindow.has(key)) {
        this.scene.remove(group);
        const el = this.elements.get(key);
        if (el) {
          this.renderers[el.kind].recycle(group);
        }
        this.activeGroups.delete(key);
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
          this.onSelectionChange?.(key, group, false);
        }
      }
    }
    // Add highlight to newly selected groups
    for (const key of keys) {
      if (!this.selectedKeys.has(key)) {
        const group = this.activeGroups.get(key);
        if (group) {
          this.onSelectionChange?.(key, group, true);
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
        this.onHoverChange?.(this.hoveredKey, oldGroup, false);
      }
    }
    // Add hover to new
    if (key) {
      const newGroup = this.activeGroups.get(key);
      if (newGroup) {
        this.onHoverChange?.(key, newGroup, true);
      }
    }
    this.hoveredKey = key;
  }

  /** Register callback for selection visual updates. */
  setSelectionChangeCallback(
    cb: ((key: string, group: THREE.Group, selected: boolean) => void) | null,
  ): void {
    this.onSelectionChange = cb;
  }

  /** Register callback for hover visual updates. */
  setHoverChangeCallback(
    cb: ((key: string, group: THREE.Group, hovered: boolean) => void) | null,
  ): void {
    this.onHoverChange = cb;
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
      this.scene.remove(group);
      const el = this.elements.get(key);
      if (el) {
        this.renderers[el.kind].recycle(group);
      }
    }
    this.activeGroups.clear();
    this.elements.clear();
    this.sortedElements = [];
    this.selectedKeys.clear();
    this.hoveredKey = null;
    this.onSelectionChange = null;
    this.onHoverChange = null;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Data equality check. Two elements are equal if they have
   * the same kind, msTime, and equivalent data.
   *
   * Uses a two-level deep comparison to handle nested objects like
   * NoteElementData's `note` sub-object without full recursive deep-equal.
   */
  private dataEqual(a: ChartElement, b: ChartElement): boolean {
    if (a.kind !== b.kind || a.msTime !== b.msTime) return false;
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
