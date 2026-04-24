# Plan 0025: Highway Implementation Review — Bugs, Performance, and Moonscraper Parity Gaps

> **Dependencies:** 0019-0024 (highway refactor)
> **Unlocks:** Independent
>
> **Goal:** Fix all bugs and performance issues from the highway refactor, and close feature gaps vs Moonscraper's drum editing experience. Based on code review of commits cb09098, 1115599, 7801f19 and comparison against `/Users/eliwhite/projects/Moonscraper-Chart-Editor`.

---

## Category 1: Per-Frame Allocation (Performance — Critical)

These issues allocate GPU or JS objects inside code paths that execute every animation frame or on every mouse move. They cause garbage collection pressure, GPU resource churn, and dropped frames.

### 1.1 `screenToWorldPoint` creates new Raycaster + Vector2 each call

**File:** `InteractionManager.ts:384-388`

The class already has `this.raycaster` and `this.ndcVec` as reusable fields, but `screenToWorldPoint()` ignores them and creates `new THREE.Raycaster()` and `new THREE.Vector2()` on every call. This method is called by `screenToLane`, `screenToMs`, and `screenToTick`, which fire on every mouse move pixel.

**Fix:** Reuse `this.raycaster` and `this.ndcVec`. Add a reusable `private screenToWorldResult = new THREE.Vector3()` field for the intersection point.

### 1.2 `hitTestSections` creates `new THREE.Vector3()` each call

**File:** `InteractionManager.ts:173`

`const tempWorld = new THREE.Vector3()` is allocated inside the method which runs on every `hitTest()` call.

**Fix:** Add `private tempWorldVec = new THREE.Vector3()` to the class and reuse it.

### 1.3 `updateEraserHighlight` disposes and recreates geometry every frame

**File:** `SceneOverlays.ts:703-704`

```ts
this.eraserHighlight.geometry.dispose();
this.eraserHighlight.geometry = new THREE.PlaneGeometry(width, 3.5);
```

This runs in `update()` which is called every animation frame. It allocates a new GPU-side `PlaneGeometry` and destroys the old one 60+ times per second while the eraser tool is active.

**Fix:** Track `lastEraserWidth` and only recreate geometry when `width` actually changes. Alternatively, create the geometry at max width and use `scale.x` to resize.

### 1.4 `updateLoopRegion` disposes and recreates tint geometry every frame

**File:** `SceneOverlays.ts:850-851`

Same issue as 1.3 — the loop tint `PlaneGeometry` is disposed and recreated every frame.

**Fix:** Create the geometry once at a unit size and use `mesh.scale.y = regionHeight` to resize. Only update when `regionHeight` changes significantly (epsilon threshold).

### 1.5 `getActiveSprites` allocates a new array on every call

**File:** `NotesManager.ts:189-197`

Called on every mouse move via `InteractionManager.hitTestNotes()`. For a highway with 100+ visible notes, this builds a fresh `THREE.Sprite[]` array each time.

**Fix:** Cache the array and invalidate it in `updateDisplayedNotes()` when the active set changes. Return the cached array from `getActiveSprites()`.

### 1.6 `ensureSustain` disposes and recreates geometry on pool reuse

**File:** `NotesManager.ts:950-951`

When a pooled note group is reused for a sustain with a different length, the geometry is disposed and a new `PlaneGeometry` is created. For guitar tracks with many sustains entering/leaving the window, this happens frequently.

**Fix:** Create sustain geometry at unit height and use `mesh.scale.y = sustainWorldHeight` to resize. This avoids GPU geometry allocation on every pool reuse.

### 1.7 Cursor/crosshair label CanvasTexture recreated on every tick change

**Files:** `SceneOverlays.ts:441-443` (cursor), `SceneOverlays.ts:774-776` (crosshair)

When `cursorTick` changes (e.g., wheel scroll), a new `HTMLCanvasElement` is created, rendered to, and uploaded as a `THREE.CanvasTexture`. Same for the crosshair label on hover. Each wheel scroll step creates a canvas + WebGL texture.

**Fix:** Reuse a single canvas for each label. On tick change, just clear and redraw the existing canvas, then set `texture.needsUpdate = true`. No need to create a new canvas or CanvasTexture object.

---

## Category 2: Module-Level Singletons (Memory Leak)

### 2.1 Shared materials never reset across renderer lifecycles

**File:** `NotesManager.ts:48-50`

```ts
let selectionMaterial: THREE.MeshBasicMaterial | null = null;
let hoverMaterial: THREE.MeshBasicMaterial | null = null;
let reviewMaterial: THREE.MeshBasicMaterial | null = null;
```

These module-level singletons are created once with a specific `clippingPlanes` array reference. When the renderer is destroyed and recreated (e.g., loading a different chart, or React HMR), the old materials survive with stale clipping plane references. The new renderer's clipping planes are different objects, so highlights would clip incorrectly.

**Fix:** Move these into instance fields of `NotesManager`. Create them in the constructor (or lazily on first use) using `this.clippingPlanes`. Dispose them in a `dispose()` method.

### 2.2 `sectionTextureCache` is a module-level global

**File:** `SceneOverlays.ts:45`

The cache is shared across all SceneOverlays instances. It's only cleared in `dispose()`, but if two editors exist simultaneously (unlikely but possible), they'd share textures. More practically, after HMR the cache persists with stale textures.

**Fix:** Move the cache to an instance field of `SceneOverlays`. Clear it in `dispose()`.

---

## Category 3: Missing Functionality (vs Plans)

### 3.1 Ghost notes render as flat rectangles, not note textures

**Files:** `SceneOverlays.ts:611-625`

Plan 0020 specifies: "Semi-transparent note sprites at the ghost position. Reuse the same texture as the real note but with reduced opacity." The current implementation uses `PlaneGeometry` with `MeshBasicMaterial` colored rectangles. These look nothing like actual drum notes.

**Moonscraper ref:** In Moonscraper, the ghost note preview is a full note visual (same mesh/sprite as a real note) positioned at the snapped grid position (`PlaceNote.cs`). It updates lane and type based on the mouse X position via `XPosToNoteNumber()`.

**Fix:** SceneOverlays needs access to the TextureManager or NotesManager's `getTextureForNote` function. Ghost notes should use the same `SpriteMaterial` as real notes, cloned with reduced opacity (~0.4). The hover ghost should be slightly brighter (~0.6).

### 3.2 Grid subdivision lines missing — only two tiers instead of three

**Files:** `GridOverlay.ts`

Plan 0023 specifies: "Thin white for subdivision beats, medium white for beats, thick/bright for measure boundaries." The implementation only has two tiers: beat lines and measure lines.

**Moonscraper ref:** Moonscraper's `DrawBeatLines.cs` renders **three tiers**: `measureLinePool` (bold measure boundaries), `beatLinePool` (beats within a measure), and `quarterBeatLinePool` (faded subdivisions between beats). Each tier uses a separate pool of objects. The beat info is computed from `TimeSignature.MeasureInfo`, which provides `measureLine`, `beatLine`, and `quarterBeatLine` with their respective tick gaps, repetition counts, and cycle offsets.

**Fix:** Add a third tier (quarter-beat / subdivision lines) to `GridOverlay`. Compute the three tiers from the time signature: measure lines at `resolution * 4 / denominator * numerator`, beat lines at `measureGap / numerator`, quarter-beat lines at `beatGap / 2`. Use a third shared material/geometry pair with lower opacity (~0.12) and thinner width (~0.002).

### 3.3 Star power state lost on incremental edits

**File:** `useEditCommands.ts:126-133`

`prepareNotesFromDoc()` hardcodes `inStarPower: false` for all notes. The full `NotesManager.prepare()` path properly checks star power sections via binary search. After any incremental edit, all notes lose their SP texture until the next full rebuild.

**Fix:** `prepareNotesFromDoc()` must also extract star power sections from the `ChartDocument` and compute `inStarPower` for each note, matching the binary search logic in `NotesManager.prepare()`.

### 3.4 `prepareSingleNote()` never implemented

**File:** `NotesManager.ts`

Plan 0022 says: "Add `prepareSingleNote()` to NotesManager for creating PreparedNote from a DrumNote without full track prep." This would avoid the expensive `prepareNotesFromDoc` (which rebuilds the entire array) for single-note adds. Not implemented.

**Fix:** Add `prepareSingleNote(note, msTime, inStarPower)` that creates a single `PreparedNote` from the note data. `useEditCommands` can use this for `AddNoteCommand` instead of rebuilding the full array.

### 3.5 Waveform data flow race condition

**Files:** `HighwayEditor.tsx:196-233`, `index.ts:276-283`

When `setHighwayMode('waveform')` runs before `setWaveformData()` completes (both triggered by state changes), `waveformSurface` is still null so `setVisible(true)` is a no-op. Similarly, if `setWaveformData` completes after the mode is already 'waveform', the surface is created with `visible = false` (constructor default) and the mode check in `setWaveformData` correctly sets it visible — but only if `highwayMode` was already 'waveform' at that point. This ordering dependency is fragile.

**Fix:** In `setWaveformData()` and `setGridData()`, after creation, always apply the current `highwayMode` visibility. Currently this is done but only for the waveform case. Verify the grid overlay visibility is also applied. Additionally, in `setHighwayMode()`, if `waveformSurface` is null and mode is 'waveform', queue the mode so it's applied when the surface is eventually created.

---

## Category 4: Correctness Bugs

### 4.1 Kick hit-testing only activates for lane 0

**File:** `InteractionManager.ts:231`

```ts
if (lane === 0) {
  const kickHit = this.hitTestKickAtTick(tick, ms);
  if (kickHit) return kickHit;
}
```

Kick notes span the full highway width, so clicks at any X position at the kick's tick should find it. But `hitTestKickAtTick` only runs when `worldXToLane` returns 0 (center). If the user clicks near the red or green lane at a tick where a kick exists (and no pad note is there), the kick won't be found — it returns `{type: 'highway'}` instead.

**Moonscraper ref:** In Moonscraper, open/kick notes have a wide collider (`OPEN_NOTE_COLLIDER_WIDTH = 5.0` in `NoteController.cs`) that spans the full highway. Hit testing uses Unity's collider system, so clicks anywhere on the kick bar register as a hit.

**Fix:** Always call `hitTestKickAtTick` in `hitTestHighway`, not just when `lane === 0`. Filter out kicks that overlap with pad notes at the same tick (if a pad sprite was present, it would have been caught by `hitTestNotes` first).

### 4.2 `DrumHighwayPreview` memo'd but `chart` in useEffect deps causes remount

**File:** `DrumHighwayPreview.tsx:118`

The `useEffect` depends on `[metadata, chart, drumTrack, audioManager, onRendererReady]`. When a full-rebuild edit changes `chart`, the memo comparison passes (chart prop changed), the effect fires, and `rendererRef.current?.destroy()` + `setupRenderer()` runs. This is the intended behavior for full rebuilds.

However: `drumTrack` is derived from `chart` via `useMemo`. If `chart` changes but the drum track data is identical (e.g., editing a guitar track), `drumTrack` still gets a new object reference because `chart` changed, triggering an unnecessary renderer rebuild.

**Fix:** Memoize `drumTrack` by its content (e.g., serialize the track's noteEventGroups to a stable key) rather than by `chart` reference. Or use a more targeted comparison.

### 4.3 Box select rectangle shows during section drag

**File:** `HighwayEditor.tsx:938-942`

The condition checks `!isDragging` but doesn't check `!isDraggingSection`. When dragging a section, the blue selection box appears alongside the section drag ghost.

**Fix:** Add `&& !isDraggingSection` to the condition.

### 4.4 `Promise`-based API adds microtask overhead on every overlay push

**File:** `HighwayEditor.tsx:802-815`

`handle.getNotesManager().then(...)` and `handle.getInteractionManager().then(...)` run in a `useEffect` that fires on every hover lane/tick change (every mouse move pixel). Each call creates two Promise microtasks.

**Fix:** Expose synchronous accessors after initialization. Cache resolved values in the `methods` object after `prepTrack` resolves.

### 4.5 `prepareNotesFromDoc` builds `Note` with `as Note` type assertion

**File:** `useEditCommands.ts:114-119`

The synthetic `scanNote` object is cast `as Note`, but it may lack properties that `Note` actually has. If any consumer accesses missing properties, it would read `undefined`.

**Fix:** Verify that all consumers of `Note` only use the properties that `prepareNotesFromDoc` sets. If `Note` has more properties, add them to the synthetic object.

### 4.6 Overlay state effect fires on every mouse move pixel

**File:** `HighwayEditor.tsx:778-834`

The `useEffect` has `hoverLane` and `hoverTick` in its dependency array, so it fires 60+ times/sec during mouse movement, calling `handle.getNotesManager().then(...)` each time.

**Fix:** Split into two effects:

1. One that pushes `overlayState` (can run frequently, is synchronous).
2. One that pushes selection/confidence/review to NotesManager (runs only when those change, not on hover).

---

## Category 5: Missing Test Coverage

### 5.1 `NotesManager.applyDiff` has no tests

`computeDiff` has 12 comprehensive tests. But `applyDiff` — which actually mutates the scene graph with complex double-index-remapping logic — has zero tests.

### 5.2 No coordinate conversion tests

`InteractionManager.worldYToMs`, `msToWorldY`, `worldXToLane`, `tickToMs`, `msToTickRaw`, `msToTickSnapped` are untested pure math.

### 5.3 No overlay positioning tests

`SceneOverlays` positions cursor lines, section banners, ghost notes via tick-to-ms-to-worldY conversion. None tested.

### 5.4 `isIncrementalCommand` duplicated in test

**File:** `incremental-edit.test.ts:27-44` — copies the function rather than importing it. If the real function changes, the test won't catch the regression.

**Fix:** Export `isIncrementalCommand` from `useEditCommands.ts` and import it in the test.

---

## Category 6: Code Quality

### 6.1 `console.log('track', track)` left in production code

**File:** `index.ts:124` — Remove it.

### 6.2 `interpolate` function unused

**File:** `index.ts:39-48` — Dead code. Remove it.

### 6.3 `Song` type is an empty object

**File:** `types.ts:15` — `export type Song = {};` unused. Remove it.

### 6.4 Ghost note meshes grow unbounded

**File:** `SceneOverlays.ts:610-625` — Pre-create all 5 ghost note meshes in the constructor.

### 6.5 `InteractionManager.dispose()` is a no-op that prevents GC

**File:** `InteractionManager.ts:462-464` — Null out references in `dispose()`.

### 6.6 `handleMouseMove` missing `notesManagerRef` in dependency array

**File:** `HighwayEditor.tsx:520-531` — Stable ref, technically fine, but should be listed for clarity.

### 6.7 `handleRendererReady` calls async `.then()` without cleanup guard

**File:** `HighwayEditor.tsx:112-113` — If unmounted before promise resolves, writes to ref on unmounted component.

---

## Category 7: Moonscraper Parity — Beat Lines & Grid

### 7.1 Quarter-beat (subdivision) lines missing

**Moonscraper ref:** `DrawBeatLines.cs` renders three separate pools — `measureLinePool`, `beatLinePool`, `quarterBeatLinePool`. Quarter-beat lines are rendered at half the beat interval and use a faded appearance. This provides visual context for 8th-note placement.

**Our state:** `GridOverlay.ts` only renders two tiers (beats and measures). No subdivision/quarter-beat lines exist.

**Fix:** Add a third tier to `GridOverlay`. Pre-compute quarter-beat entries (at `beatTickGap / 2`) alongside beats and measures. Use a third pool with even lower opacity and thinner lines.

### 7.2 Grid lines don't reflect current step/snap setting

**Moonscraper ref:** In Moonscraper, the three visual line tiers are derived from the **time signature** (measure, beat, quarter-beat). The **step** setting only affects snap resolution for placement and navigation — it does NOT change which lines are visible. This is a deliberate design: visual grid is stable regardless of snap.

**Our state:** Our `GridOverlay` always shows beats + measures. We should consider whether to show the current grid step as additional faint lines (to help the user see where notes will snap), or match Moonscraper's approach.

**Fix:** Match Moonscraper's approach: visual grid shows time-signature-derived lines (three tiers) and is independent of the snap step. If users request visual snap lines, add an optional fourth tier with very faint lines at the current grid step — but this is lower priority.

---

## Category 8: Moonscraper Parity — Tool System & Interaction

### 8.1 Keyboard placement mode missing

**Moonscraper ref:** `PlaceNoteController.cs` supports **two placement modes** toggled via `ToggleMouseMode`:

- **Mouse burst mode**: Click to place notes at mouse position (what we have).
- **Keyboard burst mode**: Press lane keys (1-5) to place notes at the **cursor position**. No mouse needed. This is the primary editing workflow for experienced users.
- **Keyboard sustain mode**: Hold a lane key to create a sustain note that extends as long as the key is held.

**Our state:** Only mouse placement exists. No keyboard lane shortcuts for placement.

**Fix:** Add keyboard placement mode. When active:

- Keys 1-5 place notes at the current `cursorTick` in the corresponding lane (1=kick, 2=red, 3=yellow, 4=blue, 5=green).
- After placing, auto-advance cursor to the next grid step (so the user can type a rhythm).
- Toggle between mouse and keyboard mode via a shortcut.

This is a high-impact feature for editing speed. This is covered by plan 0016 (grid navigation + keys mode) but the scope should be confirmed against Moonscraper's behavior.

### 8.2 Eraser drag doesn't batch into a single undo entry

**Moonscraper ref:** `Eraser.cs` maintains a `dragEraseHistory` list. All notes deleted during a single mouse-drag are collected and committed as a single batch command on mouse-up. One Ctrl+Z undoes the entire drag.

**Our state:** `handleMouseMove` in HighwayEditor.tsx calls `executeCommand(new DeleteNotesCommand(...))` for each note hit during drag. Each delete is a separate undo entry, requiring many Ctrl+Z presses to undo a drag-erase.

**Fix:** Accumulate deleted note IDs during an eraser drag (in a ref). On mouse-up, if multiple notes were deleted, combine them into a single `BatchCommand` and push that to the undo stack. If only one note was deleted, use the existing single-command path.

### 8.3 Place-mode toggle oscillation prevention missing

**Moonscraper ref:** `PlaceNoteController.cs` uses an `inputBlock` array to prevent add/remove oscillation when the mouse is held down and moves over a position where a note already exists. Without this, holding click while moving would rapidly toggle note on/off.

**Our state:** In place mode, `handleMouseDown` places or deletes a note. But there's no paint-while-dragging for place mode. If we add paint-place (holding click to draw a stream of notes), we'll need this guard.

**Fix:** If/when adding paint-place mode, implement an input block that remembers which tick positions were already handled during the current drag.

### 8.4 Chord select modifier missing

**Moonscraper ref:** Moonscraper has a `ChordSelect` input modifier. When active:

- Clicking a note selects ALL notes at that tick (the chord).
- Erasing a note erases the entire chord.
- Useful for drum charts where multiple pads hit at the same time.

**Our state:** No chord-select concept. Selecting a note only selects that single note. To select a chord, the user must shift-click each note individually or box-select.

**Fix:** Add a modifier key (e.g., Alt) that, when held during click in cursor mode, selects all notes at the clicked note's tick. In erase mode, the modifier deletes all notes at the tick.

### 8.5 Right-click delete shortcut missing

**Moonscraper ref:** `NoteController.cs` implements Ctrl+Right-click to delete a note while the cursor tool is active. This lets users delete without switching to the eraser.

**Our state:** No right-click delete. Users must switch to the eraser tool.

**Fix:** Add context menu prevention on right-click, and implement Ctrl+Right-click to delete the note under the cursor.

---

## Category 9: Moonscraper Parity — Navigation

### 9.1 Move by measure missing

**Moonscraper ref:** `TimelineMovementController.cs` implements `MoveMeasurePositive` / `MoveMeasureNegative`. These jump the cursor by a full measure: `currentPos + (resolution * 4)` ticks, then snap to grid. Default binding: Ctrl+Up / Ctrl+Down.

**Our state:** Only single grid-step movement exists (arrow keys and wheel). No measure-level jumping.

**Fix:** Add measure movement. Compute measure length from the current time signature (e.g., 4/4 = `resolution * 4`). Bind to Ctrl+Up / Ctrl+Down or equivalent. Use `snapToGrid` after computing the new position.

### 9.2 Section jump via modifier+scroll missing

**Moonscraper ref:** When the `SectionJumpMouseScroll` modifier is held, mouse scroll jumps between song sections instead of scrolling by grid step. `SectionJump()` finds the next/previous section relative to the current position.

**Our state:** Mouse wheel always scrolls by grid step. No section-jump mode.

**Fix:** Add a modifier key (e.g., Alt or Shift) that changes wheel behavior to section jumping. Find the nearest section in the scroll direction and seek to it.

### 9.3 Section jump keyboard shortcuts missing

**Moonscraper ref:** `SectionJumpPositive` / `SectionJumpNegative` keyboard shortcuts for jumping between sections without using scroll.

**Our state:** No section-jump shortcuts.

**Fix:** Add shortcuts (e.g., Ctrl+Shift+Up / Ctrl+Shift+Down) to jump to the next/previous section.

### 9.4 Step increment/decrement keyboard shortcuts missing

**Moonscraper ref:** `StepIncrease` / `StepDecrease` change the grid snap resolution (e.g., 1/4 → 1/8 → 1/12 → 1/16 etc.). `StepIncreaseBy1` / `StepDecreaseBy1` fine-adjust by 1 unit. Available step values: 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 768.

**Our state:** Grid division is changeable via a dropdown in the sidebar. No keyboard shortcuts.

**Fix:** Add shortcuts to cycle through grid divisions. Map to the standard series (1/4, 1/8, 1/12, 1/16, 1/24, 1/32, 1/48, 1/64). These are extremely important for fast editing.

---

## Category 10: Moonscraper Parity — Highway Speed & Scroll

### 10.1 No adjustable highway speed (hyperspeed)

**Moonscraper ref:** `GameSettings.cs` defines `hyperspeed` (default 5.0) which controls how fast notes scroll on the highway. The formula is `TimeToWorldYPosition = time * (hyperspeed / gameSpeed)`. Users can adjust this independently of playback speed to zoom in/out on the time axis.

**Our state:** Highway speed is hardcoded to `1.5` in `index.ts:63`. The user cannot zoom in/out on the time axis.

**Fix:** Make `highwaySpeed` a configurable value in the editor state. Add a slider or keyboard shortcut to adjust it. Update all modules that use `highwaySpeed` (NotesManager, SceneOverlays, InteractionManager, GridOverlay, WaveformSurface) to read the dynamic value. This effectively gives the user a "vertical zoom" control. When speed increases, more time is visible on screen but notes are more spread out.

### 10.2 Scroll sensitivity not configurable

**Moonscraper ref:** `TimelineMovementController.cs` has `c_mouseScrollSensitivity` and `c_guiEventScrollSensitivity` as configurable sensitivity values, with separate handling for trackpad vs mouse wheel.

**Our state:** Each wheel tick moves by exactly one grid step. No sensitivity adjustment.

**Fix:** Lower priority. The grid-step-per-tick approach is actually more precise than a sensitivity multiplier. Consider adding an option for "scroll by N grid steps per wheel tick" if users find single-step scrolling too slow.

---

## Category 11: Moonscraper Parity — Drum-Specific Features

### 11.1 BPM and time signature markers not rendered on the highway

**Moonscraper ref:** Moonscraper renders BPM change markers and time signature change markers as visible objects on the highway itself (via `BPMPool` and `TimesignaturePool`). These are positioned at the correct world Y and display the BPM or TS values.

**Our state:** BPM and time signature changes are only visible in the sidebar inspector. There's no visual indication on the highway where tempos or time signatures change.

**Fix:** Add BPM and TS marker rendering to SceneOverlays. For each BPM/TS event in the visible window, render a small label sprite (similar to section banners but with different color/style) at the correct world Y. Use object pooling. BPM markers could be orange, TS markers could be purple (matching our existing crosshair color scheme for those tools).

### 11.2 Drum roll tool missing

**Moonscraper ref:** Moonscraper has a dedicated `DrumRoll` chart event type with `Standard` and `Special` variants. There's a `ToolSelectDrumRoll` tool for placing drum rolls, and `DrumRollSetSingle` / `DrumRollSetDouble` shortcuts. Drum rolls have a `tick` + `length` and are rendered as lane-spanning visual indicators.

**Our state:** No drum roll support at all.

**Fix:** Drum rolls are not critical for the ML-transcription workflow but are important for manual chart editing. Add `DrumRoll` as a chart event type, a drum roll tool to the toolbar, and a visual renderer for drum roll regions on the highway. Lower priority — can be a separate plan.

### 11.3 Per-pad tom/cymbal keyboard placement missing

**Moonscraper ref:** `DrumsInput.cs` defines separate inputs per pad for tom vs cymbal placement: `DrumPadProRedTom`, `DrumPadProRedCymbal`, `DrumPadProYellowTom`, `DrumPadProYellowCymbal`, etc. In keyboard mode, pressing the cymbal variant places a cymbal directly.

**Our state:** Cymbal flag is toggled after placement (press Q on a selected note). No way to place cymbals directly from keyboard.

**Fix:** When implementing keyboard placement mode (8.1), include separate keybindings for tom vs cymbal variants of each pad. E.g., pressing `Y` places a yellow tom, pressing `Shift+Y` places a yellow cymbal.

### 11.4 Dynamics SET commands (not just toggles) missing

**Moonscraper ref:** Moonscraper has both SET and TOGGLE variants:

- `NoteSetAccent` / `NoteSetGhost` / `NoteSetDynamicsNone` — SET the dynamic level to a specific value.
- `ToggleNoteAccent` / `ToggleNoteGhost` — TOGGLE the flag.

SET is used in keyboard mode to definitively apply a dynamic level. TOGGLE is used in cursor mode to flip it.

**Our state:** Only toggle variants exist.

**Fix:** Add SET commands for dynamics. In keyboard placement mode, the dynamic level should be sticky — once you set "accent," all subsequent placements are accented until you change it.

### 11.5 Double kick toggle missing

**Moonscraper ref:** `ToggleNoteDoubleKick` / `NoteSetDoubleKick` / `NoteSetAltDoubleKick` — toggles or sets the double kick flag on kick notes.

**Our state:** `ToggleFlagCommand` exists but may not be wired to a keyboard shortcut for double kick specifically.

**Fix:** Verify `ToggleFlagCommand` supports `doubleKick` flag, and add a keyboard shortcut for it.

### 11.6 Select all in section missing

**Moonscraper ref:** `SelectAllSection` selects all notes within the boundaries of the current section (between the current section marker and the next one).

**Our state:** No section-based selection.

**Fix:** Add a "Select All in Section" command. Find the section boundaries around the current cursor position. Select all notes with ticks in that range. Bind to Ctrl+Shift+A or similar.

### 11.7 Cut command missing

**Moonscraper ref:** `ClipboardCut` = copy + delete selected notes.

**Our state:** Copy and paste exist but there is no cut shortcut.

**Fix:** Add cut as copy + delete in a single undo entry.

### 11.8 Metronome / click track toggle missing

**Moonscraper ref:** `ToggleMetronome` and `ToggleClap` provide audio feedback on beat positions and note hits during playback. Essential for verifying chart timing.

**Our state:** No metronome or clap feedback.

**Fix:** Add a metronome using the Web Audio API. On each beat during playback, play a short click sound. Use the pre-computed beat positions from `GridOverlay`'s beat list. Toggle via a toolbar button and keyboard shortcut.

---

## Category 12: Moonscraper Parity — Visual Polish

### 12.1 Ghost note shows full note visual, not colored rectangle

Covered in 3.1 above. Moonscraper shows the actual note mesh/sprite as the ghost preview. Our implementation shows colored rectangles.

### 12.2 Selection highlight should match note collider bounds

**Moonscraper ref:** `SelectedHighlightDisplaySystem.cs` uses the note's actual collider bounds to size the highlight. Different note types (kick, pad, cymbal) have different collider sizes, so the highlight matches the note's visual footprint.

**Our state:** Selection highlights use fixed sizes (`SCALE * 2.2` width for pads, `0.9` for kicks). These might not match the actual sprite sizes perfectly.

**Fix:** Lower priority. The current approach is acceptable but could be improved by deriving highlight size from the actual sprite scale rather than hardcoded constants.

### 12.3 Hover highlight should be visually distinct from selection

**Moonscraper ref:** Uses a separate pool and rendering system for hover vs selection highlights, ensuring they never look the same.

**Our state:** Hover and selection use the same highlight geometry at the same position, differentiated only by material (hover=white/0.5 opacity vs selection=white/0.35 opacity). The visual difference is subtle.

**Fix:** Lower priority. Consider adding a border/outline effect to hover (or a slightly different color like cyan) to make it more visually distinct from selection blue.

---

## Execution Order

### Phase 1: Bugs & Performance (ship-blocking)

1. Fix per-frame allocations (1.1-1.7)
2. Fix module-level singletons (2.1-2.2)
3. Fix kick hit-testing (4.1)
4. Fix box select during section drag (4.3)
5. Split overlay effect + sync accessors (4.4, 4.6)
6. Fix star power in incremental edits (3.3)
7. Code cleanup (6.1-6.7)

### Phase 2: Visual Correctness

8. Ghost notes use real textures (3.1)
9. Three-tier beat lines (3.2, 7.1)
10. Fix waveform race condition (3.5)
11. BPM/TS markers on highway (11.1)

### Phase 3: Moonscraper Parity — Editing Core

12. Eraser drag batching (8.2)
13. Keyboard placement mode (8.1) — cross-ref plan 0016
14. Step increment/decrement shortcuts (9.4)
15. Move by measure (9.1)
16. Section jump shortcuts + scroll modifier (9.2, 9.3)
17. Chord select modifier (8.4)
18. Right-click delete (8.5)
19. Cut command (11.7)
20. Select all in section (11.6)

### Phase 4: Moonscraper Parity — Advanced

21. Adjustable highway speed (10.1)
22. Per-pad tom/cymbal keyboard placement (11.3)
23. Dynamics set commands (11.4)
24. Double kick shortcut (11.5)
25. Metronome/click track (11.8)
26. Drum roll tool (11.2)

### Phase 5: Tests

27. Tests for applyDiff, coordinate conversion, overlay positioning (5.1-5.4)

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

1. Monitor frame rate during mouse movement — should not drop below 55fps.
2. Destroy and recreate renderer — highlights and clipping still correct.
3. Click kick note from any lane position — selects it.
4. Drag-erase multiple notes — single Ctrl+Z undoes the entire drag.
5. Three-tier beat lines visible: bold measures, medium beats, faint quarter-beats.
6. BPM/TS markers visible on the highway at tempo change positions.
7. Ghost note preview in Place mode shows actual note texture at ghost position.
8. Keyboard placement: press 1-5 to place notes at cursor, cursor auto-advances.
9. Ctrl+Up/Down moves by full measure.
10. Section jump via modifier+scroll jumps between sections.
11. Adjustable highway speed: slider changes note spacing.
12. All existing features still work (timeline, sections, tools, shortcuts).
