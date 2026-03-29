# Plan 0013: Extract Shared Chart Editor to components/chart-editor/

> **Dependencies:** 0012 (chart-io consolidation)
> **Unlocks:** 0014 (drum-edit page), 0015 (layout + timeline)
>
> **Goal:** Move generic editor components out of `app/drum-transcription/` into `components/chart-editor/` so both drum-transcription and a new drum-edit page can share the same editor UI. Use a composable panel architecture — the shared editor provides the core shell (highway, transport, toolbar), and each page composes its own sidebar panels.

## Context

The drum-transcription editor at `app/drum-transcription/` contains ~14 components, 1 context, 3 hooks, and a command system. Some are generic (TransportControls, LoopControls, WaveformDisplay, EditToolbar, undo/redo), while others are domain-specific (ConfidencePanel, ProcessingView, StemVolumeControls for Demucs stems).

We want to reuse the generic editor for a new `/drum-edit` page that loads existing charts (no ML pipeline). This plan extracts the shared parts.

## Architecture

```
components/chart-editor/           # Shared editor UI (NEW)
  ChartEditor.tsx                  # Shell: accepts children for composable panels
  ChartEditorContext.tsx           # Base context: chart, selection, undo/redo, playback, tools
  HighwayEditor.tsx                # 3D highway with editing interactions
  DrumHighwayPreview.tsx           # Three.js renderer wrapper
  TransportControls.tsx            # Play/pause/seek/speed
  EditToolbar.tsx                  # Tool selection, grid snap, undo/redo
  WaveformDisplay.tsx              # Audio waveform canvas
  LoopControls.tsx                 # A-B loop controls
  NoteInspector.tsx                # Selected note properties (drum-specific for now)
  ExportDialog.tsx                 # ZIP/SNG export
  hooks/
    useEditCommands.ts             # Execute commands, undo/redo
    useEditorKeyboard.ts           # Keyboard shortcuts
    useAutoSave.ts                 # Periodic + visibility saves
  commands.ts                      # Command pattern (AddNote, Delete, Move, etc.)

app/drum-transcription/            # Drum transcription page (UPDATED)
  page.tsx                         # Pipeline orchestration (unchanged)
  components/
    EditorApp.tsx                   # Loads from OPFS, composes editor with ML panels
    ProcessingView.tsx              # ML pipeline progress (stays here)
    AudioUploader.tsx               # Audio file upload (stays here)
    ConfidencePanel.tsx             # ML confidence overlay (stays here)
    StemVolumeControls.tsx          # Demucs stem mixing (stays here)
```

## 1. ChartEditor Shell Component

The shell provides the editor layout and accepts composable children for page-specific panels:

```typescript
// components/chart-editor/ChartEditor.tsx
interface ChartEditorProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  chartDoc: ChartDocument;
  audioManager: AudioManager;
  audioData?: Float32Array;         // For waveform display
  audioChannels?: number;
  durationSeconds: number;
  sections?: Section[];             // For section jumping in transport
  leftPanelChildren?: ReactNode;    // Page-specific left sidebar panels
  onSave?: () => Promise<void>;     // Auto-save callback
  saveConfig?: AutoSaveConfig;      // OPFS paths, interval
  children?: ReactNode;             // Additional content
}
```

The shell wraps everything in `ChartEditorProvider` and renders the core layout. Page-specific panels (ConfidencePanel, StemVolumeControls) are passed as `leftPanelChildren`.

## 2. ChartEditorContext — Base Context

Split the current `EditorContext` into a base context with generic editing state:

### State kept in base context (generic):
- `chart`, `chartDoc`, `track` — chart data
- `isPlaying`, `currentTimeMs`, `playbackSpeed` — playback
- `zoom` — view scaling
- `selectedNoteIds`, `activeTool`, `gridDivision` — editing
- `dirty`, `undoStack`, `redoStack`, `undoDocStack`, `redoDocStack`, `savedUndoDepth` — undo/redo
- `clipboard` — copy/paste
- `trackVolumes`, `soloTrack`, `mutedTracks` — audio mixing
- `loopRegion` — A-B loop

### State removed from base (page-specific):
- `confidence`, `showConfidence`, `confidenceThreshold` — ML confidence
- `reviewedNoteIds` — review tracking

### Approach:
The base context handles all generic actions. Drum-transcription wraps it with additional state for confidence/review via a separate `DrumTranscriptionContext` that composes on top.

```typescript
// EditorApp.tsx in drum-transcription
<ChartEditorProvider ...baseProps>
  <DrumTranscriptionProvider confidence={...} reviewProgress={...}>
    <ChartEditor leftPanelChildren={
      <>
        <ConfidencePanel />
        <StemVolumeControls audioManager={audioManager} />
      </>
    } />
  </DrumTranscriptionProvider>
</ChartEditorProvider>
```

## 3. Component Moves

### Move to `components/chart-editor/` (generic):

| Component | Changes Needed |
|-----------|---------------|
| `TransportControls.tsx` | None — already generic. Update imports. |
| `WaveformDisplay.tsx` | None — already generic. Update imports. |
| `LoopControls.tsx` | None — already generic. Update imports. |
| `EditToolbar.tsx` | None significant — tool modes are already defined in context. Update imports. |
| `HighwayEditor.tsx` | Update context import to use base ChartEditorContext. |
| `DrumHighwayPreview.tsx` | Update imports. |
| `NoteInspector.tsx` | Update imports. Stays drum-focused for now (drums-only instrument). |
| `ExportDialog.tsx` | Decouple from OPFS project structure — accept chart/audio data as props instead. |
| `commands.ts` | Move to `components/chart-editor/commands.ts`. |
| `useEditCommands.ts` | Move to `components/chart-editor/hooks/`. |
| `useEditorKeyboard.ts` | Split: generic shortcuts → shared hook. Drum ML shortcuts (N for confidence nav, D/M for stems) → kept in drum-transcription via a callback/extension mechanism. |
| `useAutoSave.ts` | Generalize — accept save function and interval config as parameters instead of hardcoding OPFS paths. |

### Keep in `app/drum-transcription/components/` (domain-specific):

| Component | Reason |
|-----------|--------|
| `EditorApp.tsx` | Loads from OPFS, initializes ML data. Refactored to compose ChartEditor. |
| `ProcessingView.tsx` | ML pipeline progress UI. |
| `AudioUploader.tsx` | Audio upload for ML pipeline. |
| `ConfidencePanel.tsx` | ML confidence scores. Uses DrumTranscriptionContext. |
| `StemVolumeControls.tsx` | Demucs-specific stem names. Passed as leftPanelChildren. |

## 4. useEditorKeyboard Split

The keyboard hook has both generic and domain-specific shortcuts:

**Generic (move to shared):**
- Tool selection: 1-5 (cursor, place, erase, bpm, timesig)
- Grid snap: Shift+1-6, Shift+0
- Editing: Ctrl+Z, Ctrl+Shift+Z, Delete, Ctrl+A, Escape
- Clipboard: Ctrl+C, Ctrl+X, Ctrl+V
- Note flags: Q (cymbal), A (accent), S (ghost) — these are drum-specific but belong with the core editor since NoteInspector is shared
- Save: Ctrl+S

**Domain-specific (keep in drum-transcription, passed as extension):**
- N / Shift+N — jump to next/prev low-confidence note
- D — toggle drums solo
- M — toggle drums mute

**Approach:** The shared hook accepts an optional `additionalShortcuts` map that pages can extend with their own bindings.

## 5. ExportDialog Refactor

Currently reads from OPFS directly. Refactor to accept data as props:

```typescript
interface ExportDialogProps {
  chartDoc: ChartDocument;
  audioManager: AudioManager;
  songName: string;
  artistName?: string;
  // Optional: custom audio sources (for OPFS stems in drum-transcription)
  getAudioSources?: () => Promise<AudioSource[]>;
}
```

Drum-transcription's EditorApp passes a `getAudioSources` that reads stems from OPFS. The drum-edit page passes one that reads from the loaded chart's audio files.

## Execution Order

1. **Create `components/chart-editor/` directory** and the `ChartEditorContext.tsx` base context (extracted from EditorContext, minus confidence/review state).

2. **Move generic components** one at a time: TransportControls → WaveformDisplay → LoopControls → EditToolbar → commands.ts → useEditCommands. Update imports in drum-transcription after each move.

3. **Move HighwayEditor + DrumHighwayPreview**. Update to use base context.

4. **Move NoteInspector + ExportDialog**. Refactor ExportDialog props.

5. **Split useEditorKeyboard** — generic shortcuts to shared, add extension mechanism.

6. **Generalize useAutoSave** — accept config instead of hardcoded paths.

7. **Create ChartEditor shell** component that composes the layout.

8. **Create DrumTranscriptionContext** in drum-transcription for confidence/review state.

9. **Refactor EditorApp** in drum-transcription to use `<ChartEditorProvider>` + `<DrumTranscriptionContext>` + `<ChartEditor leftPanelChildren={...}>`.

10. **Verify** drum-transcription works identically to before.

## Verification

```bash
# All tests pass
yarn test

# No broken imports
yarn lint

# No remaining direct imports of moved files from old paths
grep -r "drum-transcription/components/TransportControls\|drum-transcription/components/WaveformDisplay\|drum-transcription/components/LoopControls\|drum-transcription/components/EditToolbar" app/ --include="*.ts" --include="*.tsx"
# Should return nothing
```

## Browser Testing (chrome-devtools MCP)

Test using the sample chart at `public/All Time Low - SUCKERPUNCH (Hubbubble).sng`. After each step in the execution order, validate in the browser:

1. **After each component move**, navigate to `http://localhost:3000/drum-transcription` and:
   - `take_screenshot` — verify the page still renders correctly
   - `list_console_messages` — check for broken imports, React errors, missing modules
   - If errors appear, fix before moving the next component

2. **After creating ChartEditor shell (step 7)**, load the test chart:
   - Navigate to drum-transcription, start a project with the demo audio or load an existing project
   - `take_screenshot` — verify highway renders, all panels visible
   - `click` play button — verify playback still works
   - `take_screenshot` during playback — notes scrolling
   - `list_console_messages` — no runtime errors

3. **After refactoring EditorApp (step 9)**, do a full editing workflow:
   - `take_screenshot` — verify layout matches pre-refactor
   - Test tool switching: `press_key` 1-5, verify toolbar updates
   - Test note placement: switch to Place tool, `click` on highway
   - Test undo: `press_key` Ctrl+Z
   - Test keyboard shortcuts: `press_key` Space (play/pause), Q (cymbal toggle)
   - `list_console_messages` — verify zero errors throughout
   - `list_network_requests` — verify no failed asset loads

4. **Final regression check**: Compare a screenshot from before the refactor with after. The UI should be visually identical — this plan is a pure refactor with no visual changes.
