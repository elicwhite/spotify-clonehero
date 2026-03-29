# Plan 0019: Decompose highway.ts into Modules

> **Dependencies:** None (pure refactor)
> **Unlocks:** 0020 (scene integration), 0021 (interaction), 0022 (incremental editing), 0023 (waveform)
>
> **Goal:** Split the monolithic `lib/preview/highway.ts` (1550 lines) into focused modules under `lib/preview/highway/`. No behavior changes — sheet-music preview and drum-edit must work identically after this refactor.

## Context

highway.ts contains everything: scene setup, camera, highway mesh, note sprites, pooling, windowed culling, animated textures, texture loading, coordinate helpers, and the render loop. chart-preview (reference project) demonstrates a cleaner architecture with separate classes for each concern.

## Target Structure

```
lib/preview/highway/
  index.ts              # Re-exports setupRenderer() — preserves existing API
  HighwayScene.ts       # Camera, renderer, highway mesh, strikeline, beat lines, clipping planes
  NotesManager.ts       # PreparedNote[], sprite pooling, windowed culling, updateDisplayedNotes()
  TextureManager.ts     # loadNoteTextures(), AnimatedTexture, AnimatedTextureManager
  EventSequence.ts      # Generic cursor-based O(1) amortized lookup (already a class)
  types.ts              # PreparedNote, HighwayConfig, shared interfaces
```

## Module Responsibilities

### HighwayScene.ts
- Creates THREE.WebGLRenderer, THREE.Scene, THREE.PerspectiveCamera
- Camera setup: 90° FOV, z=0.8, y=-1.3, rotation 60°
- Clipping planes (beginning/end)
- Highway mesh (PlaneGeometry with scrolling texture) — both drum and guitar variants
- Strikeline/hitbox sprite
- Resize handling (ResizeObserver or manual)
- `render()` method that calls `renderer.render(scene, camera)`
- `getCamera()`, `getHighwaySpeed()`
- `destroy()` for cleanup

### NotesManager.ts
- `prepare(track, textureManager)` — flattens note groups into PreparedNote[], determines star power
- `updateDisplayedNotes(currentTimeMs)` — windowed culling via EventSequence
- Sprite pooling: `acquireGroup()`, `recycleGroup()`
- Sprite configuration: center, scale, material assignment per note type
- `noteYPosition()` coordinate helper
- `getPreparedNotes()` — expose for interaction/editing
- `getActiveNoteGroups()` — expose for hit testing

### TextureManager.ts
- `loadNoteTextures(instrument, textureLoader, animatedTextureManager)` — all texture loading
- `getTextureForNote(note, options)` — returns correct SpriteMaterial
- AnimatedTexture class (WebP frame extraction via ImageDecoder)
- AnimatedTextureManager (registry, tick(), dispose())
- Texture fallback chains (SP → no-SP → no-dynamic → plain)

### EventSequence.ts
- Already a standalone generic class — just move it to its own file
- `EventSequence<T extends {msTime: number; msLength: number}>`
- `getEarliestActiveEventIndex(startMs)` — cursor-based lookup

### types.ts
- `PreparedNote` interface
- `HighwayRendererHandle` interface (getCamera, getHighwaySpeed)
- Constants: SCALE, HIGHWAY_DURATION_MS, SYNC_MS, etc.

### index.ts
- `setupRenderer()` — composes the modules:
  1. Creates HighwayScene
  2. Creates TextureManager
  3. Creates NotesManager
  4. `prepTrack()` — loads textures via TextureManager, prepares notes via NotesManager
  5. `startRender()` — starts animation loop that calls NotesManager.update + HighwayScene.render
  6. `destroy()` — cleans up all modules
- Returns `{ prepTrack, startRender, destroy, getCamera, getHighwaySpeed }`
- **Identical public API** to the current highway.ts

## Preserving Compatibility

### sheet-music (CloneHeroRenderer.tsx)
Currently imports: `import {setupRenderer} from '@/lib/preview/highway'`
After: `import {setupRenderer} from '@/lib/preview/highway'` (same — index.ts re-exports)

### drum-edit (DrumHighwayPreview.tsx)
Currently imports: `import {setupRenderer} from '@/lib/preview/highway'`
After: identical import, identical API.

Both get `{ prepTrack, startRender, destroy, getCamera, getHighwaySpeed }` — no changes needed.

## Execution Order

1. Create `lib/preview/highway/` directory and `types.ts` with shared constants and interfaces.
2. Extract `EventSequence` to `EventSequence.ts`.
3. Extract `AnimatedTexture`, `AnimatedTextureManager`, and texture loading to `TextureManager.ts`.
4. Extract `NotesManager` (note preparation, pooling, windowed culling) to `NotesManager.ts`.
5. Extract scene setup (camera, highway mesh, strikeline, renderer) to `HighwayScene.ts`.
6. Create `index.ts` that composes all modules into `setupRenderer()` with identical API.
7. Delete the old `lib/preview/highway.ts`.
8. Update imports in `CloneHeroRenderer.tsx` and `DrumHighwayPreview.tsx` if paths changed.
9. Verify sheet-music preview and drum-edit editor work identically.

## Verification

```bash
yarn test
yarn lint

# Verify no behavior change:
# 1. Navigate to /sheet-music, open a chart, toggle "View as Clone Hero" — highway renders, plays back
# 2. Navigate to /drum-edit, load test SNG — highway renders, notes scroll, editing works
# 3. No console errors in either page
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` in `/drum-edit` and any chart in `/sheet-music`.

1. After completing the decomposition, verify both pages render identically to before.
2. Play back in both — notes scroll correctly, highway texture scrolls, strikeline visible.
3. In drum-edit — selection, tool switching, note placement all still work (these use the overlay which hasn't changed yet).
