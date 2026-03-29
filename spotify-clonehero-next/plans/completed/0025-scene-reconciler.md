# Plan 0025: Generic Scene Reconciler for Highway Elements

> **Dependencies:** 0019-0022 (highway decomposition + existing NotesManager)
> **Unlocks:** Efficient incremental edits, lyrics rendering, section rendering on highway
>
> **Goal:** Replace the fragile index-based diffing in NotesManager with a generic, key-based scene reconciler inspired by React's reconciler. Callers declare "here are the elements that should exist" and the reconciler figures out what to add, remove, or update in the Three.js scene.

## Context

### Current problems:
1. **Index-based identity** — `activeNoteGroups` is `Map<number, THREE.Group>` keyed by array index. Every add/remove shifts indices, requiring complex remapping that has caused multiple bugs.
2. **External diffing** — `computeDiff()` and `applyDiff()` are called externally, and the index management between them is fragile.
3. **Notes-only** — The system only handles notes. Lyrics, sections, and other chart elements will need similar rendering and diffing on the highway.
4. **Full rebuild on flag toggle** — Currently `ToggleFlagCommand` triggers a full writeChart → parseChartFile → destroy renderer → rebuild, which is correct but slow.

### React reconciler analogy:
- **Virtual DOM** = the declared set of elements (PreparedNote[], lyrics, sections)
- **Real DOM** = the Three.js scene graph (Groups, Sprites, Meshes)
- **Keys** = stable identity per element (`tick:type` for notes, `tick:name` for sections)
- **Reconciliation** = diff old vs new declared elements, patch the scene minimally
- **Windowing** = only elements in the visible time window get Three.js groups (like virtualized lists)

## Architecture

### SceneReconciler

A generic reconciler that manages keyed chart elements in the Three.js scene.

```typescript
// lib/preview/highway/SceneReconciler.ts

interface ChartElement {
  /** Unique key for identity (survives re-renders). e.g., 'note:2880:yellowDrum' */
  key: string;
  /** Element kind — determines which renderer handles it. */
  kind: string;
  /** Time position in ms (for windowing). */
  msTime: number;
  /** Arbitrary data passed to the renderer. */
  data: unknown;
}

interface ElementRenderer<T = unknown> {
  /** Create a new Three.js group for this element. */
  create(data: T, msTime: number): THREE.Group;
  /** Reconfigure an existing group with new data (optional optimization).
   *  If not implemented, the reconciler uses recycle+recreate. */
  update?(group: THREE.Group, oldData: T, newData: T): void;
  /** Called when a group is recycled to the pool. Clean up children/materials. */
  recycle(group: THREE.Group): void;
}

class SceneReconciler {
  constructor(
    scene: THREE.Scene,
    renderers: Record<string, ElementRenderer>,
    clippingPlanes: THREE.Plane[],
  );

  /**
   * Declare the full set of elements that should exist.
   * The reconciler diffs against its internal state and patches the scene.
   * Only elements in the visible window get Three.js groups.
   */
  setElements(elements: ChartElement[]): void;

  /**
   * Called every frame. Manages windowing: creates groups for elements
   * entering the visible window, recycles groups leaving it, and
   * repositions all visible groups.
   */
  updateWindow(currentTimeMs: number, highwaySpeed: number): void;

  /** Set which element keys are selected (for highlight rendering). */
  setSelectedKeys(keys: Set<string>): void;

  /** Set which element key is hovered (for hover highlight). */
  setHoveredKey(key: string | null): void;

  /** Get the group for a given key (for hit testing). */
  getGroupForKey(key: string): THREE.Group | null;

  /** Get all active (visible) groups. */
  getActiveGroups(): Map<string, THREE.Group>;

  /** Get all elements (for hit testing by position). */
  getElements(): ChartElement[];

  dispose(): void;
}
```

### Key-Based Identity

Elements are identified by their `key` string. The reconciler maintains:

```typescript
// Internal state
private elements: Map<string, ChartElement>;         // declared elements by key
private activeGroups: Map<string, THREE.Group>;       // visible groups by key
private groupPool: Map<string, THREE.Group[]>;        // recycled groups by kind
private sortedElements: ChartElement[];               // sorted by msTime for windowing
```

No array indices. No remapping. Adding/removing elements is O(1) by key.

### Element Renderers

Registered at construction. Each kind has its own renderer:

```typescript
const reconciler = new SceneReconciler(scene, {
  note: new NoteRenderer(textureManager, clippingPlanes),
  section: new SectionRenderer(clippingPlanes),
  lyric: new LyricRenderer(clippingPlanes),    // future
}, clippingPlanes);
```

#### NoteRenderer

```typescript
class NoteRenderer implements ElementRenderer<NoteElementData> {
  create(data: NoteElementData, msTime: number): THREE.Group {
    // Same logic as current NotesManager sprite creation:
    // get texture, create sprite, set scale/center/renderOrder, position
  }

  update(group: THREE.Group, oldData: NoteElementData, newData: NoteElementData): void {
    // NOT implemented — use recycle+recreate for notes.
    // Flag changes swap textures which is complex with animated WebP.
    // Returning undefined signals the reconciler to recycle+recreate.
  }

  recycle(group: THREE.Group): void {
    // Hide children, reset state. Group goes back to pool.
  }
}

interface NoteElementData {
  noteType: NoteType;       // scan-chart numeric type
  flags: number;            // scan-chart flags
  isKick: boolean;
  isOpen: boolean;
  lane: number;
  xPosition: number;
  inStarPower: boolean;
}
```

#### SectionRenderer (replaces SceneOverlays section handling)

```typescript
class SectionRenderer implements ElementRenderer<SectionElementData> {
  create(data: SectionElementData): THREE.Group {
    // Create section flag sprite + marker line (from current SceneOverlays)
  }
  recycle(group: THREE.Group): void { /* hide */ }
}

interface SectionElementData {
  name: string;
  isSelected: boolean;
}
```

### Diff Algorithm

When `setElements()` is called:

```typescript
setElements(newElements: ChartElement[]): void {
  const newMap = new Map(newElements.map(e => [e.key, e]));

  // 1. Find removed: in old but not in new
  for (const [key, oldEl] of this.elements) {
    if (!newMap.has(key)) {
      const group = this.activeGroups.get(key);
      if (group) {
        this.scene.remove(group);
        this.renderers[oldEl.kind].recycle(group);
        this.poolGroup(oldEl.kind, group);
        this.activeGroups.delete(key);
      }
    }
  }

  // 2. Find added or changed
  for (const [key, newEl] of newMap) {
    const oldEl = this.elements.get(key);
    if (!oldEl) {
      // Added — will be created by updateWindow if in visible range
    } else if (oldEl.data !== newEl.data) {
      // Changed — recycle old group, will be recreated by updateWindow
      const group = this.activeGroups.get(key);
      if (group) {
        this.scene.remove(group);
        this.renderers[oldEl.kind].recycle(group);
        this.poolGroup(oldEl.kind, group);
        this.activeGroups.delete(key);
      }
    }
    // Unchanged: keep existing group
  }

  // 3. Update internal state
  this.elements = newMap;
  this.sortedElements = newElements.slice().sort((a, b) => a.msTime - b.msTime);
}
```

### Windowing

`updateWindow(currentTimeMs)` scans the sorted elements for the visible window and creates/recycles groups:

```typescript
updateWindow(currentTimeMs: number, highwaySpeed: number): void {
  const windowEndMs = currentTimeMs + HIGHWAY_DURATION_MS;

  // Binary search for window start in sorted elements
  const startIdx = this.binarySearchStart(currentTimeMs);

  // Track which keys are in the window this frame
  const inWindow = new Set<string>();

  for (let i = startIdx; i < this.sortedElements.length; i++) {
    const el = this.sortedElements[i];
    if (el.msTime > windowEndMs) break;
    inWindow.add(el.key);

    let group = this.activeGroups.get(el.key);
    if (!group) {
      // Enter window — create group
      group = this.acquireGroup(el.kind);
      const renderer = this.renderers[el.kind];
      // Configure the group (renderer.create or reconfigure from pool)
      this.configureGroup(group, el, renderer);
      this.scene.add(group);
      this.activeGroups.set(el.key, group);
    }

    // Reposition
    group.position.y = this.noteYPosition(el.msTime, currentTimeMs);
  }

  // Recycle groups that left the window
  for (const [key, group] of this.activeGroups) {
    if (!inWindow.has(key)) {
      this.scene.remove(group);
      const el = this.elements.get(key)!;
      this.renderers[el.kind].recycle(group);
      this.poolGroup(el.kind, group);
      this.activeGroups.delete(key);
    }
  }
}
```

### How Callers Use It

#### Editor (drum-edit / drum-transcription):

```typescript
// On initial load:
const track = parsedChart.trackData.find(t => t.instrument === 'drums');
reconciler.setElements(trackToElements(track));

// On edit (flag toggle, add note, delete note):
// Command modifies ChartDocument
// Full rebuild: writeChart → parseChartFile → new Track
const newTrack = newParsedChart.trackData.find(t => t.instrument === 'drums');
reconciler.setElements(trackToElements(newTrack));
// The reconciler diffs internally and only patches what changed.

// Every frame:
reconciler.updateWindow(audioManager.currentTime * 1000, highwaySpeed);
```

#### Sheet-music (preview only):

```typescript
// On load:
const track = parsedChart.trackData.find(t => t.instrument === 'drums');
reconciler.setElements(trackToElements(track));

// Every frame:
reconciler.updateWindow(audioManager.currentTime * 1000, highwaySpeed);

// Never calls setElements again — no edits.
```

### trackToElements helper

Converts a scan-chart Track to ChartElement[]:

```typescript
function trackToElements(track: Track, tempos: TimedTempo[], resolution: number): ChartElement[] {
  const elements: ChartElement[] = [];
  for (const group of track.noteEventGroups) {
    for (const note of group) {
      const msTime = note.msTime;
      const key = `note:${note.tick}:${note.type}`;
      elements.push({
        key,
        kind: 'note',
        msTime,
        data: {
          noteType: note.type,
          flags: note.flags,
          isKick: note.type === noteTypes.kick,
          // ... etc
        },
      });
    }
  }
  return elements;
}
```

## Migration from NotesManager

### What NotesManager currently does:
1. Loads textures (`prepare`)
2. Pre-computes PreparedNote[] from Track
3. Manages sprite pooling (acquireGroup/recycleGroup)
4. Windowed culling via EventSequence
5. Sprite creation and positioning
6. Selection/hover/confidence overlays
7. External diff API (computeDiff/applyDiff)

### What moves to SceneReconciler:
- Key-based identity (replaces index-based)
- Diffing logic (internal, not external)
- Pooling (generic, per-kind)
- Windowing (using sorted array + binary search instead of EventSequence)

### What stays in NoteRenderer:
- Texture loading and selection (getTextureForNote)
- Sprite creation and configuration (scale, center, renderOrder)
- Selection/hover highlight management

### What's deleted:
- `computeDiff()` / `applyDiff()` static methods
- Index-based `activeNoteGroups: Map<number, Group>`
- Index remapping logic
- `prepareNotesFromDoc()` in useEditCommands.ts
- `isIncrementalCommand()` classification

## Execution Order

1. **Create `SceneReconciler.ts`** with the generic reconciler: setElements, updateWindow, key-based identity, pooling.

2. **Create `NoteRenderer.ts`** — extract note sprite creation/configuration from NotesManager into an ElementRenderer.

3. **Create `trackToElements()` helper** — converts scan-chart Track to ChartElement[].

4. **Integrate into `index.ts`** — replace NotesManager usage with SceneReconciler + NoteRenderer.

5. **Update `HighwayEditor.tsx`** — callers use `reconciler.setElements()` instead of `applyDiff()`.

6. **Update `useEditCommands.ts`** — all commands use the full rebuild path (writeChart → parseChartFile → setElements). Remove `isIncrementalCommand`, `prepareNotesFromDoc`, `computeDiff`.

7. **Move section rendering** from SceneOverlays into a SectionRenderer + the reconciler.

8. **Update InteractionManager** — use reconciler's getGroupForKey/getActiveGroups for hit testing.

9. **Delete old code** — remove computeDiff, applyDiff, EXECUTE_COMMAND_INCREMENTAL, index remapping.

10. **Test** — verify flag toggle, add/delete/move notes, undo/redo, scroll, playback all work correctly.

## Unit Tests

The reconciler is pure logic mapping keys to operations — no real WebGL needed. Mock `THREE.Scene`, `THREE.Group`, etc. to verify the right methods are called.

### Test file: `lib/preview/highway/__tests__/SceneReconciler.test.ts`

#### Core Diffing

```
describe('setElements diffing', () => {
  'empty → elements = all creates'
  'elements → empty = all removes'
  'same elements, same data = no creates or removes'
  'same keys, different data = recycle old + create new (update)'
  'mixed: some added, some removed, some unchanged, some changed'
  'reordering elements with same keys = no ops (identity by key, not position)'
  'adding an element between existing ones does not affect neighbors'
  'elements at same tick but different types (chord) are independent'
})
```

#### Windowing

```
describe('updateWindow', () => {
  'elements outside window do not get groups created'
  'element entering window gets group created via renderer.create()'
  'element leaving window gets recycled via renderer.recycle()'
  'element changed while outside window — no group churn'
  'scrolling forward — groups cycle: old recycled, new created'
  'seeking backward — window resets, correct groups visible'
  'element exactly at window start boundary — included'
  'element exactly at window end boundary — excluded'
  'empty elements list — no crash, no groups'
})
```

#### Diff + Window Interaction

```
describe('setElements + updateWindow integration', () => {
  'add element inside visible window — group appears on next updateWindow'
  'remove element inside visible window — group recycled on next updateWindow'
  'change element inside visible window — old group recycled, new created on next updateWindow'
  'change element outside visible window — no group churn, correct when scrolled to'
  'add element then scroll to it — group created when it enters window'
})
```

#### Pooling

```
describe('pooling', () => {
  'recycled groups are reused on next create (pool shrinks)'
  'pools are per-kind (note pool separate from section pool)'
  'pool does not grow unbounded (cap at reasonable limit)'
  'creating when pool empty allocates new group'
})
```

#### Selection and Hover

```
describe('selection and hover', () => {
  'setSelectedKeys applies highlight to visible groups'
  'setHoveredKey applies hover effect to one group'
  'changing selection updates highlights without recreating groups'
  'selection on element outside window — no crash, highlight appears when scrolled in'
  'clearing selection removes all highlights'
  'hover cleared on setHoveredKey(null)'
})
```

### Test file: `lib/preview/highway/__tests__/NoteRenderer.test.ts`

```
describe('NoteRenderer', () => {
  'create() returns group with sprite child'
  'create() kick note — centered, smaller scale, renderOrder 1'
  'create() regular note — lane position, standard scale, renderOrder 4'
  'create() cymbal vs tom — different textures'
  'create() with star power — SP texture variant'
  'create() with accent/ghost — dynamic texture variant'
  'recycle() hides all children'
  'recycle() does not dispose materials (shared)'
})
```

### Test file: `lib/preview/highway/__tests__/trackToElements.test.ts`

```
describe('trackToElements', () => {
  'converts empty track to empty array'
  'converts kick note to element with key note:tick:kickType'
  'converts drum notes with correct msTime from tempo map'
  'converts cymbal flags correctly'
  'converts chord (multiple notes at same tick) to separate elements'
  'handles star power sections'
  'sorted by msTime'
})
```

### Test file: `lib/preview/highway/__tests__/reconciler-roundtrip.test.ts`

Integration tests using real chart-edit operations:

```
describe('edit round-trip through reconciler', () => {
  'toggle cymbal on yellow note — setElements shows changed flags, same key'
  'add note — setElements shows one new element'
  'delete note — setElements shows one removed element'
  'move note — setElements shows removed at old tick + added at new tick'
  'undo after toggle — setElements restores original state'
  'BPM change — all elements get new msTime values'
  'multiple rapid edits — each setElements produces correct diff'
})
```

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use the editor MCP tools to test at `http://localhost:3000/drum-edit?project=mnb1tq37-dp10z9`:

1. `editor_seek` to a section with notes.
2. `editor_select_note` a yellow cymbal.
3. `editor_toggle_flag` cymbal — note changes texture, doesn't disappear.
4. `editor_toggle_flag` cymbal again — note changes back.
5. `editor_undo` / `editor_redo` — notes update correctly.
6. `editor_add_note` — note appears instantly.
7. `editor_delete_selected` — note disappears instantly.
8. Scroll through the song — notes enter/leave the window smoothly.
9. Sheet-music highway preview still works (no reconciler edits, just windowing).
