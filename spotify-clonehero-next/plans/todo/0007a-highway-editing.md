# 0007a - Highway Editing: Note Manipulation and Sync Track Editing

> **Dependencies:** 0007 (editor core)
> **Unlocks:** 0007b (editor workflow)
>
> **Location:** `app/drum-transcription/` inside `~/projects/spotify-clonehero/spotify-clonehero-next/`. Next.js page, yarn, Tailwind, React state/context.
>
> **Key principle:** Editing happens on the Clone Hero highway itself, like Moonscraper. The highway is the primary editing surface. SheetMusic remains a read-only notation view that updates as the highway chart data changes.

## Overview

This plan adds editing capabilities to the Clone Hero highway renderer from 0007. The user selects, moves, adds, and deletes notes directly on the 3D highway -- the same visual they see in Clone Hero. This matches how Moonscraper works: the highway IS the editor.

Additionally, this plan adds BPM marker and time signature editing, and renders the audio waveform on the highway background for visual timing reference.

---

## 1. Highway as Editing Surface

### 1.1 Design Reference: Moonscraper

Moonscraper's editing model (from the codebase):

- **PlaceNote**: Mouse position on the highway maps to a lane (X position) and tick (Y position, snapped to grid). Left-click adds a note at that position via `SongEditAdd` command.
- **CursorSelect**: Click to select individual notes. Drag to create a selection rectangle. Shift+click for multi-select. Drag selected notes to move them (via `GroupMove`).
- **Eraser**: Click or drag-paint over notes to delete them. Deletions go through `SongEditDelete` command.
- **PlaceBPM / PlaceTimesignature**: Same pattern as PlaceNote but for sync track objects. Click on the highway to place a BPM marker or time signature change at the snapped tick position.
- **Command stack**: All mutations go through a command stack that supports undo/redo. `SongEditAdd` and `SongEditDelete` are reversible commands with `InvokeSongEditCommand()` / `RevokeSongEditCommand()`.

We adapt this pattern for the web.

### 1.2 Extending CloneHeroRenderer

The existing `CloneHeroRenderer` uses Three.js via `setupRenderer()` from `lib/preview/highway.ts`. To support editing, we extend (not replace) it:

1. **Add click/hover event handlers** to the Three.js canvas. Use raycasting to determine which lane and tick position the mouse is over.
2. **Add visual feedback**: ghost note preview at the cursor position (shows where a note would be placed), selection highlights on selected notes, drag preview when moving notes.
3. **Add an editing mode toggle**: the highway alternates between "playback" mode (current behavior) and "edit" mode (paused, cursor-driven). In edit mode, scrolling is manual rather than time-driven.

### 1.3 Coordinate Mapping

The highway renderer already maps tick positions to Y coordinates (notes scroll toward the player). For editing, we need the reverse:

```typescript
// Given a mouse click on the canvas, determine:
// 1. Which lane (X position -> note type)
// 2. Which tick (Y position -> tick, snapped to grid)

function canvasToChartPosition(
  mouseX: number,
  mouseY: number,
  camera: THREE.PerspectiveCamera,
  raycaster: THREE.Raycaster,
  highwayPlane: THREE.Mesh,
  chart: ParsedChart,
  gridDivision: number,
): { lane: number; tick: number } | null {
  // Raycast from camera through mouse position onto the highway plane
  // X position maps to lane (same logic as PlaceNote.XPosToNoteNumber)
  // Y position maps to time, converted to tick via tempo map, snapped to grid
}
```

Lane mapping for pro drums:

| Highway Lane | Note Type | Note # |
|---|---|---|
| 0 (leftmost) | Kick | 0 |
| 1 | Red (Snare) | 1 |
| 2 | Yellow (Hi-hat/Hi-tom) | 2 |
| 3 | Blue (Ride/Mid-tom) | 3 |
| 4 (rightmost) | Green (Crash/Floor-tom) | 4 |

Cymbal vs tom distinction is handled by note flags, not by lane position (same as Clone Hero and Moonscraper).

---

## 2. Editing Interactions

### 2.1 Tool Modes

Following Moonscraper's tool pattern, the editor has modes (toggled via toolbar buttons or keyboard):

| Mode | Behavior | Moonscraper equivalent |
|---|---|---|
| **Cursor** (default) | Click to select notes, drag to box-select, drag selected notes to move them | `CursorSelect` + `GroupMove` |
| **Place** | Click on highway to add a note at the cursor position. Lane determined by X, tick by Y (snapped to grid) | `PlaceNoteController` |
| **Erase** | Click or drag over notes to delete them | `Eraser` |
| **BPM** | Click to place a BPM marker at the cursor tick position. Opens a small input to set the BPM value | `PlaceBPM` |
| **Time Sig** | Click to place a time signature change at the cursor tick position. Opens a small input for numerator/denominator | `PlaceTimesignature` |

### 2.2 Mouse Interactions

**Cursor mode:**
- **Left-click** on a note: select it (highlight, show properties in sidebar)
- **Left-click** on empty highway: deselect all
- **Shift+click** on a note: toggle it in/out of multi-selection
- **Click+drag** on empty space: box/lasso selection (like Moonscraper's `CursorSelect`)
- **Click+drag** a selected note: move the selection as a group. X movement changes lane, Y movement changes tick (snapped to grid). Hold Alt to disable grid snap

**Place mode:**
- **Left-click** on highway: add a note at the (lane, tick) position. If a note already exists at that exact position and lane, remove it (toggle behavior)
- Ghost note preview follows the cursor to show where the note would land
- Note flags (cymbal/tom) default based on the lane: yellow/blue/green default to cymbal unless the user holds a modifier key (see shortcuts)

**Erase mode:**
- **Left-click** on a note: delete it
- **Left-click+drag**: delete all notes the cursor passes over (paint-erase, like Moonscraper's `Eraser`)

**BPM mode:**
- **Left-click** on highway: place a BPM marker at the snapped tick. Opens an inline input (or popover) pre-filled with the current BPM at that position. Confirm with Enter
- **Left-click** on existing BPM marker: select it for editing or deletion

**Time Sig mode:**
- **Left-click** on highway: place a time signature change. Opens an inline input for numerator/denominator (default 4/4). Confirm with Enter
- **Left-click** on existing time sig marker: select it for editing or deletion

### 2.3 Keyboard Shortcuts

Designed to match Moonscraper's workflow. Left hand on keyboard, right hand on mouse.

**Tool selection:**
| Key | Action |
|---|---|
| `1` | Cursor mode |
| `2` | Place mode |
| `3` | Erase mode |
| `4` | BPM mode |
| `5` | Time Sig mode |

**Note type shortcuts (in Place mode, or applied to selection in Cursor mode):**
| Key | Action |
|---|---|
| `Q` | Toggle cymbal flag on selected/placed note |
| `W` | Toggle tom flag on selected/placed note |
| `A` | Toggle accent flag |
| `S` | Toggle ghost flag |

**Grid snap:**
| Key | Action |
|---|---|
| `Shift+1` through `Shift+6` | Set grid snap: 1/4, 1/8, 1/12, 1/16, 1/32, 1/64 |
| `Shift+0` | Free/unquantized (no snap) |

**Navigation (same as 0007, repeated here for completeness):**
| Key | Action |
|---|---|
| `Space` | Play/Pause |
| `Left/Right` | Step by grid division |
| `Shift+Left/Right` | Step by beat |
| `Ctrl+Left/Right` | Step by measure |
| `Home/End` | Jump to start/end |
| `+` / `-` | Zoom in/out |

**Editing:**
| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` or `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected notes |
| `Ctrl+A` | Select all notes in visible region |
| `Escape` | Deselect all / cancel current operation |

---

## 3. Waveform on Highway Background

### 3.1 Concept

Like Moonscraper, render the audio waveform directly on the highway background. This gives the user a visual timing reference while editing -- they can see the audio transients and align notes to them.

### 3.2 Implementation

1. **Pre-compute waveform data**: When audio loads, compute the waveform peaks from the drum stem's AudioBuffer. Store as a Float32Array of peak values at a fixed samples-per-pixel resolution.

2. **Render as a Three.js texture or geometry**: Create a texture from the waveform data and apply it to the highway plane as a semi-transparent overlay. The texture scrolls with the highway.

   Alternative: render the waveform as a set of thin line geometries (THREE.LineSegments) positioned along the highway. This may look better and is easier to scroll.

3. **Sync with tempo map**: The waveform is in time (ms), but the highway is in ticks. Use the tempo map to correctly stretch/compress the waveform texture to match the highway's tick-based layout. Where BPM is higher, the same amount of audio time maps to more ticks (and more highway space).

4. **Visual style**: Low opacity (0.15-0.25), monochrome, behind the notes but in front of the highway surface. Should be subtle enough not to distract from note editing but visible enough to see transients.

### 3.3 Performance

The waveform texture only needs to cover the visible portion of the highway plus a buffer. Regenerate the texture segment when the view scrolls beyond the buffered region. For a typical view showing ~4 seconds of audio, the texture resolution needs to be modest (a few thousand pixels tall).

---

## 4. Chart Data Mutation

### 4.1 Command Pattern

All edits go through a command system (inspired by Moonscraper's `SongEditAdd`, `SongEditDelete`, `SongEditCommand`). This enables undo/redo (implemented in 0007b, but the command infrastructure is built here).

```typescript
// app/drum-transcription/commands.ts

interface EditCommand {
  execute(state: ChartState): ChartState;
  undo(state: ChartState): ChartState;
  description: string; // for undo history display
}

class AddNoteCommand implements EditCommand {
  constructor(private note: DrumNote) {}
  execute(state) { /* insert note, maintain sort order */ }
  undo(state) { /* remove the note */ }
}

class DeleteNotesCommand implements EditCommand {
  constructor(private notes: DrumNote[]) {}
  execute(state) { /* remove notes */ }
  undo(state) { /* re-insert notes */ }
}

class MoveNotesCommand implements EditCommand {
  constructor(
    private noteIds: string[],
    private tickDelta: number,
    private laneDelta: number,
  ) {}
  execute(state) { /* update tick and lane for each note */ }
  undo(state) { /* reverse the deltas */ }
}

class AddBPMCommand implements EditCommand {
  constructor(private tick: number, private bpm: number) {}
  execute(state) { /* insert BPM marker */ }
  undo(state) { /* remove BPM marker */ }
}

class AddTimeSignatureCommand implements EditCommand {
  constructor(
    private tick: number,
    private numerator: number,
    private denominator: number,
  ) {}
  execute(state) { /* insert time sig */ }
  undo(state) { /* remove time sig */ }
}

class BatchCommand implements EditCommand {
  constructor(private commands: EditCommand[]) {}
  execute(state) { /* execute all in order */ }
  undo(state) { /* undo all in reverse order */ }
}
```

### 4.2 State Updates

When a command executes, it produces a new chart state. The EditorContext reducer handles this:

```typescript
case 'EXECUTE_COMMAND': {
  const newChartState = action.command.execute(state.chart);
  return {
    ...state,
    chart: newChartState,
    dirty: true,
  };
}
```

The undo/redo stack is built in 0007b but the command objects are defined here so all edit actions use them from the start.

### 4.3 Note ID Scheme

Same as the original plan -- composite key `${tick}:${type}`. Unique because the chart format does not allow two notes of the same type at the same tick.

### 4.4 Updating Downstream Views

When chart data changes via an edit:
1. The SheetMusic component re-renders automatically because it receives `chart` and `track` as props. VexFlow re-renders from the updated data.
2. The CloneHeroRenderer needs to be notified. Either:
   - Pass the chart as a prop and re-run `renderer.prepTrack(track)` on change (debounced to avoid per-keystroke rebuilds), or
   - Use a ref-based callback that the edit system calls directly.

Debounce the highway rebuild to 300ms after the last edit. SheetMusic can update immediately since VexFlow rendering is fast.

---

## 5. BPM and Time Signature Editing

### 5.1 BPM Markers

BPM markers appear on the highway as horizontal lines with the BPM value displayed. In BPM tool mode:

- Click to place a new BPM marker at the snapped tick position
- The value defaults to the current BPM at that tick (same as Moonscraper's `PlaceBPM`)
- A small inline popover appears to edit the value
- Existing BPM markers can be selected, edited (change value), or deleted
- Cannot delete the BPM marker at tick 0 (always required)

### 5.2 Time Signatures

Time signature markers appear on the highway as horizontal lines with the signature displayed (e.g., "4/4", "7/8"). In Time Sig tool mode:

- Click to place a new time signature at the snapped tick position
- Defaults to 4/4
- A small inline popover appears to edit numerator and denominator
- Existing markers can be selected, edited, or deleted
- Cannot delete the time signature at tick 0

### 5.3 Impact on Grid

When BPM or time signature changes, the grid lines on the highway must update. The grid is derived from the tempo map and time signatures:
- Beat lines at each beat boundary
- Sub-beat lines at the current grid division (1/8th, 1/16th, etc.)
- Measure lines (stronger visual) at measure boundaries
- BPM changes affect the spacing between grid lines (higher BPM = more ticks per second = denser lines in the time view)

---

## 6. Note Properties Sidebar

When one or more notes are selected, a sidebar panel shows editable properties:

- **Drum type**: kick, snare, hi-hat, hi-tom, ride, mid-tom, crash, floor-tom (dropdown or button group)
- **Flags**: cymbal, tom, accent, ghost (toggle buttons). Cymbal and tom are mutually exclusive for yellow/blue/green lanes
- **Tick position**: numeric input for fine adjustment
- **Confidence score**: read-only display (if available from ML model)

Changes in the sidebar apply to all selected notes and go through the command system.

---

## 7. Selection State

Selection state is managed in EditorContext:

```typescript
interface EditorState {
  // ... from 0007
  selectedNoteIds: Set<string>;
  activeTool: 'cursor' | 'place' | 'erase' | 'bpm' | 'timesig';
  gridDivision: number; // 4, 8, 12, 16, 32, 64, or 0 (free)
}
```

Selection is view state (not undo-able). Tool mode is view state.

---

## 8. Implementation Steps

1. **Extend highway.ts for raycasting**: Add mouse event handlers to the Three.js canvas. Implement raycasting to determine lane and tick from mouse position. Add ghost note preview rendering.

2. **Implement tool modes**: Build the Cursor, Place, and Erase tools following Moonscraper's patterns. Wire up mouse interactions.

3. **Build command infrastructure**: Implement `EditCommand` interface and concrete command classes (`AddNoteCommand`, `DeleteNotesCommand`, `MoveNotesCommand`).

4. **Wire commands to EditorContext**: Add reducer cases for `EXECUTE_COMMAND`. Update chart state on edit. Propagate changes to SheetMusic and CloneHeroRenderer.

5. **Add keyboard shortcuts**: Register keyboard event handlers for tool selection, grid snap, and editing shortcuts.

6. **Implement note selection**: Click-to-select, shift-click multi-select, drag box-select. Highlight selected notes on the highway. Build the note properties sidebar.

7. **Implement note movement**: Drag selected notes to reposition. Snap to grid. Update via `MoveNotesCommand`.

8. **Add waveform to highway**: Compute waveform peaks from AudioBuffer. Render as a Three.js overlay on the highway. Sync with tempo map.

9. **BPM and time signature editing**: Implement BPM and TimeSignature tool modes. Add visual markers on the highway. Build inline popovers for value input. Wire through command system.

10. **Test with real data**: Load a transcription, edit notes, verify SheetMusic updates, verify highway visual sync, verify BPM/time sig editing works.

---

## 9. What This Plan Does NOT Cover

- Undo/redo stack management (command infrastructure is here, stack is in 0007b)
- Copy/paste (0007b)
- Confidence visualization (0007b)
- Review tracking (0007b)
- Auto-save (0007b)
- Stem volume controls (0007b)
