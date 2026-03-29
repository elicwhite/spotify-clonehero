# Plan 0017: Section Marker Editing

> **Dependencies:** 0015 (timeline minimap — sections displayed there)
> **Unlocks:** Independent
>
> **Goal:** Let users add, rename, and delete named section markers (Intro, Verse, Chorus, etc.). Sections are visible on both the highway and the timeline minimap. This is essential for chart organization and navigation.

## Context

### What sections are:
- Named markers at specific tick positions in the chart (e.g., "intro", "verse 1a", "chorus 2b")
- Stored in `ChartDocument.sections[]` as `{ tick: number; name: string }`
- chart-edit already has `addSection()` and `removeSection()` helpers
- scan-chart already parses sections from .chart files (`[Events]` track, `section` events)
- The timeline minimap (plan 0015) displays them as labels with dots
- TransportControls already supports section jumping (Ctrl+Left/Right arrows skip between sections)

### Moonscraper's section editing:
- Sections appear as text labels on the highway at their tick position
- Users can add sections by placing a "Section" event (similar to placing a BPM marker)
- Sections can be renamed via a text input dialog
- Sections can be deleted like any other chart object
- Sections are visible in the timeline as labeled markers

## 1. Section Markers on Highway

### Visual rendering:
Sections should be visible on the highway as horizontal banners with text labels:

```
     ──────────── "chorus 2a" ────────────   ← Section banner
     ═══════════════════════════════════════   ← Measure line
         ●       ●       ●                    ← Notes
```

- Full-width horizontal banner at the section's tick position
- Semi-transparent background (e.g., yellow/gold at 20% opacity, matching Moonscraper's color)
- Section name as text, left-aligned or centered
- Rendered in the HighwayEditor overlay canvas (above beat lines, below notes)
- Only render sections visible in the current highway viewport (performance)

### Implementation:
Add section rendering to `HighwayEditor.tsx`'s overlay draw loop:

```typescript
function drawSections(
  ctx: CanvasRenderingContext2D,
  sections: Section[],
  tickToScreenY: (tick: number) => number,
  canvasWidth: number,
) {
  for (const section of sections) {
    const y = tickToScreenY(section.tick);
    if (y < -20 || y > canvasHeight + 20) continue; // Off-screen

    // Draw banner
    ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
    ctx.fillRect(0, y - 12, canvasWidth, 24);

    // Draw text
    ctx.fillStyle = 'rgba(255, 200, 0, 0.9)';
    ctx.font = '12px sans-serif';
    ctx.fillText(section.name, 8, y + 4);

    // Draw line
    ctx.strokeStyle = 'rgba(255, 200, 0, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
  }
}
```

## 2. Section Editing Tool

### Approach: New tool mode

Add a "Section" tool to the existing tool modes:

```typescript
type ToolMode = 'cursor' | 'place' | 'erase' | 'bpm' | 'timesig' | 'section';
```

Keyboard shortcut: 6 (in cursor mode) or Ctrl+6 (always).

### Placement:
- In Section tool mode, click on the highway to add a section at the clicked tick (snapped to grid)
- A text input popover appears to name the section (similar to BPM popover)
- Default name: auto-increment based on existing sections (e.g., "section_1", "section_2") or empty with cursor focused for typing
- Press Enter to confirm, Escape to cancel

### Editing existing sections:
- In Cursor mode, clicking on a section banner selects it
- Double-click on a section banner opens the rename popover
- Delete key removes the selected section
- Sections can be dragged to move their tick position (like note dragging)

### Commands:

```typescript
class AddSectionCommand implements EditCommand {
  constructor(
    private tick: number,
    private name: string,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    addSection(newDoc, this.tick, this.name);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.tick);
    return newDoc;
  }

  get description() { return `Add section "${this.name}"`; }
}

class RenameSectionCommand implements EditCommand {
  constructor(
    private tick: number,
    private oldName: string,
    private newName: string,
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const section = newDoc.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.newName;
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    const section = newDoc.sections.find(s => s.tick === this.tick);
    if (section) section.name = this.oldName;
    return newDoc;
  }

  get description() { return `Rename section to "${this.newName}"`; }
}

class DeleteSectionCommand implements EditCommand {
  constructor(
    private tick: number,
    private name: string, // stored for undo
  ) {}

  execute(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    removeSection(newDoc, this.tick);
    return newDoc;
  }

  undo(doc: ChartDocument): ChartDocument {
    const newDoc = cloneDocWithSections(doc);
    addSection(newDoc, this.tick, this.name);
    return newDoc;
  }

  get description() { return `Delete section "${this.name}"`; }
}

class MoveSectionCommand implements EditCommand {
  constructor(
    private oldTick: number,
    private newTick: number,
    private name: string,
  ) {}
  // Move = remove at old tick + add at new tick
}
```

## 3. Section Name Popover

### UI:
When adding or renaming a section, show a small popover near the clicked position:

```
┌──────────────────────────┐
│ Section Name:            │
│ ┌──────────────────────┐ │
│ │ chorus 2a            │ │ ← Text input, auto-focused
│ └──────────────────────┘ │
│ [Cancel]       [Confirm] │
└──────────────────────────┘
```

- Use shadcn/ui Popover + Input components
- Auto-focus the text input on open
- Enter = confirm, Escape = cancel
- Position near the click point on the highway (or near the section banner for rename)

### Common section names (suggestions):
Optional autocomplete/suggestions dropdown:
- intro, verse, pre-chorus, chorus, post-chorus, bridge, solo, outro
- With automatic numbering: verse 1, verse 2, chorus 1a, chorus 1b

## 4. Section Navigation Enhancements

### Existing (from TransportControls):
- Ctrl+Left/Right: Jump to previous/next section (already implemented)

### New with grid cursor (from plan 0016):
- Section jumping also moves the cursor tick to the section's tick

### Timeline interaction (from plan 0015):
- Clicking a section label in the timeline minimap jumps to that section
- Sections are already rendered in the timeline by plan 0015

## 5. Integration with chart-edit

### Existing helpers in chart-edit:
- `addSection(doc, tick, name)` — adds a section event
- `removeSection(doc, tick)` — removes a section at tick

### What may need adding:
- `renameSection(doc, tick, newName)` — or just mutate after clone
- Ensure `writeChart()` serializes sections to `[Events]` track as `"section <name>"` events
- Ensure scan-chart round-trip preserves sections

### Sections in ChartDocument:
```typescript
// Already exists in chart-edit types:
interface ChartDocument {
  sections: Section[];  // { tick: number; name: string }[]
  // ...
}
```

## Execution Order

1. **Add section rendering to HighwayEditor** — draw section banners on the overlay canvas. Read sections from chartDoc.sections.

2. **Add Section tool mode** — new tool in the tool icons grid. Keyboard shortcut 6 / Ctrl+6.

3. **Implement AddSectionCommand** — create section at clicked tick with name from popover.

4. **Build section name popover** — text input with confirm/cancel. Positioned near click point.

5. **Implement section selection** — in Cursor mode, clicking a section banner selects it. Visual highlight on selected section.

6. **Implement DeleteSectionCommand** — Delete key removes selected section.

7. **Implement RenameSectionCommand** — double-click section to rename. Opens popover with current name pre-filled.

8. **Implement MoveSectionCommand** — drag section banner to move tick position.

9. **Update timeline minimap** — sections already shown by plan 0015, but verify they update in real-time as sections are added/removed/renamed.

10. **Verify section serialization** — add section, save, reload, verify section persists in .chart file.

## Verification

```bash
# Tests pass (section command unit tests)
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

Use `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` as the test chart. This chart has existing sections (intro, verse, chorus, etc.) which makes it ideal for testing both display and editing. Load it in `/drum-edit`. Test iteratively after each execution step:

1. **After adding section rendering to highway (step 1)**:
   - Load the test chart
   - `take_screenshot` — verify section banners visible on the highway as semi-transparent yellow/gold horizontal banners with text labels (e.g., "intro", "verse 1a", "chorus 1a")
   - Scroll/navigate through the chart — verify sections appear at correct positions throughout the song
   - `list_console_messages` — no rendering errors

2. **After adding Section tool + AddSectionCommand + popover (steps 2-4)**:
   - Switch to Section tool: `press_key` Ctrl+6 (or click the section tool icon in left sidebar)
   - `take_screenshot` — verify Section tool is highlighted in toolbar
   - `click` on an empty area of the highway (between existing sections)
   - `take_screenshot` — verify section name popover appeared near the click point with a text input
   - `type_text` "bridge 1"
   - `press_key` Enter — confirm
   - `take_screenshot` — verify new "bridge 1" section banner appeared on the highway at the clicked position
   - Check the timeline minimap — verify "bridge 1" label appeared at the corresponding position
   - `list_console_messages` — no errors

3. **After implementing section selection + delete (steps 5-6)**:
   - Switch to Cursor tool: `press_key` Ctrl+1
   - `click` on the "bridge 1" section banner
   - `take_screenshot` — verify the section is visually highlighted (selected state)
   - `press_key` Delete
   - `take_screenshot` — verify the section is removed from highway and timeline
   - `press_key` Ctrl+Z (undo)
   - `take_screenshot` — verify the section is restored

4. **After implementing rename (step 7)**:
   - In Cursor mode, double-click an existing section banner (e.g., "verse 1a")
   - `take_screenshot` — verify rename popover appeared with "verse 1a" pre-filled in the text input
   - Clear the text and `type_text` "verse 1 (edited)"
   - `press_key` Enter
   - `take_screenshot` — verify the section name updated on both highway and timeline
   - `press_key` Ctrl+Z — verify undo restores the original name

5. **After implementing move (step 8)**:
   - In Cursor mode, `click` on a section to select it
   - Drag the section banner to a new position (simulate with mouse events)
   - `take_screenshot` — verify section moved to new tick position
   - Verify timeline minimap updated to reflect the new position
   - `press_key` Ctrl+Z — verify section moved back

6. **After verifying timeline sync (step 9)**:
   - Add a new section via Section tool
   - `take_screenshot` — verify it appears on timeline immediately (no refresh needed)
   - Delete a section — verify it disappears from timeline immediately
   - Rename a section — verify timeline label updates immediately
   - `click` a section label on the timeline minimap — verify playback jumps to that section
   - `press_key` Ctrl+ArrowRight — verify cursor jumps to next section
   - `press_key` Ctrl+ArrowLeft — verify cursor jumps to previous section

7. **After verifying serialization (step 10)**:
   - Add a new section "test section" somewhere in the chart
   - `press_key` Ctrl+S (save)
   - Export the chart via ExportDialog
   - Reload the exported chart in `/drum-edit`
   - `take_screenshot` — verify "test section" persists in the reloaded chart
   - Also verify all original sections from the SNG file are preserved

8. **Full workflow test**:
   - Load `All Time Low - SUCKERPUNCH (Hubbubble).sng` fresh
   - `take_screenshot` — verify all original sections visible on highway and timeline
   - Add 2 sections, rename 1 existing section, delete 1 existing section
   - Navigate between sections with Ctrl+arrows
   - Undo all changes (Ctrl+Z multiple times) — verify original state restored
   - `list_console_messages` — zero errors throughout
