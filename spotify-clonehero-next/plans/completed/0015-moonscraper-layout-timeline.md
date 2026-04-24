# Plan 0015: Moonscraper-Inspired Layout + Timeline Minimap

> **Dependencies:** 0013 (shared editor extraction)
> **Unlocks:** 0017 (section editing — sections appear on timeline)
>
> **Goal:** Restructure the editor layout to match Moonscraper's arrangement: left sidebar (settings + tool icons), center highway, right sidebar (timeline minimap with sections and position), bottom transport bar. Add the timeline minimap component.

## Context

Moonscraper's layout (from screenshot analysis):

- **Left sidebar**: Settings panel (Step grid value, Clap toggle, Hyperspeed, Speed multiplier, Highway Length) + Tools grid (cursor, eraser, note, starpower, BPM, time signature icons)
- **Center**: 3D highway filling most of the screen, with the strikeline near the bottom
- **Right sidebar**: Timeline minimap — a vertical bar representing the entire song. Shows section labels (intro a, verse 1a, chorus 1b, etc.) with dot indicators, a draggable position handle, percentage display, and current timestamp
- **Bottom area**: Transport controls (play button overlaid on highway in Moonscraper, but we'll use a proper bottom bar)

Our editor currently uses a horizontal toolbar at top + overlaid panels on the left. This plan rearranges to the Moonscraper layout and builds the timeline minimap.

## 1. Layout Shell

### New layout structure in ChartEditor.tsx:

```
┌──────────┬──────────────────────────────┬──────────┐
│ Left     │                              │ Timeline │
│ Sidebar  │         Highway              │ Minimap  │
│          │         (3D, fills space)     │          │
│ Settings │                              │ Sections │
│ ──────── │                              │ labels   │
│ Tools    │                              │ with     │
│ ──────── │                              │ dots     │
│ Note     │                              │          │
│ Inspector│                              │ Position │
│ ──────── │                              │ handle   │
│ [page    │                              │          │
│  panels] │                              │ % + time │
├──────────┴──────────────────────────────┴──────────┤
│  ◀◀  ▶  ▶▶  ──●────── 1:23 / 4:56    [speed] ... │
└───────────────────────────────────────────────────-┘
```

### CSS Layout:

- Full viewport height (`h-screen`)
- CSS Grid: `grid-template-columns: auto 1fr auto`
- Left sidebar: fixed width (~200px), scrollable if content overflows
- Center: flex-grow, contains highway canvas
- Right sidebar: fixed width (~120px), contains timeline
- Bottom: fixed height transport bar

### Left Sidebar Contents (top to bottom):

1. **Settings panel** — collapsible
   - Grid step display + controls (shows "Step: 1/16" etc.)
   - Speed display + slider (shows "Speed: x1.00")
   - Highway length slider (controls zoom/how much of the chart is visible)
2. **Tool icons** — grid layout matching Moonscraper's icon arrangement
   - Cursor (arrow icon)
   - Eraser (eraser icon)
   - Note/Place (pencil icon)
   - BPM (metronome icon)
   - Time Signature (4/4 icon)
   - Compact grid of icon buttons with active state highlight
3. **Note Inspector** — shown when notes are selected
4. **Page-specific panels** — composable slot (`leftPanelChildren`)
   - drum-transcription: ConfidencePanel, StemVolumeControls
   - drum-edit: StemVolumeControls (if multi-stem)

### Keyboard shortcut hints:

Tool icons and settings show keyboard shortcuts as tooltips (e.g., "Place (3)" for the note tool).

## 2. Timeline Minimap Component

### `components/chart-editor/TimelineMinimap.tsx`

A vertical bar on the right side showing the entire song at a glance.

### Visual design:

```
┌────────────┐
│   00:09.16  │  ← Current time
│     4%      │  ← Position as percentage
│             │
│  outro    ○ │  ← Section labels with dots
│             │
│  chorus 3 ○ │
│             │
│  verse 3  ○ │
│             │
│  chorus 2 ○ │
│ ▬▬▬▬▬▬▬▬▬▬ │  ← Position handle (draggable)
│  verse 2  ○ │
│             │
│  chorus 1 ○ │
│             │
│  verse 1  ○ │
│             │
│  intro    ○ │
└────────────┘
```

### Features:

**Position handle:**

- Draggable vertical indicator showing current playback/scroll position
- Position = `(currentTimeMs / totalDurationMs) * timelineHeight`
- Dragging seeks the AudioManager to the corresponding time
- Click anywhere on the timeline to jump to that position
- Handle styled as a horizontal bar (like Moonscraper's gold indicator)

**Section markers:**

- Read sections from `chartDoc.sections[]` (each has `tick` and `name`)
- Convert tick to Y position: `tickToMs(section.tick) / totalDurationMs * timelineHeight`
- Display section name as right-aligned text with a small dot/circle indicator
- Yellow/gold color for section markers (matching Moonscraper)
- Clicking a section label jumps to that section

**Time and percentage display:**

- Show current time in `mm:ss.cc` format (like Moonscraper's `00:09.16`)
- Show position as percentage of total song
- Update every animation frame (read from `audioManager.currentTime`)

### Implementation:

```typescript
interface TimelineMinimapProps {
  audioManager: AudioManager;
  durationMs: number;
  sections: Array<{tick: number; name: string; timeMs: number}>;
  className?: string;
}
```

Rendering approach:

- Canvas-based for performance (many section markers, smooth handle dragging)
- Or HTML/CSS if section count is manageable (< 50 sections typical) — simpler, accessible
- **Recommendation: HTML/CSS** with `position: absolute` for markers. Sections are sparse (10-30 per song), so DOM performance is fine. Easier to style, add hover effects, handle click events.

### Interaction:

- **Click on timeline body**: Seek to that position (`e.clientY → percentage → timeMs → audioManager.seek()`)
- **Drag handle**: Continuous seeking while dragging (pause playback, seek on each mousemove, resume on mouseup if was playing)
- **Click on section label**: Jump to that section's time
- **Scroll wheel on timeline**: No effect (scroll only affects highway)

## 3. Settings Panel Refactor

Currently, speed and grid controls are in `EditToolbar` (horizontal). Move them to the left sidebar with a vertical layout:

### Grid Step Control:

- Display: "Step: 1/16" (or current grid division)
- Controls: Up/Down buttons to cycle through divisions, or a dropdown
- Same values: 1/4, 1/8, 1/12, 1/16, 1/32, 1/64, Free
- Keyboard: Shift+1-6, Shift+0 (unchanged)

### Speed Control:

- Display: "Speed: x1.00"
- Controls: Slider or preset buttons
- Same range: 0.25x to 2.0x (or 4.0x)
- Compact layout for sidebar

### Highway Length:

- New control — adjusts how many milliseconds of the chart are visible on the highway
- Maps to the renderer's `HIGHWAY_DURATION_MS` value
- Slider from ~500ms (zoomed in, few notes visible) to ~5000ms (zoomed out, many notes)
- This replaces the current `zoom` state with a more intuitive "highway length" concept

## 4. Tool Icons Grid

Replace the current horizontal text buttons with a compact icon grid:

```
┌──────────────┐
│ Tools        │
│ [↖] [✏] [🎵]│   Row 1: Cursor, Eraser, Place
│ [♩] [4/4]   │   Row 2: BPM, Time Signature
└──────────────┘
```

- Use lucide-react icons or custom SVG icons
- Active tool highlighted with a distinct background color
- Tooltip with name + keyboard shortcut on hover
- Same keyboard shortcuts: 1=Cursor, 2=Place, 3=Erase, 4=BPM, 5=TimeSig

## 5. Transport Bar (Bottom)

Move TransportControls to a full-width bottom bar:

- Fixed height (~48px)
- Contains: play/pause, skip back/forward, seek bar, time display, speed indicator
- Speed controls moved to left sidebar, but a compact speed display remains in transport
- Loop indicator shown when loop is active
- Waveform optionally shown behind the seek bar (compact mode)

## Execution Order

1. **Create the CSS Grid layout shell** in ChartEditor.tsx — three-column + bottom row.

2. **Build TimelineMinimap component** — position handle, time display, percentage. No sections yet (just the vertical bar with position tracking).

3. **Add section markers to timeline** — read from chartDoc.sections, render with labels and dots.

4. **Refactor left sidebar** — move settings (grid, speed) from toolbar to sidebar panel.

5. **Create tool icon grid** — replace text buttons with icon grid in left sidebar.

6. **Add highway length control** — new slider that adjusts visible highway duration.

7. **Move NoteInspector to left sidebar** — below tools, shown when notes selected.

8. **Reposition TransportControls** as bottom bar.

9. **Update drum-transcription's EditorApp** — pass ConfidencePanel + StemVolumeControls as leftPanelChildren (appear below NoteInspector in left sidebar).

10. **Update drum-edit's page** — verify layout works without ML panels.

## Verification

```bash
# Tests pass
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` as the test chart. This chart has sections, BPM changes, and enough notes to validate all layout and timeline features. Test iteratively after each execution step:

1. **After creating the CSS Grid layout (step 1)**:
   - Load the test chart in `/drum-edit` (or `/drum-transcription` with a project)
   - `take_screenshot` — verify three-column layout: left sidebar, center highway, right sidebar placeholder, bottom transport
   - `resize_page` to 1920x1080, then 1280x720 — verify layout adapts, highway fills available space, sidebars stay fixed width
   - `list_console_messages` — no layout/rendering errors

2. **After building TimelineMinimap (step 2)**:
   - `take_screenshot` — verify timeline appears on right with position handle, time display, percentage
   - `click` on the timeline at various Y positions — verify AudioManager seeks to correct song position
   - `take_screenshot` after clicking — verify position handle moved, time display updated
   - Drag the position handle up and down — verify continuous seeking
   - `click` play, wait 2 seconds, `take_screenshot` — verify handle tracks playback position in real-time

3. **After adding section markers to timeline (step 3)**:
   - `take_screenshot` — verify section labels (intro, verse, chorus, etc.) appear on the right sidebar with dot indicators at correct vertical positions
   - `click` a section label — verify playback jumps to that section's time
   - `take_screenshot` — handle is at the section position, highway shows notes near that section

4. **After refactoring left sidebar (step 4-5)**:
   - `take_screenshot` — verify left sidebar shows: Settings panel (step grid, speed, highway length) + tool icon grid
   - `press_key` 1 through 5 — verify tool icons highlight correctly in the grid
   - Change grid step via the sidebar control — verify it updates

5. **After adding highway length control (step 6)**:
   - Adjust the highway length slider to minimum — `take_screenshot` — verify few notes visible (zoomed in)
   - Adjust to maximum — `take_screenshot` — verify many notes visible (zoomed out)
   - Verify note rendering is correct at both extremes

6. **After moving NoteInspector + transport (steps 7-8)**:
   - Switch to Cursor tool, `click` a note on the highway — `take_screenshot` — verify NoteInspector appears in left sidebar with note details
   - Verify transport bar at bottom: play/pause, seek slider, time display, speed
   - `click` play — verify playback works from bottom bar
   - `press_key` Space — verify play/pause toggles

7. **After composing drum-transcription panels (step 9)**:
   - Navigate to `/drum-transcription`, open a project
   - `take_screenshot` — verify left sidebar has: settings, tools, note inspector, confidence panel, stem volume controls (composable panels working)
   - Verify ConfidencePanel shows ML confidence stats
   - Verify StemVolumeControls shows stems (drums, bass, etc.)

8. **After verifying drum-edit (step 10)**:
   - Navigate to `/drum-edit`, load `All Time Low - SUCKERPUNCH (Hubbubble).sng`
   - `take_screenshot` — verify same Moonscraper-inspired layout but WITHOUT confidence/stem panels in left sidebar
   - Full editing workflow: place a note, delete it, undo, play/pause, seek via timeline
   - `list_console_messages` — zero errors

9. **Final layout comparison with Moonscraper reference**:
   - `take_screenshot` at 1920x1080 with the test chart loaded
   - Visually compare against the Moonscraper screenshot: left sidebar with settings + tools, center highway, right timeline with sections, bottom transport
   - Verify the layout is faithful to Moonscraper's arrangement while using our higher-quality highway assets
