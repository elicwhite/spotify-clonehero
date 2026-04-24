# chart-preview vs highway.ts -- Detailed Comparison Report

**Date:** 2026-03-18
**Files compared:**

- `highway.ts`: `/Users/eliwhite/projects/spotify-clonehero/spotify-clonehero-next/lib/preview/highway.ts` (806 lines)
- `chart-preview`: `~/projects/chart-preview/src/ChartPreview.ts` (1760 lines) + supporting files

---

## 1. Architecture Differences

### highway.ts

- Single-file, functional/closure-based architecture
- `setupRenderer()` returns a methods object (prepTrack, startRender, destroy, getCamera, getHighwaySpeed)
- React-coupled: takes `RefObject<HTMLDivElement>` for sizing/container
- External `AudioManager` injected from `lib/preview/audioManager.ts`
- All notes are pre-generated at setup time and added to a single `THREE.Group` that gets repositioned each frame
- No event system; relies on external `AudioManager` for playback state

### chart-preview

- Multi-file, class-based OOP architecture:
  - `ChartPreview` -- core renderer class (static factory `create()`)
  - `ChartPreviewPlayer` -- Web Component with full UI controls (`<chart-preview-player>`)
  - `SharedAudioContext` -- shared AudioContext manager for multi-instance support
  - `SngLoader` -- .sng file loading, chart parsing, texture preparation
- Framework-agnostic: takes a plain `HTMLDivElement` container
- Internal `AudioManager` class that manages its own audio playback, decoding, seeking
- `SilentAudioManager` fallback when AudioContext is unavailable
- Uses `EventEmitter3` for progress/end events
- Has dedicated helper classes: `ChartCamera`, `ChartRenderer`, `NotesManager`, `EventSequence`, `AnimatedTextureManager`
- **Category:** Feature addition / Major refactor. The class-based architecture is cleaner but highway.ts's functional approach is simpler for our use case where we control the AudioManager externally.

---

## 2. Note Rendering -- Windowed vs Pre-generated (Critical Difference)

### highway.ts

- **Pre-generates ALL notes** at setup time in `generateNoteHighway()`. Every note in the entire chart is created as a `THREE.Sprite` and added to a single `THREE.Group`. The group's Y position is then shifted each frame based on audio time.
- For a song with 10,000 notes, all 10,000 sprites exist in the scene from the start.

### chart-preview

- **Windowed/dynamic note rendering** via `NotesManager.updateDisplayedNotes()`:
  - Calculates a visible time window: `[chartCurrentTimeMs, chartCurrentTimeMs + HIGHWAY_DURATION_MS]` where `HIGHWAY_DURATION_MS = 1500`
  - Only creates sprites for notes within this window
  - Removes sprites that have scrolled past or are not yet visible
  - Uses `EventSequence.getEarliestActiveEventIndex()` for efficient O(1) amortized lookups via cursor-based traversal
  - Note positions are calculated via `interpolate()` to map from time-space to screen-space Y coordinates (-1 to 1)
- **Category:** Major performance improvement. highway.ts with a dense chart will have massive scene graphs with thousands of invisible objects. chart-preview only ever has ~100-200 active sprites. This is the single biggest performance difference.

---

## 3. Drums-Specific Differences

### 3a. Drum Note Textures

**highway.ts:**

- 4 tom textures: `drum-tom-{blue,green,red,yellow}.webp`
- 4 cymbal textures: `drum-cymbal-{blue,green,red,yellow}.webp`
- 1 kick texture: `drum-kick.webp`
- Total: 9 drum textures, loaded from `/assets/preview/assets2/`
- No ghost note, accent, or star power drum variants

**chart-preview:**

- Loads textures from `https://static.enchor.us/preview-{name}.webp`
- For each color (red, yellow, blue, green), loads:
  - Tom variants: normal, ghost, accent, and SP versions of each (4 colors x 3 dynamics x 2 SP states = 24 tom textures)
  - Cymbal variants (same matrix, but red has no cymbal): (3 colors x 3 dynamics x 2 SP states = 18 cymbal textures)
  - Uses `noteFlags.ghost` and `noteFlags.accent` for dynamic-specific textures
- Kick: normal, double-kick, and SP variants (4 textures)
- Total: ~46 drum textures
- **Category:** Major feature addition. Ghost/accent/SP drum textures provide much better visual feedback.

### 3b. Drum Note Flag Handling Bug

**highway.ts** has a **duplicate condition bug** at lines 370-376:

```typescript
if (note.type == noteTypes.greenDrum && note.flags & noteFlags.cymbal) {
  return cymbalTextures.green;
} else if (note.type == noteTypes.greenDrum && note.flags & noteFlags.cymbal) {
  // DUPLICATE -- this branch is never reached
  return cymbalTextures.green;
}
```

The first two conditions are identical. The second branch is dead code.

**chart-preview** does not have this bug -- it uses a clean Map-based lookup (`noteMaterials.get(note.type)?.get(note.flags)`) that avoids if/else chains entirely.

**Category:** Bug fix. The duplicate condition doesn't cause incorrect behavior (the first branch catches it), but it suggests the second was meant to be a different condition (perhaps `redDrum` with cymbal, which is excluded in chart-preview since red has no cymbal variant in pro drums).

### 3c. Drum Cymbal Detection (Red Cymbal)

**highway.ts:**

- Loads and supports red cymbal textures (`drum-cymbal-red.webp`)
- Will render a red cymbal if the note has the cymbal flag

**chart-preview:**

- Explicitly excludes red cymbals: `if (colorKey !== noteTypes.redDrum)` when loading cymbal textures
- This is correct -- in pro drums, red is always a snare (tom), never a cymbal

**Category:** Bug fix / correctness improvement.

### 3d. Disco Flip Handling

**highway.ts:** Does not handle disco flip or disco-noflip flags at all.

**chart-preview:** `adjustParsedChart()` processes disco flags:

- `discoNoflip` flag is stripped (no visual change needed)
- `disco` flag swaps red and yellow notes and their tom/cymbal flags (red tom becomes yellow cymbal and vice versa)

**Category:** Feature addition. Disco flip is a Clone Hero modifier that chart-preview handles correctly.

### 3e. Kick Drum Rendering

**highway.ts:**

- Kick scale: `0.045`
- Kick center: `new THREE.Vector2(0.5, -0.5)` -- centered horizontally, offset downward
- Kick position: centered at X=0 (no lane offset applied)
- Kick renderOrder: 1

**chart-preview:**

- Kick scale: `0.045` (same)
- Kick center: `new THREE.Vector2(0.62, -0.5)` -- offset rightward by 0.12
- Kick position: uses `calculateNoteXOffset()` which returns lane 2 (center lane)
- Kick renderOrder: 1

**Category:** Visual fix. The 0.62 center offset in chart-preview likely corrects the kick texture alignment.

### 3f. Drum Highway Width

Both use `0.9` for drum highway width. No difference.

### 3g. Drum Strikeline

**highway.ts:** Uses `isolated-drums.png` from local assets.

**chart-preview:** Uses `preview-drums-strikeline.png` from `https://static.enchor.us/`. This is likely an updated/improved strikeline graphic.

**Category:** Visual improvement (new asset).

---

## 4. General Rendering Differences

### 4a. Camera Setup

Both are identical:

- FOV: 90
- Aspect: 1:1 (updated on resize)
- Near clip: 0.01, Far clip: 10
- Position: z=0.8, y=-1.3
- Rotation: 60 degrees around X axis

No differences.

### 4b. Renderer Setup

Both use:

- `antialias: true`
- `localClippingEnabled = true`
- `outputColorSpace = THREE.LinearSRGBColorSpace`

No differences.

### 4c. Clipping Planes

Both use identical clipping planes:

- Beginning: `Plane(Vector3(0, 1, 0), 1)`
- End: `Plane(Vector3(0, -1, 0), 0.9)`

No differences.

### 4d. Highway Scroll Speed

**highway.ts:**

- `highwaySpeed = 1.5`
- Scroll: `scrollPosition = -1 * (elapsedTime / 1000) * highwaySpeed`
- Highway texture offset: `highwayTexture.offset.y = -1 * scrollPosition`
- Notes group Y: `scrollPosition` directly

**chart-preview:**

- `HIGHWAY_DURATION_MS = 1500`
- Scroll: `scrollPosition = -0.9 * (chartCurrentTimeMs / 1000) * (HIGHWAY_DURATION_MS / 1000)`
  - Which simplifies to: `-0.9 * (time / 1000) * 1.5` = `-1.35 * time/1000`
- Highway texture offset only (no notes group repositioning -- notes are individually positioned)
- The `-0.9` factor is a scale correction for the visible highway length

**Note:** highway.ts moves the entire notes group, while chart-preview positions each visible note individually. The scroll speeds are effectively different due to the 0.9 factor.

**Category:** Visual difference / potential fix. The 0.9 factor in chart-preview may correct for the clipping plane range.

### 4e. Note Positioning (Y axis)

**highway.ts:**

- Note Y position set at creation time: `notesGroup.position.y = (time / 1000) * highwaySpeed - 1`
- Group moves with highway scroll

**chart-preview:**

- Note Y position calculated per-frame: `interpolate(note.msTime, chartCurrentTimeMs, renderEndTimeMs, -1, 1)`
- Maps the note's time to the [-1, 1] Y range based on current time window
- The strikeline is at Y=-1, top of highway is at Y=1

**Category:** Architectural improvement. Per-frame positioning is more accurate and cleaner.

### 4f. Highway Width by Instrument Type

**highway.ts:**

- Guitar: 1.0
- Drums: 0.9

**chart-preview:**

- Guitar (5-fret): 1.0
- Drums: 0.9
- 6-fret (GHL): 0.7

**Category:** Feature addition (6-fret support).

### 4g. NOTE_SPAN_WIDTH

**highway.ts:** `NOTE_SPAN_WIDTH = 0.99`
**chart-preview:** `NOTE_SPAN_WIDTH = 0.95`

**Category:** Visual adjustment. Slightly narrower note spread in chart-preview.

---

## 5. Texture Differences

### 5a. Texture Sources

**highway.ts:**

- All textures loaded from local `/assets/preview/` paths
- Highway: `/assets/preview/assets/highways/wor.png`
- Guitar strikeline: `/assets/preview/assets/isolated.png`
- Drum strikeline: `/assets/preview/assets/isolated-drums.png`
- Guitar notes: `/assets/preview/assets2/strum{0-4}.webp`, `hopo{0-4}.webp`, `tap{0-4}.png`
- Open note: `/assets/preview/assets2/strum5.webp`
- Drum notes: `/assets/preview/assets2/drum-tom-{color}.webp`, `drum-cymbal-{color}.webp`, `drum-kick.webp`

**chart-preview:**

- All textures loaded from CDN: `https://static.enchor.us/`
- Highway: `preview-highway.png`
- Strikeline: `preview-drums-strikeline.png`, `preview-5fret-strikeline.png`, `preview-6fret-strikeline.png`
- Note textures follow a naming pattern: `preview-{instrumentType}-{color}-{type}{-modifier}{-sp}.webp`
  - Example: `preview-drums-red-tom-ghost-sp.webp`
  - Example: `preview-5fret-green-strum.webp`
- All note textures support animated WebP

**Category:** Infrastructure difference. CDN-hosted textures are better for an npm package but require internet. For our self-hosted app, local textures are fine but we'd need to update them.

### 5b. Animated Textures

**highway.ts:** No animation support. All textures are static.

**chart-preview:** Full animated WebP support via `AnimatedTexture` class:

- Uses `ImageDecoder` API (Chromium-only) for animated WebP
- Pre-decodes all frames during init for synchronous per-frame updates
- Falls back to static textures on unsupported browsers
- `AnimatedTextureManager` ticks all animated textures each frame
- `areAnimationsSupported()` exported for feature detection

**Category:** Feature addition. Animated note textures look better but are Chrome-only.

### 5c. Color Space

**highway.ts:** No explicit colorSpace set on textures.

**chart-preview:** Sets `texture.colorSpace = THREE.SRGBColorSpace` on loaded textures.

**Category:** Visual fix. Proper sRGB color space prevents washed-out colors.

### 5d. Placeholder Textures

**highway.ts:** If a texture fails to load, throws or shows nothing.

**chart-preview:** Creates a magenta 32x32 placeholder texture via `createPlaceholderTexture()` so notes still render visually even if texture loading fails.

**Category:** Bug fix / robustness improvement.

---

## 6. Colors and Visual Styling

### 6a. Note Colors (Sustain Tails)

Both use the same base colors:

- Green: `#01B11A`
- Red: `#DD2214`
- Yellow: `#DEEB52`
- Blue: `#006CAF`
- Orange: `#F8B272`

**chart-preview adds:**

- Open note sustain color: `#8A0BB5` (purple)
- Default fallback: `#FFFFFF` (white)
- Drum note sustains also use these colors (mapped by drum noteType)

**highway.ts** only has guitar sustain colors (no drum sustain support, though drums don't have sustains anyway).

### 6b. Sustain Width

**highway.ts:** `SCALE * 0.175`
**chart-preview:** `SCALE * 0.3` for normal notes, `SCALE * 5` for open notes

**Category:** Visual improvement. Wider sustains are more visible; open note sustains properly span the highway.

### 6c. Sustain Y Position

**highway.ts:** `plane.position.y = (length / 1000 / 2) * highwaySpeed + SCALE / 2`
**chart-preview:** `plane.position.y = 0.03 + note.msLength / HIGHWAY_DURATION_MS`

**Category:** Fix. chart-preview's calculation is simpler and tied to the constant highway duration.

---

## 7. Performance Improvements

### 7a. Windowed Note Rendering (Most Significant)

As described in section 2, chart-preview only renders notes within a 1500ms time window. highway.ts pre-renders everything. For a 5-minute song with 5000 notes, highway.ts creates 5000+ THREE objects at startup; chart-preview creates ~50-100 at any given time.

**Impact:** Massive reduction in scene graph size, draw calls, and memory usage.

### 7b. EventSequence for O(1) Lookups

chart-preview's `EventSequence` class maintains a cursor-based index that efficiently finds the earliest active event. It avoids rescanning from the beginning each frame.

**highway.ts** has no equivalent -- it moves the whole group and relies on clipping planes to hide off-screen notes (but they're still in the scene graph and consume GPU resources).

### 7c. Throttled Progress Events

chart-preview throttles `progress` events to `DEFAULT_PROGRESS_INTERVAL_MS = 50ms` to reduce event handling overhead.

highway.ts has no event system to throttle.

### 7d. Pre-decoded Animation Frames

chart-preview's `AnimatedTexture` pre-decodes all WebP frames during initialization, making per-frame texture updates synchronous (no async decoding in the render loop).

### 7e. Shared SpriteMaterial Instances

chart-preview pre-creates `SpriteMaterial` instances in `NotesManager` and reuses them across all notes of the same type/flags. highway.ts creates materials during texture loading and reuses them too, so this is roughly equivalent.

### 7f. WebGL Context Cleanup

chart-preview calls `renderer.forceContextLoss()` and `renderer.renderLists.dispose()` on dispose. highway.ts only calls `renderer.setAnimationLoop(null)`.

**Category:** Bug fix. Without proper cleanup, WebGL contexts can leak (browsers have a limit of ~16 active contexts).

---

## 8. Bug Fixes in chart-preview

### 8a. Duplicate Green Drum Cymbal Condition

As noted in 3b, highway.ts has dead code from a duplicated condition.

### 8b. Red Cymbal Exclusion

As noted in 3c, highway.ts incorrectly allows red cymbals.

### 8c. Missing WebGL Context Cleanup

As noted in 7f.

### 8d. No Fallback for Missing Textures

highway.ts throws on missing textures; chart-preview uses placeholders.

### 8e. No Color Space Management

highway.ts doesn't set texture colorSpace, potentially causing color rendering issues.

### 8f. Audio Latency Compensation

chart-preview's AudioManager subtracts `audioCtx.baseLatency + outputLatency` from the current time calculation. highway.ts does not compensate for audio latency.

**Category:** Important fix for audio-visual sync accuracy.

### 8g. No Star Power Visual Distinction (in note textures)

highway.ts passes `inStarPower` to `getTextureForNote()` but never actually uses it -- all drum textures ignore the star power parameter. chart-preview has separate SP textures (`drums-kick-sp`, `drums-red-tom-sp`, etc.) and applies them via the `SP_FLAG`.

### 8h. Resize Listener Leak

highway.ts adds a resize listener but `destroy()` properly removes it. chart-preview also properly removes its listeners. Both are correct here, though chart-preview's class-based cleanup is more organized.

---

## 9. API Differences

### highway.ts Public API

```typescript
setupRenderer(metadata, chart, sizingRef, ref, audioManager) => {
  prepTrack(track): Promise<{scene, highwayTexture, highwayGroups}>,
  startRender(): Promise<void>,
  destroy(): void,
  getCamera(): THREE.PerspectiveCamera,
  getHighwaySpeed(): number,
}
```

- React-specific (RefObject parameters)
- External AudioManager dependency
- Two-phase init: prepTrack() then startRender()
- No seek, play, pause, volume control
- Exposes camera and speed for overlay coordinate mapping

### chart-preview Public API

```typescript
ChartPreview.loadTextures(instrumentType, options): Promise<Textures>
ChartPreview.create(config): Promise<ChartPreview>

instance.togglePaused(): Promise<void>
instance.seek(percent): Promise<void>
instance.resize(): void
instance.dispose(): void
instance.volume: number | null  (get/set)
instance.isPaused: boolean
instance.chartCurrentTimeMs: number
instance.chartEndTimeMs: number
instance.on('progress' | 'end', listener): void
instance.off('progress' | 'end', listener): void
instance.instrumentType: InstrumentType
```

- Framework-agnostic
- Self-contained audio management
- Full playback control (play, pause, seek, volume)
- Event-driven progress reporting
- Manual resize support
- Proper resource cleanup

**Category:** chart-preview has a much richer API. However, for our use case (drum transcription editor), we need external AudioManager control -- chart-preview's self-contained audio would conflict with our AudioManager that handles multiple stems, speed control, etc.

---

## 10. Feature Additions in chart-preview

| Feature                    | highway.ts                       | chart-preview                      |
| -------------------------- | -------------------------------- | ---------------------------------- |
| 5-fret guitar              | Yes (strum/hopo/tap)             | Yes (strum/hopo/tap + SP variants) |
| 6-fret (GHL) guitar        | No                               | Yes                                |
| Drums                      | Yes                              | Yes (with ghost/accent/SP)         |
| Star power visuals         | No (parameter exists but unused) | Yes (separate SP textures)         |
| Disco flip                 | No                               | Yes                                |
| Ghost/accent notes         | No                               | Yes                                |
| Double kick                | No distinction                   | Has texture                        |
| Open note sustains         | Basic                            | Full-width purple sustains         |
| Animated textures          | No                               | Yes (animated WebP)                |
| Web Component player       | No                               | Yes (full media player UI)         |
| Shared AudioContext        | No                               | Yes (multi-instance support)       |
| SNG file loading           | No                               | Yes                                |
| Keyboard shortcuts         | No                               | Yes (Space, arrows, M, F, Esc)     |
| Fullscreen support         | No                               | Yes                                |
| Seek support               | No                               | Yes                                |
| Volume control             | No                               | Yes                                |
| Solo/flex lane tracking    | No                               | Tracked (not yet rendered)         |
| Audio latency compensation | No                               | Yes                                |

---

## 11. Recommendation

### Should we switch to chart-preview or update highway.ts?

**For the drum transcription editor, we should NOT directly switch to chart-preview as-is.** Here's why:

1. **AudioManager conflict:** chart-preview has its own internal AudioManager that takes `Uint8Array[]` audio files and manages playback internally. Our drum transcription editor needs the external AudioManager that supports multiple stems with independent volume control, speed adjustment, and WaveSurfer coordination. chart-preview's API doesn't expose stem-level audio control.

2. **Editing requirements:** chart-preview is designed as a read-only preview player. Our editor needs to add/remove/move notes dynamically on the highway, which requires direct access to the scene graph and note objects. chart-preview's `NotesManager` is private and doesn't support mutation.

3. **Web Component coupling:** The `ChartPreviewPlayer` Web Component bundles UI controls we don't want (we have our own transport controls).

### What we SHOULD backport from chart-preview:

**High priority (performance/correctness):**

1. **Windowed note rendering** -- Replace pre-generated notes with dynamic creation/removal based on visible time window. This is the #1 performance improvement.
2. **WebGL context cleanup** -- Add `forceContextLoss()` and `renderLists.dispose()` to `destroy()`.
3. **Fix duplicate green drum cymbal condition** -- Remove the dead code branch.
4. **Remove red cymbal support** -- Red should always be tom in pro drums.
5. **Audio latency compensation** -- Subtract `baseLatency + outputLatency` from time calculations.
6. **Star power visual distinction** -- Load and use SP-variant textures.
7. **Texture colorSpace** -- Set `SRGBColorSpace` on loaded textures.

**Medium priority (visual improvements):** 8. **Ghost/accent drum textures** -- Add texture variants for dynamics. 9. **Disco flip handling** -- Process disco/discoNoflip flags. 10. **Open note sustain width** -- Use `SCALE * 5` for open note sustains. 11. **Sustain width increase** -- Use `SCALE * 0.3` instead of `SCALE * 0.175`. 12. **Placeholder textures** -- Add fallback for failed texture loads. 13. **Kick drum center offset** -- Use `0.62` X center for kick sprites. 14. **NOTE_SPAN_WIDTH adjustment** -- Consider changing from 0.99 to 0.95.

**Low priority / Not needed:** 15. Animated textures (nice-to-have, Chrome-only) 16. Web Component player (we have our own UI) 17. SNG loading (handled elsewhere) 18. Shared AudioContext (only relevant for multi-instance) 19. 6-fret guitar support (not needed for drum transcription)

### Alternative approach:

If we later want to use chart-preview for the read-only preview on the sheet-music page (where we don't need editing), we could use it there while keeping a modified highway.ts for the drum transcription editor. The sheet-music page's `CloneHeroRenderer.tsx` could be updated to use `chart-preview` with minimal changes since that page doesn't need editing capabilities.

---

## 12. Files Referenced

| File                       | Path                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| highway.ts                 | `/Users/eliwhite/projects/spotify-clonehero/spotify-clonehero-next/lib/preview/highway.ts`                       |
| CloneHeroRenderer.tsx      | `/Users/eliwhite/projects/spotify-clonehero/spotify-clonehero-next/app/sheet-music/[slug]/CloneHeroRenderer.tsx` |
| ChartPreview.ts            | `/Users/eliwhite/projects/chart-preview/src/ChartPreview.ts`                                                     |
| ChartPreviewPlayer.ts      | `/Users/eliwhite/projects/chart-preview/src/ChartPreviewPlayer.ts`                                               |
| SharedAudioContext.ts      | `/Users/eliwhite/projects/chart-preview/src/SharedAudioContext.ts`                                               |
| SngLoader.ts               | `/Users/eliwhite/projects/chart-preview/src/SngLoader.ts`                                                        |
| chart-preview package.json | `/Users/eliwhite/projects/chart-preview/package.json`                                                            |
