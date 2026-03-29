# Plan 0024: Highway Bugs and Polish

> **Dependencies:** 0019-0023 (highway refactor)
> **Unlocks:** Independent
>
> **Goal:** Fix several bugs and UX issues with the refactored highway renderer and editor interactions.

## Issues

### 1. Waveform never renders on highway in waveform mode

The waveform toggle in the sidebar switches to "Waveform" mode but nothing visible changes on the highway surface. Debug the data flow:
- Is `audioData` (Float32Array) reaching `HighwayEditor` → `DrumHighwayPreview` → `setupRenderer`?
- Is `setWaveformData()` being called on the renderer?
- Is the WaveformSurface mesh being created and added to the scene?
- Is the classic highway mesh being hidden when waveform mode is active?
- Is the waveform canvas actually rendering pixels (non-empty)?
- Is the texture offset/repeat scrolling correctly?

Trace the full data path from `ChartEditor` props through to the Three.js scene.

### 2. Beat/measure lines are blurry

The Moonscraper reference screenshot shows crisp, solid white lines for beats and thicker lines for measures. The current GridOverlay renders lines to a CanvasTexture which gets blurry due to texture filtering and perspective projection.

**Fix approach:** Instead of rendering lines to a texture (which gets filtered/interpolated), render beat lines as individual `THREE.Line` objects in the scene at each beat position. This is what chart-preview does — each beat line is a separate 3D line spanning the highway width at the correct world Y. Lines are:
- Thin white for subdivision beats
- Medium white for beats
- Thick/bright white for measure boundaries

These should be managed in a windowed fashion (only create lines for the visible time window) or pre-create enough and reposition each frame.

### 3. Vertical lane divider drawn for kick

There's a lane divider line rendered for the kick lane (center of highway). Kick notes span the full highway width, so there shouldn't be a lane divider at the kick position. Only the 4 pad lanes (red, yellow, blue, green) should have dividers between them.

Find where lane dividers are created in SceneOverlays.ts and remove the kick lane divider.

### 4. Kick note selection should span full highway width

Kick notes render as a wide sprite centered across all lanes. When selecting a kick note, the selection highlight should match — spanning the full highway width rather than being confined to a single lane column. Update the selection highlight in NotesManager to check if the note is a kick and use full highway width for the highlight mesh.

Similarly, when hit-testing for kick notes in InteractionManager, a click anywhere on the highway at the kick's tick position should select it (not just the center lane).

### 5. Ghost note preview in Place mode doesn't work

When in Place mode, hovering over the highway should show a semi-transparent note preview (ghost note) at the nearest grid-snapped position. Currently nothing appears and clicking doesn't add notes.

Debug:
- Is the Place tool's mouse handler calling the correct SceneOverlays/NotesManager methods?
- Is the ghost note sprite being created and positioned?
- Is the click handler creating an AddNoteCommand and executing it?
- Check HighwayEditor.tsx's handleMouseDown for the 'place' tool case — does it use InteractionManager.hitTest correctly?

The ghost should show a cymbal/tom sprite (with ~50% opacity) at the grid-snapped tick position in the hovered lane.

### 6. Mouse wheel should scroll the highway

In Moonscraper, scrolling the mouse wheel scrubs the playback position forward/backward, effectively scrolling through the chart. Currently the mouse wheel does nothing on the highway.

**Implementation:**
- Add a `wheel` event handler on the highway container div
- Wheel up (deltaY < 0) = move forward in time (same as arrow up / grid step forward)
- Wheel down (deltaY > 0) = move backward in time
- The scroll amount should map to a time delta (e.g., each wheel tick = one grid step, or a fixed ms amount)
- When scrolling, seek the AudioManager to the new position
- Update the cursor tick to match
- Should NOT scroll during playback (only when paused)
- `e.preventDefault()` to avoid page scroll

## Execution Order

1. **Fix waveform rendering** — trace data flow, fix the broken connection.
2. **Fix beat lines** — replace blurry GridOverlay texture with crisp THREE.Line objects.
3. **Remove kick lane divider** — fix SceneOverlays lane divider creation.
4. **Fix kick selection width** — update NotesManager highlight and InteractionManager hit testing.
5. **Fix ghost note preview + note placement** — debug and fix Place mode.
6. **Add mouse wheel scrolling** — wheel event handler on highway container.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` in `/drum-edit`.

1. Toggle waveform mode — waveform visible on highway, scrolls with playback.
2. Beat lines are crisp white lines, measure boundaries are thicker.
3. No vertical line at the kick position (center of highway).
4. Click a kick note — selection highlight spans full highway width.
5. Switch to Place tool, hover over highway — ghost note preview appears at grid-snapped position.
6. Click to add a note — note appears instantly (incremental, no rebuild).
7. Mouse wheel up/down — highway scrubs forward/backward through the chart.
8. Mouse wheel does nothing during playback.
9. All existing features still work (timeline, sections, tools, shortcuts).
