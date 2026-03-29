# Plan 0020: Move Overlay Drawing into Three.js Scene

> **Dependencies:** 0019 (highway decomposition)
> **Unlocks:** 0021 (interaction manager)
>
> **Goal:** Move all 2D overlay canvas drawing (selection highlights, ghost notes, cursor line, section banners, box select rectangle) into the Three.js scene. Delete the overlay canvas. Everything renders in 3D perspective — no more alignment mismatches.

## Context

Currently `HighwayEditor.tsx` has a transparent `<canvas>` overlaying the Three.js canvas. A `requestAnimationFrame` loop draws 2D rectangles/lines for selections, cursor, ghost notes, and sections. These are in screen space and don't match the 3D perspective (the alignment issue that prompted this refactor).

## What Moves into Three.js

### 1. Selection Highlights
**Current:** 2D filled/stroked rectangle at projected screen position.
**New:** Add a semi-transparent plane or outline mesh behind/around the selected note sprite. Managed by NotesManager — when a note is selected, attach a highlight child mesh to its group.

### 2. Ghost Note Previews (Place mode)
**Current:** Colored circles drawn at cursor tick + each lane position.
**New:** Semi-transparent note sprites at the ghost position. Reuse the same texture as the real note but with reduced opacity. Created/destroyed by NotesManager.

### 3. Cursor Line
**Current:** Green horizontal line drawn across the overlay canvas.
**New:** A THREE.Line or thin PlaneGeometry mesh spanning the highway width at cursorTick's world Y. Updated each frame.

### 4. Section Banners
**Current:** Gold rectangles with text drawn on overlay canvas.
**New:** PlaneGeometry meshes with CanvasTexture for the text label. Positioned at section tick's world Y, spanning highway width. Only visible sections rendered (same world Y clipping).

### 5. Box Select Rectangle
**Current:** Blue dashed rectangle drawn from drag start to current mouse position.
**New:** This one is inherently screen-space (it's a 2D selection box on screen). Keep this as a simple DOM element or minimal overlay. Alternatively, project the four corners into 3D and draw a quad — but a DOM `<div>` with absolute positioning is simpler and correct.

### 6. Confidence Indicators
**Current:** Colored circles/arcs around notes based on ML confidence.
**New:** Tinted ring meshes or colored planes behind notes. Managed by NotesManager similar to selection highlights.

### 7. Review Indicators
**Current:** Small green dots near reviewed notes.
**New:** Small sprite or circle mesh attached to note group.

## Architecture

### SceneOverlays class (new, in `lib/preview/highway/SceneOverlays.ts`)

Manages all overlay elements that live in the Three.js scene:

```typescript
class SceneOverlays {
  private cursorLine: THREE.Line | null = null;
  private sectionBanners: Map<number, THREE.Group> = new Map(); // tick → mesh
  private ghostNotes: THREE.Group[] = [];

  setCursorTick(tick: number, tempos, resolution): void
  setSections(sections: Section[]): void
  setGhostNotes(tick: number, lanes: number[], textures: ...): void
  clearGhostNotes(): void
  update(currentTimeMs: number, highwaySpeed: number): void  // reposition each frame
  dispose(): void
}
```

### NotesManager additions

```typescript
// Selection state
setSelectedNoteIds(ids: Set<string>): void   // updates highlight meshes
setHoveredNoteId(id: string | null): void    // updates hover effect

// Ghost notes (for place mode preview)
setGhostNote(tick: number, lane: number, type: DrumNoteType): void
clearGhostNote(): void
```

### What stays in React (HighwayEditor.tsx)
- Mouse event handlers (onMouseDown/Move/Up) — React owns events
- Tool mode logic (which tool is active, what a click means)
- Box select rectangle — rendered as a DOM `<div>` with absolute positioning
- Popovers (BPM input, section name input) — already DOM elements
- Keyboard shortcut handling — stays in useEditorKeyboard

### What's deleted
- The overlay `<canvas>` element
- The entire `draw()` function in HighwayEditor's useEffect
- `localNoteToScreen()`, `laneScreenBounds()`, `worldToScreen()` helper functions (no longer needed for drawing — hit testing moves to InteractionManager in plan 0021)

## Section Banner Implementation

Section text in 3D requires rendering text to a canvas, then using it as a texture:

```typescript
function createSectionBanner(name: string, width: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 256;
  canvas.height = 32;
  ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
  ctx.font = '14px sans-serif';
  ctx.fillText(name, 8, 20);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthTest: false
  });
  const geometry = new THREE.PlaneGeometry(width, 0.02);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 5; // above notes
  return mesh;
}
```

## Execution Order

1. Create `SceneOverlays.ts` with cursor line rendering.
2. Add cursor line to the Three.js scene (replaces overlay cursor drawing).
3. Move section banner rendering into SceneOverlays (CanvasTexture approach).
4. Add selection highlight support to NotesManager (highlight mesh per selected note).
5. Add ghost note support to NotesManager (semi-transparent sprites at ghost position).
6. Move confidence/review indicators to NotesManager (tinted overlays on note groups).
7. Replace box select rectangle with a DOM `<div>` overlay (minimal, just for the selection box).
8. Delete the overlay `<canvas>` and the entire `draw()` function from HighwayEditor.tsx.
9. Update HighwayEditor.tsx to call SceneOverlays/NotesManager methods instead of drawing.
10. Verify all visual elements render correctly in 3D perspective.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` in `/drum-edit`.

1. Selection highlights align perfectly with note sprites (no offset).
2. Ghost note preview in Place mode shows semi-transparent notes at cursor position.
3. Cursor line renders as a 3D line across the highway.
4. Section banners render with text in 3D perspective.
5. Box select works (DOM div for the rectangle).
6. Confidence overlays render on notes (if confidence data present).
7. Sheet-music preview still works (no SceneOverlays used there — just the base highway).
