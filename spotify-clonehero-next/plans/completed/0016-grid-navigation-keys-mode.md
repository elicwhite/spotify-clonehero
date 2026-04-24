# Plan 0016: Grid-Based Navigation + Keys Mode

> **Dependencies:** 0013 (shared editor)
> **Unlocks:** Independent (enhances editing workflow)
>
> **Goal:** Replace the current time-based seeking (arrows seek by seconds) with Moonscraper-style grid-based navigation (arrows move by grid step, Ctrl+arrows by measure). Add keyboard-only note placement ("keys mode") where pressing lane keys (1-5) places notes at the current cursor position.

## Context

### Current navigation (time-based):

- Left/Right arrows seek by ±5 seconds
- No concept of a "cursor position" separate from playback position
- Grid snapping only applies when placing notes via mouse click

### Moonscraper navigation (grid-based):

- A **cursor** (strikeline position) moves independently of playback
- Up/Down arrows move the cursor by one grid step (e.g., 1/16th note)
- Ctrl+Up/Down moves by one measure
- The cursor snaps to grid positions defined by the current step setting and time signature
- During playback, the view auto-scrolls and the cursor follows
- When stopped, the cursor is the editing position — keyboard note placement happens at the cursor

### Moonscraper keys mode:

- Press a lane key to instantly place a note at the cursor position in that lane
- Lane keys for drums: 1=Kick, 2=Red, 3=Yellow, 4=Blue, 5=Green
- After placing, the cursor optionally auto-advances by one grid step (configurable)
- This enables extremely fast charting without using the mouse

## 1. Grid Cursor

### Concept:

A **cursor tick** represents the user's current editing position on the highway. It's separate from the playback time.

```typescript
// Add to ChartEditorContext state:
cursorTick: number; // Current cursor position in ticks
cursorVisible: boolean; // Whether to show the cursor line on highway
```

### Behavior:

- **When stopped**: Cursor is a green/white horizontal line on the highway at the cursor tick position. This is the "editing position."
- **When playing**: Cursor follows the playback position (strikeline). Navigation keys are disabled during playback (matches Moonscraper — most editing happens while stopped).
- **On stop**: Cursor stays at the position where playback was stopped.
- **On seek (click waveform, click timeline, etc.)**: Cursor moves to the seeked position.

### Visual:

- Horizontal line across the highway at the cursor tick position
- Rendered in the HighwayEditor overlay canvas (same as selection highlights)
- Different color from beat lines (green or bright white) to be distinguishable
- Grid lines around the cursor could be subtly highlighted

## 2. Grid-Based Navigation

### Arrow key behavior (replaces current time-based seeking):

| Key         | Action                                | Moonscraper equivalent                      |
| ----------- | ------------------------------------- | ------------------------------------------- |
| Up Arrow    | Move cursor forward by one grid step  | `MoveStepPositive`                          |
| Down Arrow  | Move cursor backward by one grid step | `MoveStepNegative`                          |
| Ctrl+Up     | Move cursor forward by one measure    | `MoveMeasurePositive`                       |
| Ctrl+Down   | Move cursor backward by one measure   | `MoveMeasureNegative`                       |
| Left Arrow  | Move cursor forward by one grid step  | Alias for Up (natural for vertical highway) |
| Right Arrow | Move cursor backward by one grid step | Alias for Down                              |

**Note on direction:** The highway scrolls bottom-to-top (future notes are above). "Forward" means later in the song (higher tick), which visually means the highway scrolls down to reveal notes above. We match Moonscraper's convention: Up = forward in song time.

### Step calculation:

```typescript
function getNextGridTick(
  currentTick: number,
  direction: 1 | -1, // 1 = forward, -1 = backward
  gridDivision: number,
  resolution: number,
  timeSignatures: TimeSignatureEvent[],
): number {
  // Grid step in ticks:
  // gridDivision=4 (1/16th) at resolution=480 → stepTicks = 480/4 = 120
  // gridDivision=0 (free) → move by 1 tick

  if (gridDivision === 0) return currentTick + direction;

  const stepTicks = resolution / gridDivision;
  const snappedCurrent = snapToGrid(currentTick, resolution, gridDivision);

  if (direction > 0) {
    // Forward: next grid line after current position
    return snappedCurrent + stepTicks;
  } else {
    // Backward: previous grid line before current position
    // If we're exactly on a grid line, go back one step
    // If between grid lines, snap to the grid line behind us
    if (currentTick === snappedCurrent) {
      return snappedCurrent - stepTicks;
    }
    return snappedCurrent;
  }
}
```

### Measure navigation:

```typescript
function getNextMeasureTick(
  currentTick: number,
  direction: 1 | -1,
  resolution: number,
  timeSignatures: TimeSignatureEvent[],
): number {
  // Find the measure boundary after/before currentTick
  // A measure = numerator * resolution ticks (for 4/4 at 480 res = 1920 ticks)
  // Respect time signature changes
}
```

### Audio sync:

When the cursor moves, also seek the AudioManager so the user hears the audio at the cursor position:

```typescript
const cursorMs = tickToMs(newCursorTick, timedTempos);
audioManager.seek(cursorMs / 1000);
```

## 3. Keys Mode (Keyboard Note Placement)

### Lane key mapping:

| Key | Lane | Drum Type  | Note            |
| --- | ---- | ---------- | --------------- |
| 1   | 0    | kick       | Center/orange   |
| 2   | 1    | redDrum    | Snare           |
| 3   | 2    | yellowDrum | Hi-hat/cymbal   |
| 4   | 3    | blueDrum   | Tom/ride        |
| 5   | 4    | greenDrum  | Crash/floor tom |

### Placement behavior:

1. User presses a lane key (e.g., "3" for yellow)
2. A note is created at `cursorTick` in the corresponding lane
3. The note uses default flags for that type (e.g., yellow defaults to cymbal marker)
4. An `AddNoteCommand` is dispatched (goes through undo/redo)
5. If a note already exists at that tick+lane, the key press **deletes** it (toggle behavior, like Moonscraper)
6. Cursor does NOT auto-advance (user controls position with arrows)

### Chord building:

Since cursor doesn't auto-advance, pressing multiple lane keys at the same cursor position builds a chord. For example:

- Press 1 (kick) → kick note at tick 960
- Press 3 (yellow) → yellow note at tick 960 (chord with kick)
- Press Up → cursor advances to tick 1080
- Press 2 (red) → red note at tick 1080

### Flag application with keys mode:

Flags (Q=cymbal, A=accent, S=ghost) work as modifiers:

- Hold Q + press 3 → place yellow note with cymbal flag
- Or: press 3 to place, then press Q to toggle cymbal on last placed note
- **Recommended approach**: Toggle flags on the note at cursorTick if one exists, matching Moonscraper's behavior where flags modify existing notes.

### Conflict with tool shortcuts:

Currently 1-5 are tool selection shortcuts. Keys mode uses 1-5 for lane placement. Resolution:

**Option: Mode-based**

- When `activeTool === 'place'`, keys 1-5 are lane placement keys
- When `activeTool === 'cursor'`, keys 1-5 are tool selection shortcuts
- This is natural: you switch to "Place" mode (press 3 to select Place tool, or click the icon), then 1-5 become lane keys
- Switch back to cursor mode (press Escape) and 1-5 are tool shortcuts again

**Tool shortcuts become shifted in Place mode:**

- In place mode: 1-5 = lane keys
- Ctrl+1-5 = tool shortcuts (always available regardless of mode)
- This ensures tools are always accessible

## 4. Visual Indicators on Highway

### Cursor line:

- Horizontal line across the highway at the cursor tick position
- Color: bright green or white (configurable)
- Thickness: 2-3px
- Only visible when not playing (during playback, the strikeline is the visual anchor)

### Ghost note preview (enhanced):

When in Place mode with keys mode:

- Show faint ghost notes at ALL lane positions at the cursor tick
- Each ghost note shows the lane's color (red, yellow, blue, green, orange for kick)
- Pressing a key "solidifies" the ghost into a real note
- This gives visual feedback about where notes would be placed

### Current grid step indicator:

- Show the grid step size visually on the highway as subtle tick marks between beat lines
- Helps users see the resolution they're navigating at

## 5. Keyboard Shortcut Updates

### New shortcuts (add to useEditorKeyboard):

| Key        | Context           | Action                                       |
| ---------- | ----------------- | -------------------------------------------- |
| Up Arrow   | Editor (stopped)  | Move cursor forward one grid step            |
| Down Arrow | Editor (stopped)  | Move cursor backward one grid step           |
| Ctrl+Up    | Editor (stopped)  | Move cursor forward one measure              |
| Ctrl+Down  | Editor (stopped)  | Move cursor backward one measure             |
| 1-5        | Place tool active | Place/toggle note in lane at cursor          |
| Ctrl+1-5   | Always            | Select tool (cursor/place/erase/bpm/timesig) |

### Modified shortcuts:

| Key         | Old behavior         | New behavior                                        |
| ----------- | -------------------- | --------------------------------------------------- |
| Left Arrow  | Seek -5 seconds      | Move cursor back one grid step (same as Down)       |
| Right Arrow | Seek +5 seconds      | Move cursor forward one grid step (same as Up)      |
| 1-5         | Select tool (always) | Select tool (cursor mode) / Place note (place mode) |

### Kept as-is:

- Space: play/pause
- Shift+1-6, Shift+0: grid division selection
- Q/A/S: flag toggles
- Ctrl+Z/Y: undo/redo
- Delete/Backspace: delete selected
- Ctrl+C/X/V: clipboard

## 6. Integration with Existing Tools

### Cursor tool:

- Arrow keys navigate the cursor
- Click on highway selects notes (unchanged)
- No lane key placement in cursor mode

### Place tool:

- Arrow keys navigate the cursor
- Click on highway places note at mouse position (unchanged)
- Lane keys (1-5) place note at cursor position (new)
- Both mouse and keyboard placement coexist

### Erase tool:

- Arrow keys navigate the cursor
- Click on highway erases note (unchanged)
- Could add: pressing a lane key at cursor position deletes that lane's note (same toggle as place mode)

### BPM/TimeSig tools:

- Arrow keys navigate the cursor
- Click places BPM/TS at mouse position (unchanged)
- Could add: Enter key places BPM/TS at cursor position

## Execution Order

1. **Add `cursorTick` to ChartEditorContext** state. Initialize to 0.

2. **Implement grid step navigation** — `getNextGridTick()` and `getNextMeasureTick()` functions. Add to a shared utility (possibly `lib/drum-transcription/timing.ts` or new `components/chart-editor/navigation.ts`).

3. **Update useEditorKeyboard** — replace Left/Right time-seek with Up/Down/Left/Right grid navigation. Add Ctrl+arrows for measure navigation.

4. **Render cursor line on highway** — in HighwayEditor overlay canvas, draw horizontal line at cursor tick position (convert tick → ms → screen Y using existing coordinate mapping).

5. **Implement keys mode** — when activeTool === 'place', keys 1-5 dispatch AddNoteCommand at cursorTick. Handle toggle (delete if note exists).

6. **Remap tool shortcuts** — Ctrl+1-5 for tool selection (always available). 1-5 for lane keys in place mode.

7. **Add ghost note previews** — show faint notes at all lanes at cursor position in place mode.

8. **Sync cursor with playback** — cursor follows audioManager.currentTime during playback. On stop, cursor stays at stop position.

9. **Test navigation** — verify grid stepping at various divisions, measure boundaries, time signature changes.

## Verification

```bash
# Tests pass (grid navigation unit tests)
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` as the test chart. Load it in `/drum-edit`. Test iteratively after each execution step:

1. **After adding cursorTick state (step 1)** and **rendering cursor line (step 4)**:
   - Load the test chart in the editor
   - `take_screenshot` — verify a horizontal cursor line is visible on the highway (distinct from beat lines)
   - `list_console_messages` — no errors from new state

2. **After implementing grid navigation (steps 2-3)**:
   - `press_key` ArrowUp — `take_screenshot` — verify cursor moved forward by one grid step (visible line shifted up on highway)
   - `press_key` ArrowUp 4 more times — `take_screenshot` — cursor has moved several steps
   - `press_key` ArrowDown — verify cursor moves backward
   - Change grid to 1/4 (Shift+1) — `press_key` ArrowUp — verify larger step size (cursor jumps further)
   - Change grid to 1/16 (Shift+4) — `press_key` ArrowUp — verify smaller step size
   - `press_key` Ctrl+ArrowUp — `take_screenshot` — verify cursor jumped to next measure boundary
   - `press_key` Ctrl+ArrowDown — verify cursor jumped back to previous measure
   - Verify audio position syncs with cursor: after navigating, `press_key` Space to play — audio should start from cursor position

3. **After implementing keys mode (step 5)**:
   - Switch to Place tool: `press_key` Ctrl+3 (or click Place tool icon)
   - `press_key` 1 — `take_screenshot` — verify kick note appeared at cursor position
   - `press_key` 3 — `take_screenshot` — verify yellow note appeared at same tick (chord with kick)
   - `press_key` ArrowUp — cursor advances one step
   - `press_key` 2 — `take_screenshot` — verify red note at new position
   - Navigate back to the kick note position: `press_key` ArrowDown
   - `press_key` 1 — `take_screenshot` — verify kick note was REMOVED (toggle behavior)
   - `press_key` Ctrl+Z — verify undo restores the kick note
   - `list_console_messages` — no errors throughout

4. **After remapping tool shortcuts (step 6)**:
   - Switch to Cursor mode: `press_key` Ctrl+1
   - `press_key` 1 — verify this does NOT place a note (not in place mode)
   - `press_key` Ctrl+3 — verify switches to Place tool
   - `press_key` Ctrl+1 — verify switches back to Cursor
   - `press_key` Ctrl+4 — verify switches to BPM tool
   - `list_console_messages` — no shortcut conflicts

5. **After adding ghost note previews (step 7)**:
   - Switch to Place tool: `press_key` Ctrl+3
   - `take_screenshot` — verify faint ghost notes visible at all 5 lane positions at the cursor tick
   - `press_key` ArrowUp — `take_screenshot` — ghost notes moved with cursor
   - `press_key` 2 — verify ghost note solidified into a real red note, other ghosts still visible

6. **After syncing cursor with playback (step 8)**:
   - `press_key` Space — start playback
   - Wait 2 seconds — `take_screenshot` — verify cursor line is following playback (near strikeline)
   - `press_key` Space — stop playback
   - `take_screenshot` — verify cursor stayed at the stop position (not reset to 0)
   - `press_key` ArrowUp — verify cursor can be manually moved from the stop position

7. **Full workflow test**:
   - Load `All Time Low - SUCKERPUNCH (Hubbubble).sng` fresh
   - Navigate to chorus section (Ctrl+ArrowUp repeatedly or click timeline)
   - Switch to Place tool (Ctrl+3)
   - Chart a short pattern using keys: 1 (kick), ArrowUp, 3 (hat), ArrowUp, 2 (snare), ArrowUp, 3 (hat), ArrowUp
   - `take_screenshot` — verify 4 notes placed in sequence
   - `press_key` Space — play back the section to hear the pattern
   - Ctrl+Z four times — undo all notes
   - `take_screenshot` — verify notes gone
   - `list_console_messages` — zero errors
