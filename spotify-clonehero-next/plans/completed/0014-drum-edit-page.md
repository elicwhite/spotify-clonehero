# Plan 0014: Create /drum-edit Page with Chart Loading

> **Dependencies:** 0013 (extract shared editor)
> **Unlocks:** 0015 (layout + timeline), independently usable
>
> **Goal:** New page at `/drum-edit` that lets users load an existing chart (SNG, ZIP, or folder) and edit it using the shared chart editor. No ML pipeline — just load, edit, export. Extract the chart picker component from add-lyrics for reuse.

## Context

The add-lyrics page (`app/add-lyrics/`) already has `ChartDropZone` — a component that handles drag-and-drop, file browser, and folder picker for loading charts in SNG/ZIP/folder formats. It produces a `LoadedFiles` object with `FileEntry[]`, `sourceFormat`, and `originalName`.

The shared chart editor from plan 0013 provides the editing UI. This plan connects the two: chart loading → shared editor.

## 1. Extract ChartDropZone to components/

### Move from add-lyrics:

```
components/chart-picker/              # NEW shared location
  ChartDropZone.tsx                   # Drag-drop + file browser + folder picker
  chart-file-readers.ts               # readSngFile, readZipFile, readChartDirectory, detectFormat
```

### Changes to ChartDropZone:

- Add `id` prop for File System Access API persistence (currently hardcoded `'add-lyrics-chart'`)
- Add optional `className` prop for layout flexibility
- Keep all format support: SNG, ZIP, folder, auto-detect drag-and-drop

### Changes to chart-file-readers.ts:

- Currently at `lib/lyrics-align/chart-file-readers.ts`
- Move to `components/chart-picker/chart-file-readers.ts` (co-located with UI)
- No functional changes — `readSngFile`, `readZipFile`, `readChartDirectory`, `detectFormat` all stay the same

### Update add-lyrics:

- Update imports in `app/add-lyrics/page.tsx` and `app/add-lyrics/ChartDropZone.tsx` to point to new location
- Delete old `app/add-lyrics/ChartDropZone.tsx`, import from `components/chart-picker/`

## 2. drum-edit Page

### Route: `/drum-edit`

```
app/drum-edit/
  page.tsx                            # Entry point: load → edit
```

### Page Flow:

```
1. LOAD STATE
   ┌─────────────────────────────────┐
   │  Load a Chart                    │
   │                                  │
   │  [ChartDropZone]                │
   │  Drop .sng, .zip, or pick folder │
   │                                  │
   │  ── or ──                       │
   │                                  │
   │  Recent Projects (from OPFS)     │
   │  • Song Name A    [Open] [Delete]│
   │  • Song Name B    [Open] [Delete]│
   └─────────────────────────────────┘

2. EDIT STATE
   ┌─────────────────────────────────┐
   │  [ChartEditor shell from 0013]  │
   │  Highway + Transport + Toolbar  │
   │                                  │
   │  Left panel:                    │
   │    NoteInspector                │
   │                                  │
   │  (No ConfidencePanel,           │
   │   no StemVolumeControls)        │
   └─────────────────────────────────┘
```

### Loading Logic:

```typescript
async function loadChart(files: LoadedFiles): Promise<LoadedChart> {
  // 1. Find chart file (.chart or .mid) from files.files
  // 2. Parse with scan-chart → ParsedChart
  // 3. Build ChartDocument via chart-edit readChart()
  // 4. Find audio files (song.ogg, guitar.ogg, drums.ogg, etc.)
  // 5. Decode audio via Web Audio API → create AudioManager
  // 6. Return { chartDoc, chart, audioManager, metadata, ... }
}
```

This logic already exists in `app/add-lyrics/page.tsx` (`loadChartFromFiles`). Extract the chart-loading portion to a shared utility:

```typescript
// components/chart-picker/loadChartFromFiles.ts
export async function loadChartFromFiles(
  files: LoadedFiles,
  audioContext: AudioContext,
): Promise<{
  chartDoc: ChartDocument;
  chart: ParsedChart;
  metadata: ChartResponseEncore;
  audioManager: AudioManager;
  durationSeconds: number;
  rawFiles: FileEntry[];
  sourceFormat: SourceFormat;
  originalName: string;
}>;
```

### OPFS Storage for drum-edit:

Namespace under `drum-edit/` in OPFS (separate from `drum-transcription/`):

- `drum-edit/{project-name}/notes.chart` — current chart state
- `drum-edit/{project-name}/notes.edited.chart` — user edits
- `drum-edit/{project-name}/audio/` — loaded audio files
- `drum-edit/{project-name}/metadata.json` — source format, original name

### Auto-save:

Use the shared `useAutoSave` hook from plan 0013 with drum-edit-specific config:

- Save `notes.edited.chart` to OPFS
- No confidence or review progress to save
- Same 30s interval + visibility change triggers

## 3. Audio Handling

Charts can contain multiple audio stems (song.ogg, guitar.ogg, drums.ogg, bass.ogg, etc.). The AudioManager already supports multi-track loading.

For drum-edit:

- Load all audio files from the chart package
- Create AudioManager with available stems
- Show stem volume controls if multiple stems exist (reuse StemVolumeControls with generic stem names)
- If only one audio file (song.ogg), no stem controls needed

## 4. Export from drum-edit

Use the shared ExportDialog from plan 0013:

- Export in the same format as the input (SNG → SNG, ZIP → ZIP)
- Preserve all original files (audio, album art, etc.)
- Replace only the chart file with edited version
- Support "Save As" to change format

## Execution Order

1. **Extract ChartDropZone** from add-lyrics to `components/chart-picker/`. Update add-lyrics imports.

2. **Extract chart-file-readers.ts** to `components/chart-picker/`. Update imports.

3. **Extract loadChartFromFiles** utility from add-lyrics page.

4. **Create `app/drum-edit/page.tsx`** with load state (ChartDropZone + project list).

5. **Implement chart loading** — parse chart, decode audio, create AudioManager.

6. **Wire up shared ChartEditor** — pass loaded chart/audio to the shared editor shell.

7. **Add OPFS persistence** — save/load projects, auto-save.

8. **Test** — load SNG, ZIP, and folder charts. Edit notes. Export. Verify round-trip.

## Verification

```bash
# Tests pass
yarn test

# Lint passes
yarn lint

# No broken imports
grep -r "add-lyrics/ChartDropZone" app/ --include="*.ts" --include="*.tsx"
# Should return nothing (all imports point to components/chart-picker/)
```

## Browser Testing (chrome-devtools MCP)

Use the sample chart `public/All Time Low - SUCKERPUNCH (Hubbubble).sng` as the primary test chart throughout. After each execution step, validate in the browser:

1. **After extracting ChartDropZone (steps 1-2)**, verify add-lyrics still works:
   - `navigate_page` to `http://localhost:3000/add-lyrics`
   - `take_screenshot` — verify the drop zone UI renders correctly
   - `list_console_messages` — no broken imports

2. **After creating drum-edit page (step 4)**, verify the load UI:
   - `navigate_page` to `http://localhost:3000/drum-edit`
   - `take_screenshot` — verify ChartDropZone renders with drag-drop area, file browser, folder picker
   - `list_console_messages` — no errors

3. **After implementing chart loading (step 5)**, load the test chart:
   - Navigate to `/drum-edit`
   - Use `evaluate_script` to fetch and load the sample SNG:
     ```js
     fetch('/All Time Low - SUCKERPUNCH (Hubbubble).sng')
       .then(r => r.blob())
       .then(b => {
         /* trigger file load with this blob */
       });
     ```
   - Or use the file upload UI to load the .sng file
   - `take_screenshot` — verify chart is parsed successfully, loading indicator works
   - `list_console_messages` — no parse errors, no audio decode errors

4. **After wiring up the editor (step 6)**, do a full editing test:
   - Load the test SNG, enter the editor
   - `take_screenshot` — verify highway renders with notes from the chart, transport controls visible
   - `click` play button — verify audio plays and notes scroll
   - `take_screenshot` during playback — highway is animating
   - Switch to Place tool, `click` on highway to add a note
   - `press_key` Ctrl+Z to undo
   - `list_console_messages` — zero errors throughout
   - `list_network_requests` — verify audio files decoded, no 404s

5. **After adding OPFS persistence (step 7)**, test save/reload:
   - Make an edit, wait for auto-save (or press Ctrl+S)
   - `navigate_page` back to `/drum-edit` load screen
   - Verify the project appears in "Recent Projects" list
   - `click` to reopen it — verify edits are preserved
   - `take_screenshot` — notes match the edited state

6. **Regression check on other pages**:
   - `navigate_page` to `/drum-transcription` — verify existing ML pipeline flow still works
   - `navigate_page` to `/add-lyrics` — verify chart loading still works with extracted ChartDropZone
   - `take_screenshot` each — no visual regressions
