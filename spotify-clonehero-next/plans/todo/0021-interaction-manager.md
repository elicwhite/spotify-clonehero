# Plan 0021: InteractionManager — Hover, Selection, and Hit Testing

> **Dependencies:** 0020 (scene integration)
> **Unlocks:** 0022 (incremental editing)
>
> **Goal:** Add an InteractionManager to the highway that handles raycasting for hit testing. React sends mouse coordinates, Three.js returns what's under the cursor. React decides what to do. Note hover shows an outline/glow shader effect.

## Context

Currently HighwayEditor.tsx does its own coordinate mapping (screenToLane, screenToMs, findNoteAtPosition) using Three.js camera unprojection. This is duplicated logic that belongs in the Three.js layer. The hybrid approach: Three.js raycasts and answers "what's here?", React decides "what to do about it."

## InteractionManager API

```typescript
// lib/preview/highway/InteractionManager.ts

interface HitResult {
  type: 'note';
  noteId: string;       // tick:type composite key
  note: PreparedNote;
  lane: number;
  tick: number;
} | {
  type: 'section';
  tick: number;
  name: string;
} | {
  type: 'highway';      // clicked on empty highway
  lane: number;
  tick: number;          // snapped to grid
  ms: number;
} | null;

class InteractionManager {
  constructor(
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    notesManager: NotesManager,
    sceneOverlays: SceneOverlays,
  )

  // Hit testing — React calls this with mouse coordinates
  hitTest(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number): HitResult

  // Visual state — React tells Three.js what to highlight
  setHoveredNoteId(id: string | null): void    // shows glow/outline
  setSelectedNoteIds(ids: Set<string>): void   // shows selection highlight
  setCursor(type: 'default' | 'pointer' | 'crosshair' | 'grab' | 'grabbing'): string  // returns CSS cursor

  // Coordinate helpers — React needs these for grid snapping, note placement
  screenToLane(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number): number
  screenToTick(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number, tempos, resolution, gridDivision): number
  screenToMs(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number): number

  dispose(): void
}
```

## Hover Glow/Outline Effect

When a note is hovered, it gets a visual outline or glow. Approach: **custom ShaderMaterial** that adds an outline.

### Option A: Outline via scaled duplicate (simpler)
- When hovered, add a slightly larger (1.15x scale) sprite behind the note with a bright tint
- Same texture, tinted white/bright, acts as an outline
- Cheap — just one extra sprite per hovered note

### Option B: Post-processing outline (more polished)
- Render hovered notes to a separate render target
- Apply a blur/edge-detect shader
- Composite back — gives a proper glow effect
- More GPU work but looks great

### Recommendation: Option A for now
Simple, performant, looks good enough. Can upgrade to Option B later.

```typescript
setHoveredNoteId(id: string | null): void {
  // Remove previous hover outline
  if (this.hoverOutline) {
    this.hoverOutline.parent?.remove(this.hoverOutline);
    this.hoverOutline = null;
  }

  if (id === null) return;

  // Find the note's active group
  const group = this.notesManager.getGroupForNote(id);
  if (!group) return;

  // Create outline sprite: same texture, slightly larger, bright tint
  const noteSprite = group.children[0] as THREE.Sprite;
  const outlineSprite = new THREE.Sprite(noteSprite.material.clone());
  outlineSprite.material.color.set(0xffffff);
  outlineSprite.material.opacity = 0.4;
  outlineSprite.scale.copy(noteSprite.scale).multiplyScalar(1.15);
  outlineSprite.center.copy(noteSprite.center);
  outlineSprite.renderOrder = noteSprite.renderOrder - 1;

  group.add(outlineSprite);
  this.hoverOutline = outlineSprite;
}
```

## Selection Highlight

Selected notes get a persistent highlight (distinct from hover):

```typescript
setSelectedNoteIds(ids: Set<string>): void {
  // Remove old highlights
  for (const sprite of this.selectionHighlights.values()) {
    sprite.parent?.remove(sprite);
  }
  this.selectionHighlights.clear();

  // Add new highlights
  for (const id of ids) {
    const group = this.notesManager.getGroupForNote(id);
    if (!group) continue;

    const noteSprite = group.children[0] as THREE.Sprite;
    const highlight = new THREE.Sprite(noteSprite.material.clone());
    highlight.material.color.set(0x4488ff); // blue tint
    highlight.material.opacity = 0.3;
    highlight.scale.copy(noteSprite.scale).multiplyScalar(1.2);
    highlight.center.copy(noteSprite.center);
    highlight.renderOrder = noteSprite.renderOrder - 1;

    group.add(highlight);
    this.selectionHighlights.set(id, highlight);
  }
}
```

## Raycasting for Hit Testing

```typescript
hitTest(canvasX, canvasY, canvasW, canvasH): HitResult {
  // Convert canvas coords to NDC (-1 to 1)
  const ndcX = (canvasX / canvasW) * 2 - 1;
  const ndcY = -(canvasY / canvasH) * 2 + 1;

  this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

  // Check note sprites first (higher priority)
  const noteHits = this.raycaster.intersectObjects(
    this.notesManager.getActiveSprites(),
    false
  );

  if (noteHits.length > 0) {
    const hit = noteHits[0];
    const noteGroup = hit.object.parent as THREE.Group;
    const preparedNote = this.notesManager.getNoteForGroup(noteGroup);
    if (preparedNote) {
      return { type: 'note', noteId: ..., note: preparedNote, lane: ..., tick: ... };
    }
  }

  // Check section banners
  const sectionHit = this.sceneOverlays.hitTestSections(this.raycaster);
  if (sectionHit) {
    return { type: 'section', tick: sectionHit.tick, name: sectionHit.name };
  }

  // Hit the highway plane — return lane + tick at that position
  const highwayHits = this.raycaster.intersectObject(this.highwayPlane);
  if (highwayHits.length > 0) {
    const point = highwayHits[0].point;
    const lane = this.worldXToLane(point.x);
    const ms = this.worldYToMs(point.y);
    const tick = msToTick(ms, ...);
    return { type: 'highway', lane, tick, ms };
  }

  return null;
}
```

## HighwayEditor.tsx Changes

Replace the manual coordinate mapping with InteractionManager calls:

```typescript
// BEFORE (manual coordinate mapping)
const lane = screenToLane(e.clientX, e.clientY);
const ms = screenToMs(e.clientX, e.clientY);
const hitNote = findNoteAtPosition(coords.x, coords.y);

// AFTER (InteractionManager)
const hit = interactionManager.hitTest(localX, localY, canvas.width, canvas.height);
if (hit?.type === 'note') { ... }
if (hit?.type === 'highway') { ... }
```

Mouse event handlers stay in React. Tool mode logic stays in React. Only the "what's under the cursor" question is delegated to Three.js.

## Execution Order

1. Create `InteractionManager.ts` with `hitTest()` method using Three.js Raycaster.
2. Add `screenToLane()`, `screenToTick()`, `screenToMs()` coordinate helpers.
3. Implement `setHoveredNoteId()` with outline sprite effect.
4. Implement `setSelectedNoteIds()` with selection highlight sprites.
5. Add `getGroupForNote()` and `getNoteForGroup()` to NotesManager for bidirectional lookup.
6. Expose InteractionManager from the highway module's public API.
7. Update HighwayEditor.tsx to use InteractionManager for hit testing.
8. Remove manual coordinate mapping functions (screenToLane, screenToMs, findNoteAtPosition, localNoteToScreen).
9. Wire hover/selection visual state: React calls `setHoveredNoteId`/`setSelectedNoteIds` on mouse events.
10. Update cursor style based on what's under the mouse.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

1. Hover over a note — outline/glow appears, cursor changes to pointer.
2. Click a note — selection highlight appears (blue tint).
3. Click empty highway — deselects.
4. Hover over section banner — cursor changes.
5. All tool modes work: cursor, place, erase, bpm, timesig, section.
6. Sheet-music preview unaffected (doesn't use InteractionManager).
