# 0007 - Web-Based Drum Transcription Editor

> **Dependencies:** 0002 (chart I/O), 0006 (chart preview integration), 0005 (confidence data format)
> **Unlocks:** 0008 (pipeline orchestration)
>
> **Integration:** The editor lives at `app/drum-transcription/components/`. Uses existing shadcn/ui components (`Button`, `Dialog`, `Select`, `Slider`, `Card`, etc. from `components/ui/`). State via Zustand (`app/drum-transcription/store.ts`). Chart data loaded from OPFS via `lib/fileSystemHelpers.ts`. Saves to OPFS. Export triggers browser download (plan 0009). Audio playback can leverage existing `lib/preview/audioManager.ts` patterns or WaveSurfer.
>
> **Existing drum UI reference:** `app/sheet-music/[slug]/convertToVexflow.ts` has the complete drum note → notation mapping, and `lib/fill-detector/drumLaneMap.ts` has `NoteType` → `DrumVoice` mapping. Reuse these for the drum lane grid.

## Overview

The editor is the core user-facing tool: given an ML-generated drum transcription (a `.chart` file) and its corresponding audio (the separated drum stem), present an interface where a human can review, correct, and finalize the chart. The final output is a corrected `.chart` file ready for Clone Hero.

The key constraint is that this is a *correction* tool, not a creation-from-scratch tool. The ML model provides a first pass; the human fixes mistakes. That shapes every design decision -- the UI must make it fast to spot errors and fix them, not to compose from nothing.

---

## 1. Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **React 19** | Component model fits the multi-panel layout; prior art in drum-transcription-web; large ecosystem for audio/canvas work |
| Build tool | **Vite** (via Bun) | Fast HMR, native TS support, Bun-compatible; same stack as drum-transcription-web reference |
| Language | **TypeScript** (strict) | Non-negotiable given the chart data model complexity |
| Audio waveform | **WaveSurfer.js 7+** | Proven in drum-transcription-web; RegionsPlugin for note markers, ZoomPlugin, MinimapPlugin. Web Audio API backed |
| Chart highway preview | **chart-preview** web component | Already a dependency. Provides synchronized 3D highway playback as a `<chart-preview-player>` element |
| Chart parsing | **scan-chart** | Already a dependency. `parseChartFile()` returns fully typed `NoteEvent[]` with tick/ms times, types, flags |
| Chart writing | **Custom serializer** | scan-chart only reads; we write `.chart` files directly (simple text format, reference Moonscraper's `ChartWriter.cs`) |
| State management | **Zustand** | Lightweight, works well with undo/redo (middleware), no boilerplate. Avoids Redux overhead for what is fundamentally a single-document editor |
| Styling | **CSS Modules** or **Tailwind CSS** | Low-overhead, co-located styles. The editor is a specialized tool, not a marketing site |

### Why not plain web components?

chart-preview is framework-agnostic, but the *editor* itself benefits from React's component lifecycle, state management ecosystem, and developer tooling. The chart-preview web component integrates into React via refs (documented in their README).

---

## 2. Editor Layout

```
+------------------------------------------------------------------+
|  Toolbar: [File] [Edit] [View]  |  Song: "Title" - Artist  | Bpm |
+------------------------------------------------------------------+
|                                                                    |
|  +------------------------------------------------------------+  |
|  |  WaveSurfer Minimap (full song overview, click to navigate) |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +------------------------------------------------------------+  |
|  |                                                              |  |
|  |  WaveSurfer Waveform (zoomable, scrollable)                 |  |
|  |  [onset markers as colored regions aligned to note events]  |  |
|  |                                                              |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +------------------------------------------------------------+  |
|  |                                                              |  |
|  |  Drum Lane Grid (primary editing surface)                   |  |
|  |                                                              |  |
|  |  Time axis (horizontal, synced with waveform) ----------->  |  |
|  |                                                              |  |
|  |  Lanes (vertical):                                          |  |
|  |    Kick    | [x]   [x]      [x]   [x]      [x]             |  |
|  |    Snare   |    [x]      [x]   [?]      [x]                |  |
|  |    Hi-hat  | [x][x][x][x][x][x][x][x][x][x][x][x]         |  |
|  |    Tom Hi  |                         [x]                    |  |
|  |    Tom Mid |                            [x]                 |  |
|  |    Tom Lo  |                               [x]              |  |
|  |    Crash   |    [x]                  [x]                    |  |
|  |    Ride    |                                     [x][x][x]  |  |
|  |                                                              |  |
|  +------------------------------------------------------------+  |
|                                                                    |
|  +-------------------------------+  +-------------------------+  |
|  |  Transport Controls           |  |  chart-preview          |  |
|  |  [|<] [<] [Play/Pause] [>]    |  |  (3D highway, synced)   |  |
|  |  [>|]                         |  |  Shows what the player  |  |
|  |  Speed: [0.5x] [1x] [2x]     |  |  would see              |  |
|  |  Position: 1:23.456           |  |                         |  |
|  +-------------------------------+  +-------------------------+  |
+------------------------------------------------------------------+
```

### 2.1 Component Breakdown

#### `<EditorApp>`
Top-level layout container. Manages the global state store, audio context, and file I/O.

#### `<Toolbar>`
Menu bar with file operations (Open, Save, Export), edit operations (Undo, Redo), and view controls (zoom level, grid snap settings, lane visibility toggles).

#### `<WaveformPanel>`
Wraps WaveSurfer.js. Two sub-components:
- `<Minimap>` -- Full-song overview using WaveSurfer's MinimapPlugin. Click to jump anywhere.
- `<WaveformView>` -- Zoomed waveform. Uses RegionsPlugin to draw colored markers at each note event's ms position. Marker colors match drum type (red=snare, yellow=hi-hat, blue=tom, etc.). Uncertain notes (low ML confidence) get a different visual treatment (semi-transparent, dashed border).

#### `<DrumLaneGrid>`
The primary editing surface. A canvas-based (HTML Canvas 2D or OffscreenCanvas) scrollable grid:
- **X axis**: time (ticks or ms, toggle-able). Grid lines at beat/sub-beat divisions derived from the tempo map.
- **Y axis**: drum lanes. For fourLanePro drums: Kick, Red (snare), Yellow (hi-hat/hi-tom), Blue (mid-tom/ride), Green (lo-tom/crash). With pro drum cymbal markers, yellow/blue/green each split into tom + cymbal sub-lanes.
- **Notes** rendered as colored rectangles/circles at their (time, lane) position.
- **Confidence overlay**: notes with low ML confidence shown with a highlight border, translucent fill, or a small "?" badge. See section 7.

#### `<ChartHighwayPreview>`
Wraps the `<chart-preview-player>` web component. Configured with `instrument: 'drums'`, `difficulty: 'expert'`. Receives the current parsed chart data and audio. Synced to the same playback position as the waveform. Positioned in the bottom-right as a secondary reference view.

The highway preview is *read-only* -- it shows the chart as a Clone Hero player would see it. After edits, it needs to be refreshed with the updated chart data (see section 4).

#### `<TransportControls>`
Play/Pause, step forward/backward (by beat, by note, by measure), playback speed (0.25x to 2x), current position display (time + tick + beat.measure), loop region controls (set A/B points for repeated review of a section).

#### `<NoteInspector>` (sidebar/panel, shown on selection)
When one or more notes are selected, shows editable properties:
- Drum type (kick, snare, hi-hat, tom, crash, ride)
- Flags (cymbal, tom, ghost, accent, flam)
- Tick position (fine adjustment)
- ML confidence score (read-only)

### 2.2 Lane Mapping

The drum lane grid maps chart note types to visual lanes. For pro drums:

| Lane | Chart NoteType | Note # in .chart | Color |
|---|---|---|---|
| Kick | `kick` (13) | 0 | Orange |
| Snare | `redDrum` (14) | 1 | Red |
| Hi-hat (cymbal) | `yellowDrum` (15) + cymbal flag | 2 + cymbal marker | Yellow |
| Hi-tom (tom) | `yellowDrum` (15) + tom flag | 2 + tom marker | Yellow (darker) |
| Ride (cymbal) | `blueDrum` (16) + cymbal flag | 3 + cymbal marker | Blue |
| Mid-tom (tom) | `blueDrum` (16) + tom flag | 3 + tom marker | Blue (darker) |
| Crash (cymbal) | `greenDrum` (17) + cymbal flag | 4 + cymbal marker | Green |
| Floor-tom (tom) | `greenDrum` (17) + tom flag | 4 + tom marker | Green (darker) |

The lane grid should support collapsing tom/cymbal sub-lanes for simpler four-lane editing when pro drums distinction is not needed.

---

## 3. Editing Interactions

### 3.1 Click to Add/Remove Notes

- **Left-click** on empty grid cell: add a note at that (time, lane) position. Time snaps to the nearest grid division (configurable: 1/4, 1/8, 1/16, 1/32, 1/64 note, or free/unquantized).
- **Left-click** on existing note: select it (highlight, show in NoteInspector).
- **Right-click** on existing note: delete it.
- **Shift+click**: add to selection (multi-select).
- **Click+drag** on empty space: box/lasso selection.

### 3.2 Drag to Adjust Timing

- **Drag** a selected note horizontally: move it in time. Snaps to grid unless Alt is held (free positioning).
- **Drag** a selected note vertically: move it to a different lane (change drum type).
- **Drag** multiple selected notes: move them as a group, maintaining relative timing.

### 3.3 Keyboard Shortcuts

Designed for speed. The left hand rests on the keyboard while the right hand uses the mouse on the grid.

**Drum type shortcuts** (press while hovering over a time position to quick-add a note):
| Key | Action |
|---|---|
| `K` | Add/toggle Kick |
| `S` | Add/toggle Snare |
| `H` | Add/toggle Hi-hat (cymbal) |
| `T` | Add/toggle Hi-tom |
| `R` | Add/toggle Ride |
| `B` | Add/toggle Blue tom |
| `C` | Add/toggle Crash |
| `G` | Add/toggle Green tom (floor tom) |

**Navigation shortcuts:**
| Key | Action |
|---|---|
| `Space` | Play/Pause |
| `Left/Right` | Step by grid division |
| `Shift+Left/Right` | Step by beat |
| `Ctrl+Left/Right` | Step by measure |
| `Home/End` | Jump to start/end |
| `[` / `]` | Set loop start/end at cursor |
| `Ctrl+Shift+Left/Right` | Step to next/prev note |

**Editing shortcuts:**
| Key | Action |
|---|---|
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |
| `Delete` / `Backspace` | Delete selected notes |
| `Ctrl+A` | Select all notes (in visible region) |
| `Ctrl+D` | Deselect all |
| `Ctrl+C` / `Ctrl+V` | Copy/Paste selection |
| `+` / `-` | Zoom in/out (time axis) |
| `1`-`5` | Set grid snap division (1/4, 1/8, 1/16, 1/32, 1/64) |
| `0` | Free/unquantized grid |

**Flag shortcuts** (applied to selected notes):
| Key | Action |
|---|---|
| `F` | Toggle flam |
| `A` | Toggle accent |
| `Shift+G` | Toggle ghost |

### 3.4 Undo/Redo

Zustand store with history middleware. Each action that modifies the note data pushes a state snapshot (or a reversible diff/patch) onto the undo stack. Undo/redo operates on the note data only, not on view state (zoom, scroll position, selection).

Use a command pattern internally:
```typescript
interface EditCommand {
  type: 'addNote' | 'removeNote' | 'moveNote' | 'changeNoteType' | 'changeNoteFlags' | 'batch'
  // forward/reverse deltas
  apply(state: ChartState): ChartState
  reverse(state: ChartState): ChartState
}
```

Batch operations (e.g., "delete 20 selected notes") are grouped into a single undo step.

---

## 4. Audio Synchronization

This is the hardest integration challenge. Three components need synchronized playback:

1. **WaveSurfer** (waveform) -- owns the Web Audio playback
2. **DrumLaneGrid** (note grid) -- scrolls to follow playback position
3. **chart-preview** (3D highway) -- has its own internal audio playback

### 4.1 Architecture: Single Audio Source

WaveSurfer is the **primary audio source**. It controls play/pause/seek and provides the authoritative current time.

The DrumLaneGrid reads the current time from WaveSurfer on each animation frame (`requestAnimationFrame`) and scrolls accordingly. This is simple -- it's just a position query, no separate audio.

The chart-preview component is more complex. It has its own internal `AudioManager` that creates `AudioBufferSourceNode`s from audio file data. We have two options:

**Option A: Dual audio, synced via seek events (Recommended)**

Let chart-preview manage its own audio independently. Synchronize by:
1. When WaveSurfer fires a `seek` or `play` event, call `chartPreviewPlayer.seek(percent)` followed by `chartPreviewPlayer.play()`.
2. Periodically (every ~500ms during playback) check for drift between WaveSurfer's `getCurrentTime()` and `chartPreviewPlayer.currentTimeMs`. If drift exceeds a threshold (e.g., 50ms), re-sync with a seek.
3. When editing changes the chart data, rebuild the chart-preview's parsed chart and reload it via `loadChart()`.

This is simpler because chart-preview's API is designed for this usage. The preview is a secondary "what you'll see in-game" view, not the primary editing surface, so minor sync drift is acceptable.

**Option B: Mute chart-preview audio, share WaveSurfer's output**

Set `chartPreviewPlayer.setVolume(0)` and let WaveSurfer handle all audio. The chart-preview still renders visuals based on its internal clock, synced via seek calls. This avoids double-audio but the visual may drift without the audio feedback loop. This is the approach to take if dual audio causes confusion (hearing two slightly offset audio streams).

**Recommendation:** Start with Option B (muted chart-preview audio). It's simpler and avoids the dual-audio artifact. If the visual drift is noticeable, add the periodic re-sync from Option A.

### 4.2 Time Coordinate System

The editor needs to work in three time systems:
- **Milliseconds (ms)**: WaveSurfer's native time, audio playback position
- **Ticks**: Chart's native position unit, used in `.chart` file format
- **Beat.Measure**: Human-readable position for display

The tempo map (from `parsedChart.tempos`) and resolution (from `parsedChart.resolution`, typically 192 or 480 ticks per quarter note) define the conversions:

```typescript
function msToTick(ms: number, tempos: Tempo[], resolution: number): number
function tickToMs(tick: number, tempos: Tempo[], resolution: number): number
function tickToBeatMeasure(tick: number, timeSignatures: TimeSig[], resolution: number): { measure: number, beat: number, subdivision: number }
```

All note positions are stored internally in **ticks** (the chart's native format). Ms times are computed on the fly for display and audio sync. This matches how scan-chart stores data (`NoteEvent` has both `tick` and `msTime`).

---

## 5. State Management

### 5.1 Store Structure

```typescript
interface EditorStore {
  // -- Document state (serializable, undo-able) --
  chart: {
    resolution: number              // ticks per quarter note
    metadata: ChartMetadata         // song name, artist, etc.
    tempos: Tempo[]                 // BPM changes
    timeSignatures: TimeSignature[] // time sig changes
    sections: Section[]             // section markers
    notes: DrumNote[]               // the note events (sorted by tick)
    drumType: DrumType              // fourLane, fourLanePro, fiveLane
  }

  // -- Editing state --
  selection: Set<string>            // IDs of selected notes
  clipboard: DrumNote[]             // copied notes (relative to first note's tick)
  undoStack: EditCommand[]
  redoStack: EditCommand[]
  dirty: boolean                    // unsaved changes

  // -- View state (not undo-able) --
  view: {
    scrollPositionMs: number        // horizontal scroll position
    zoomLevel: number               // ms per pixel
    gridDivision: number            // 4, 8, 16, 32, 64, or 0 (free)
    showConfidence: boolean         // toggle confidence overlay
    collapsedLanes: Set<string>     // which lanes are collapsed
    playbackSpeed: number           // 0.25 to 2.0
    loopRegion: { startMs: number; endMs: number } | null
  }

  // -- Playback state --
  playback: {
    isPlaying: boolean
    currentTimeMs: number           // updated by animation frame
  }

  // -- ML Metadata (read-only) --
  confidence: Map<string, number>   // noteId -> confidence score (0-1)

  // -- Actions --
  addNote(lane: DrumLane, tick: number, flags?: number): void
  removeNote(noteId: string): void
  moveNote(noteId: string, newTick: number, newLane?: DrumLane): void
  setNoteFlags(noteId: string, flags: number): void
  batchEdit(commands: EditCommand[]): void
  undo(): void
  redo(): void
  // ... view and playback actions
}
```

### 5.2 Note ID Scheme

Each note needs a stable identity for selection, undo/redo, and confidence mapping. Use a composite key:

```typescript
function noteId(tick: number, type: NoteType): string {
  return `${tick}:${type}`
}
```

This is unique because the chart format does not allow two notes of the same type at the same tick. When a note's tick or type changes, its ID changes -- the undo/redo system tracks this.

### 5.3 DrumNote Internal Type

```typescript
interface DrumNote {
  id: string          // composite key
  tick: number
  msTime: number      // computed from tempo map, cached
  type: NoteType      // kick, redDrum, yellowDrum, blueDrum, greenDrum
  flags: number       // bitmask: tom, cymbal, ghost, accent, flam, doubleKick
  confidence?: number // ML prediction confidence (0-1), undefined for manually added notes
}
```

---

## 6. Loading and Saving Chart Data

### 6.1 Loading

In the browser-only architecture, loading happens from two sources:

**From pipeline (primary flow):**
The upstream pipeline steps (decode → Demucs → ML transcription) produce chart data and audio in OPFS. The editor reads directly from OPFS:
```
Pipeline completes
  → read chart text from OPFS: {project}/chart/notes.chart
  → parseChartFile(chartData, 'chart', modifiers) via scan-chart
  → extract drums track at expert difficulty
  → convert NoteEvent[] to DrumNote[] (add IDs, cache ms times)
  → read audio from OPFS: {project}/stems/drums.pcm
  → load audio into WaveSurfer
  → populate the store
```

**From file picker (standalone editing):**
Users can also open an existing .chart file + audio via drag-and-drop or file picker for editing without running the pipeline.

Confidence scores from the ML model are stored alongside chart data as a JSON sidecar in OPFS: `{project}/chart/confidence.json`.

### 6.2 Saving

**Auto-save to OPFS:** The editor periodically writes to `{project}/chart/notes.edited.chart` in OPFS. The original ML-generated chart is preserved.

```typescript
async function saveToOPFS(projectName: string, chartText: string) {
  const root = await navigator.storage.getDirectory()
  const projectDir = await root.getDirectoryHandle(projectName)
  const chartDir = await projectDir.getDirectoryHandle('chart')
  const fileHandle = await chartDir.getFileHandle('notes.edited.chart', { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(chartText)
  await writable.close()
}
```

### 6.3 Exporting

Export produces a **packaged archive** (`.zip` or `.sng`) containing all files needed for Clone Hero. See plan 0008 for the full export specification. The `.chart` format is straightforward text:

```
[Song]
{
  Name = "Song Title"
  Artist = "Artist Name"
  Resolution = 192
  Offset = 0
  MusicStream = "song.ogg"
  DrumStream = "drums.ogg"
}
[SyncTrack]
{
  0 = TS 4
  0 = B 120000
}
[Events]
{
  0 = E "section Intro"
}
[ExpertDrums]
{
  0 = N 0 0
  0 = N 2 0
  192 = N 1 0
  192 = N 2 0
  192 = N 66 0
}
```

The serializer converts `DrumNote[]` back to chart note numbers:

```typescript
function drumNoteToChartEvents(note: DrumNote): { noteNumber: number; length: number }[] {
  const events: { noteNumber: number; length: number }[] = []

  // Base note number
  const baseNote = {
    [noteTypes.kick]: 0,
    [noteTypes.redDrum]: 1,
    [noteTypes.yellowDrum]: 2,
    [noteTypes.blueDrum]: 3,
    [noteTypes.greenDrum]: 4,
  }[note.type]

  events.push({ noteNumber: baseNote, length: 0 })

  // Modifier note numbers
  if (note.flags & noteFlags.cymbal) {
    // Pro drums cymbal markers: 66 (yellow), 67 (blue), 68 (green)
    const cymbalNote = { [noteTypes.yellowDrum]: 66, [noteTypes.blueDrum]: 67, [noteTypes.greenDrum]: 68 }[note.type]
    if (cymbalNote) events.push({ noteNumber: cymbalNote, length: 0 })
  }
  if (note.flags & noteFlags.ghost) {
    const ghostNote = { [noteTypes.redDrum]: 39, [noteTypes.yellowDrum]: 40, [noteTypes.blueDrum]: 41, [noteTypes.greenDrum]: 42 }[note.type]
    if (ghostNote) events.push({ noteNumber: ghostNote, length: 0 })
  }
  if (note.flags & noteFlags.accent) {
    const accentNote = { [noteTypes.redDrum]: 33, [noteTypes.yellowDrum]: 34, [noteTypes.blueDrum]: 35, [noteTypes.greenDrum]: 36 }[note.type]
    if (accentNote) events.push({ noteNumber: accentNote, length: 0 })
  }
  if (note.flags & noteFlags.doubleKick) {
    events.push({ noteNumber: 32, length: 0 })
  }

  return events
}
```

**Auto-save**: periodically save to `localStorage` or IndexedDB to prevent data loss. Show a "dirty" indicator when there are unsaved changes.

**Export formats**:
- Primary: `.chart` file (download)
- Secondary: re-package as `.sng` if the user wants a complete chart package (requires bundling audio + chart + song.ini)

---

## 7. Confidence Visualization

The ML model assigns a confidence score (0.0-1.0) to each predicted note. This is the editor's killer feature -- directing human attention to the notes most likely to be wrong.

### 7.1 Visual Treatment

In the DrumLaneGrid, notes are rendered with confidence-dependent styling:

| Confidence | Visual |
|---|---|
| >= 0.9 (high) | Solid fill, full opacity. Standard note appearance. |
| 0.7 - 0.9 (medium) | Solid fill, slightly reduced opacity. Thin amber border. |
| 0.5 - 0.7 (low) | Semi-transparent fill, dashed amber border, small "?" icon. |
| < 0.5 (very low) | Semi-transparent fill, dashed red border, "?" icon, slightly larger hitbox for easy selection. |
| manually added | Solid fill, small "+" badge or distinct border style to indicate human-added. |

### 7.2 Confidence-Based Navigation

Add toolbar buttons / keyboard shortcuts:
- **`N`**: Jump to next low-confidence note (below threshold, configurable)
- **`Shift+N`**: Jump to previous low-confidence note
- **Confidence filter**: slider in toolbar to hide all notes above a confidence threshold, showing only the ones that need review
- **Statistics panel**: "247 notes total, 23 low-confidence, 5 reviewed" -- progress tracker

### 7.3 Review Workflow

When the user interacts with a note (confirms it's correct by clicking without changing it, or edits it), mark it as "reviewed." Reviewed notes get a subtle checkmark. This lets the user track their progress through the chart.

```typescript
interface DrumNote {
  // ... existing fields
  confidence?: number
  reviewed: boolean    // set to true after user interaction
}
```

---

## 8. Performance Considerations

### 8.1 Large Charts

A typical 4-minute song at 180 BPM with constant eighth-note hi-hat, kick, and snare has ~2,000-4,000 notes. A complex prog/metal chart could have 10,000+. The editor must handle this smoothly.

**DrumLaneGrid rendering strategy:**

Use **HTML Canvas 2D** with virtualized rendering. Only draw notes that are within the visible viewport (current scroll position +/- some buffer):

```typescript
function render(ctx: CanvasRenderingContext2D, state: EditorStore) {
  const visibleStartMs = state.view.scrollPositionMs
  const visibleEndMs = visibleStartMs + (canvasWidth * state.view.zoomLevel)

  // Binary search for first visible note (notes are sorted by tick/ms)
  const startIdx = binarySearchFirstGte(state.chart.notes, visibleStartMs, n => n.msTime)

  // Draw only visible notes
  for (let i = startIdx; i < state.chart.notes.length; i++) {
    const note = state.chart.notes[i]
    if (note.msTime > visibleEndMs) break
    drawNote(ctx, note, state)
  }
}
```

This keeps rendering O(visible notes) rather than O(all notes), regardless of chart length.

**Grid lines**: Precompute beat/measure positions for the full chart once on load (using the tempo map). Store as a sorted array. Use the same binary search + viewport culling for grid line rendering.

### 8.2 Smooth Scrolling During Playback

During playback, the grid auto-scrolls to follow the playback position. Use `requestAnimationFrame` for smooth 60fps updates:

```typescript
function animationLoop() {
  if (store.playback.isPlaying) {
    const currentMs = wavesurfer.getCurrentTime() * 1000
    store.playback.currentTimeMs = currentMs
    // Scroll the grid to center on the current position
    store.view.scrollPositionMs = currentMs - (canvasWidth * store.view.zoomLevel) / 3
    renderGrid()
  }
  requestAnimationFrame(animationLoop)
}
```

Position the playhead about 1/3 from the left edge (not centered) so the user can see what's coming up.

### 8.3 WaveSurfer Performance

WaveSurfer can struggle with very long audio files at extreme zoom levels. Mitigations:
- Use `backend: 'WebAudio'` (default) for accurate playback
- Set `minPxPerSec` to a reasonable minimum (e.g., 50) to prevent over-rendering
- Use the MinimapPlugin for overview navigation rather than zooming all the way out
- Consider pre-computing and caching waveform peaks if loading is slow

### 8.4 chart-preview Refresh After Edits

When the user edits notes, the chart-preview needs to be updated. Re-parsing and reloading the entire chart on every edit would be too expensive. Strategy:

1. **Debounce**: after edits stop for 500ms, rebuild the chart data and reload the preview.
2. **Rebuild in a web worker** if the serialization + re-parse is slow (unlikely for typical chart sizes, but good to plan for).
3. The `loadChart()` method on chart-preview disposes and recreates the 3D scene. This is acceptable for a debounced update but not for per-keystroke updates.

Alternative: since chart-preview uses `NotesManager` internally with a flat `NoteEvent[]`, we could potentially fork or extend chart-preview to accept note data updates without a full reload. This is a V2 optimization.

### 8.5 Memory

Keep one copy of the note data in the Zustand store. WaveSurfer regions reference notes by ID, not by holding copies. The undo stack stores diffs (commands), not full state snapshots, to avoid O(n * undo_depth) memory for large charts.

---

## 9. Implementation Phases

### Phase 1: Core Editor (MVP)
- File loading (chart + audio)
- WaveSurfer waveform display with playback
- DrumLaneGrid with note rendering (read-only)
- Basic transport controls (play, pause, seek)
- Zoom and scroll
- Note selection

### Phase 2: Editing
- Click to add/remove notes
- Keyboard shortcuts for drum types
- Drag to adjust timing
- Undo/redo
- Save/export .chart file

### Phase 3: Confidence & Review
- Load ML confidence data
- Confidence-based visual styling
- Jump-to-next-uncertain navigation
- Review tracking

### Phase 4: Polish & Integration
- chart-preview highway integration (synced playback)
- Loop regions for section review
- Playback speed control
- Copy/paste
- Auto-save
- NoteInspector panel for detailed note editing

### Phase 5: Pipeline Integration
- Direct integration with upstream pipeline (receive chart + audio + confidence from CLI)
- Direct output to downstream steps (export finalized chart)
- Batch processing support (queue of songs to review)

---

## 10. Open Questions

1. **Tempo map editing**: Should the editor support editing BPM markers and time signatures, or are those assumed correct from the ML model? Tempo detection is a separate problem. For V1, assume the tempo map is correct and only edit notes.

2. **Multiple difficulties**: The ML model likely only generates Expert. Should the editor support downcharting to Hard/Medium/Easy? This is a separate feature and not needed for V1.

3. **Audio stem mixing**: Should the editor also load the full mix (not just drums) for context? Many transcription tasks are easier when you can hear the full song. Could load both `drums.ogg` and `song.ogg` with separate volume controls.

4. **Real-time ML re-inference**: If the user marks a section as wrong, could we re-run the ML model on just that section with adjusted parameters? This requires the ML model to be available as a service. V2+ feature.

5. **Chart-preview forking**: The chart-preview package is read-only (displays charts, does not edit). To avoid the debounced full-reload, we may want to fork it or contribute an API for incremental note updates. Evaluate after Phase 1 based on how much users rely on the highway preview during editing.
