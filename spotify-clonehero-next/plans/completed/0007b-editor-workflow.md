# 0007b - Editor Workflow: Confidence, Undo/Redo, Auto-Save, and Stem Controls

> **Dependencies:** 0007a (highway editing)
> **Unlocks:** 0008 (pipeline orchestration)
>
> **Location:** `app/drum-transcription/` inside `~/projects/spotify-clonehero/spotify-clonehero-next/`. Next.js page, yarn, Tailwind, React state/context.
>
> **State management:** React state + context with useReducer. No zustand.

## Overview

This plan adds the workflow features that make the editor productive for correcting ML-generated drum transcriptions: confidence-based visualization to direct attention to likely errors, undo/redo and copy/paste for efficient editing, auto-save to prevent data loss, and stem volume controls so the user can isolate drums or hear the full mix.

These features sit on top of the editing infrastructure from 0007a. The command pattern is already in place; this plan wires it into an undo/redo stack and adds the higher-level workflow.

---

## 1. Confidence Visualization

The ML model assigns a confidence score (0.0-1.0) to each predicted note. This is the editor's key feature for transcription correction -- directing human attention to the notes most likely to be wrong.

### 1.1 Loading Confidence Data

Confidence scores are stored as a JSON sidecar in OPFS alongside the chart data:

```
{project}/chart/confidence.json
```

Format:

```json
{
  "notes": {
    "0:13": 0.95,
    "192:14": 0.87,
    "192:15": 0.42,
    ...
  }
}
```

Keys are note IDs (`tick:noteType`). Values are confidence scores 0-1.

Load this file in the OPFS loading step (0007 section 5). Store in EditorContext:

```typescript
interface EditorState {
  // ... from 0007/0007a
  confidence: Map<string, number>; // noteId -> confidence (0-1)
  showConfidence: boolean; // toggle overlay on/off
  confidenceThreshold: number; // threshold for "low confidence" (default 0.7)
}
```

### 1.2 Visual Treatment on Highway

On the Clone Hero highway, notes are rendered with confidence-dependent styling:

| Confidence         | Visual on Highway                            |
| ------------------ | -------------------------------------------- |
| >= 0.9 (high)      | Standard note appearance, full opacity       |
| 0.7 - 0.9 (medium) | Slight amber tint/glow around the note       |
| 0.5 - 0.7 (low)    | Amber pulsing glow, reduced opacity gem      |
| < 0.5 (very low)   | Red pulsing glow, "?" overlay on the note    |
| Manually added     | Distinct border/glow to indicate human-added |

The visual treatment should be implementable as material changes on the Three.js note meshes. Use `emissive` color properties or overlay sprites.

When `showConfidence` is toggled off, all notes render with standard appearance.

### 1.3 Visual Treatment on SheetMusic

On the SheetMusic notation view, confidence can be shown as note coloring:

- High confidence: standard black notation
- Low confidence: amber or red colored note heads
- The SheetMusic component currently supports `enableColors` for drum type coloring. We can extend this or add a separate overlay mode for confidence coloring

### 1.4 Confidence-Based Navigation

Add navigation shortcuts and toolbar buttons:

| Key       | Action                                                         |
| --------- | -------------------------------------------------------------- |
| `N`       | Jump to next low-confidence note (below `confidenceThreshold`) |
| `Shift+N` | Jump to previous low-confidence note                           |

When jumping, the highway scrolls to center the note and it becomes selected. This lets the user quickly review every uncertain note in sequence.

### 1.5 Confidence Threshold Control

A slider in the toolbar lets the user adjust what counts as "low confidence." Default 0.7. Moving it lower shows fewer flagged notes (only the most uncertain); moving it higher flags more notes for review.

### 1.6 Statistics Panel

A small panel (collapsible, in the toolbar or sidebar) showing:

```
Total notes: 2,847
High confidence (>0.9): 2,412 (84.7%)
Low confidence (<0.7): 187 (6.6%)
Reviewed: 45 / 187
```

Updates in real time as the user edits.

---

## 2. Review Tracking

### 2.1 Concept

When the user interacts with a note -- confirms it is correct, edits it, or deletes it -- mark it as "reviewed." This lets the user track progress through the chart.

### 2.2 State

```typescript
interface EditorState {
  // ... existing
  reviewedNoteIds: Set<string>;
}
```

A note is marked reviewed when:

- The user selects it and presses a "confirm" key (e.g., `Enter`)
- The user edits the note (changes type, flags, or position)
- The user deletes the note

Reviewed notes get a subtle visual indicator:

- On highway: a small checkmark sprite or a green border
- On SheetMusic: not shown (would clutter notation)

### 2.3 Review Progress Persistence

The reviewed set is saved alongside the chart in OPFS:

```
{project}/chart/review-progress.json
```

```json
{
  "reviewed": ["0:13", "192:14", "384:15"]
}
```

Loaded on startup, saved on auto-save.

---

## 3. Undo/Redo

### 3.1 Architecture

React state with useReducer. The command objects from 0007a (`EditCommand` interface) are stored in undo/redo stacks managed by the reducer.

```typescript
interface EditorState {
  // ... existing
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  dirty: boolean;
}
```

### 3.2 Reducer Actions

```typescript
type EditorAction =
  // ... existing actions from 0007
  | {type: 'EXECUTE_COMMAND'; command: EditCommand}
  | {type: 'UNDO'}
  | {type: 'REDO'}
  | {type: 'MARK_SAVED'};
```

**EXECUTE_COMMAND:**

1. Execute the command's `execute()` to produce new chart state
2. Push the command onto `undoStack`
3. Clear `redoStack` (new edit branch)
4. Set `dirty = true`

**UNDO:**

1. Pop the last command from `undoStack`
2. Execute the command's `undo()` to revert chart state
3. Push the command onto `redoStack`
4. Set `dirty = true` (or check if we've returned to the saved state)

**REDO:**

1. Pop the last command from `redoStack`
2. Execute the command's `execute()` to re-apply
3. Push the command onto `undoStack`
4. Set `dirty = true`

**MARK_SAVED:**

1. Set `dirty = false`
2. Optionally record the current undo stack depth so we can detect when we undo back to the saved state

### 3.3 Batch Operations

When the user performs a bulk action (e.g., "delete 20 selected notes"), wrap the individual commands in a `BatchCommand`. The batch counts as a single undo step.

### 3.4 Memory Management

The undo stack stores command objects (diffs), not full state snapshots. This keeps memory usage proportional to edit count, not chart size \* edit count.

Cap the undo stack at a reasonable depth (e.g., 200 entries). When the cap is exceeded, discard the oldest entries.

### 3.5 Keyboard Shortcuts

| Key                          | Action |
| ---------------------------- | ------ |
| `Ctrl+Z` (or `Cmd+Z` on Mac) | Undo   |
| `Ctrl+Shift+Z` or `Ctrl+Y`   | Redo   |

These are already defined in 0007a's shortcut table and are wired here.

---

## 4. Copy/Paste

### 4.1 Copy

When notes are selected and the user presses `Ctrl+C`:

1. Capture the selected notes as an array
2. Normalize their positions: subtract the minimum tick in the selection so the first note starts at tick 0
3. Store in EditorContext as `clipboard: DrumNote[]`

### 4.2 Paste

When the user presses `Ctrl+V`:

1. Take the clipboard notes
2. Add the current cursor tick position (the snapped tick where the playhead or mouse is) to each note's normalized tick
3. Execute an `AddNotesCommand` (batch) for all pasted notes
4. Select the newly pasted notes

### 4.3 Cut

`Ctrl+X`: Copy the selection, then delete it.

### 4.4 State

```typescript
interface EditorState {
  // ... existing
  clipboard: DrumNote[];
}
```

---

## 5. Auto-Save to OPFS

### 5.1 Trigger

Auto-save fires:

- Every 30 seconds while there are unsaved changes (`dirty === true`)
- When the user navigates away from the page (`beforeunload` handler)
- When the page loses focus (tab switch, `visibilitychange` event)

### 5.2 File Format

Save the edited chart to a separate file in OPFS, preserving the original:

```
{project}/chart/notes.chart          -- original ML output (never modified)
{project}/chart/notes.edited.chart   -- editor's working copy
{project}/chart/confidence.json      -- original ML confidence (never modified)
{project}/chart/review-progress.json -- review tracking state
```

The serializer converts the internal `DrumNote[]` representation back to `.chart` text format. This uses the same logic as the chart writer (0002), including:

- Note type to chart note number mapping
- Cymbal flag markers (notes 66, 67, 68)
- Accent/ghost markers
- BPM and time signature output in `[SyncTrack]`

### 5.3 Save Implementation

```typescript
async function autoSave(projectName: string, state: EditorState) {
  const chartText = serializeChart(state.chart);
  const reviewJson = JSON.stringify({
    reviewed: Array.from(state.reviewedNoteIds),
  });

  const root = await navigator.storage.getDirectory();
  const projectDir = await root.getDirectoryHandle(projectName);
  const chartDir = await projectDir.getDirectoryHandle('chart');

  // Save edited chart
  const chartFile = await chartDir.getFileHandle('notes.edited.chart', {
    create: true,
  });
  const chartWritable = await chartFile.createWritable();
  await chartWritable.write(chartText);
  await chartWritable.close();

  // Save review progress
  const reviewFile = await chartDir.getFileHandle('review-progress.json', {
    create: true,
  });
  const reviewWritable = await reviewFile.createWritable();
  await reviewWritable.write(reviewJson);
  await reviewWritable.close();

  dispatch({type: 'MARK_SAVED'});
}
```

### 5.4 Dirty Indicator

Show a visual indicator in the toolbar when there are unsaved changes:

- Small dot or asterisk next to the song title
- Tooltip: "Unsaved changes" or "Last saved: 2 minutes ago"

### 5.5 Manual Save

`Ctrl+S` triggers an immediate save. The dirty indicator clears.

---

## 6. Stem Volume Controls

### 6.1 Concept

The user should be able to hear different audio stems at different volumes during editing. Key use cases:

- **Solo drums**: hear only the drum stem to verify transcription accuracy
- **Full mix**: hear everything to understand the musical context
- **Drums + backing**: hear drums louder with the rest quieter

### 6.2 AudioManager Track Access

`AudioManager` already manages multiple named tracks (`drums`, `song`, etc.) and supports per-track volume control via `setVolume(trackName, volume)`.

### 6.3 UI

A collapsible panel in the toolbar or sidebar with per-track volume sliders:

```
Volume Controls:
  Drums:  [====|=========] 100%   [S] [M]
  Song:   [=====|========]  60%   [S] [M]
  Bass:   [=====|========]  60%   [S] [M]
```

Each track has:

- A volume slider (0-100%)
- A Solo button `[S]`: mutes all other tracks, solos this one
- A Mute button `[M]`: mutes this track

Track names come from the audio files loaded from OPFS. The available tracks depend on what the stem separation step produced.

### 6.4 Keyboard Shortcuts

| Key | Action            |
| --- | ----------------- |
| `D` | Toggle drums solo |
| `M` | Toggle mute drums |

### 6.5 State

```typescript
interface EditorState {
  // ... existing
  trackVolumes: Record<string, number>; // trackName -> volume (0-1)
  soloTrack: string | null; // track name that is currently soloed
  mutedTracks: Set<string>; // tracks that are muted
}
```

Volume changes call `audioManager.setVolume(trackName, effectiveVolume)` where `effectiveVolume` accounts for solo/mute state.

---

## 7. Loop Region for Section Review

### 7.1 Concept

The user can set an A-B loop region to repeatedly review a section. This is critical for transcription correction -- you listen to the same 2-4 bars over and over while fixing notes.

### 7.2 Implementation

Use AudioManager's existing practice mode:

```typescript
audioManager.setPracticeMode({
  startMeasureMs: startMs,
  endMeasureMs: endMs,
  startTimeMs: startMs - 2000, // 2s lead-in
  endTimeMs: endMs,
});
```

AudioManager already handles looping back to the start of the practice region when playback reaches the end.

### 7.3 UI

- On the WaveSurfer minimap, the loop region is shown as a highlighted range
- Keyboard shortcuts to set the loop:
  - `[`: set loop start at current position
  - `]`: set loop end at current position
  - `Ctrl+L`: clear loop region
- Visual markers on the highway showing the loop boundaries

### 7.4 State

```typescript
interface EditorState {
  // ... existing
  loopRegion: {startMs: number; endMs: number} | null;
}
```

---

## 8. EditorContext Final Shape

After all three plans, the complete EditorContext state:

```typescript
interface EditorState {
  // -- Chart data (serializable, editable) --
  chart: ParsedChart | null;
  track: ParsedChart['trackData'][0] | null;

  // -- Playback --
  isPlaying: boolean;
  currentTimeMs: number;
  playbackSpeed: number;

  // -- View --
  zoom: number;
  activeTool: 'cursor' | 'place' | 'erase' | 'bpm' | 'timesig';
  gridDivision: number;
  showConfidence: boolean;
  confidenceThreshold: number;

  // -- Selection --
  selectedNoteIds: Set<string>;

  // -- Editing --
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  clipboard: DrumNote[];
  dirty: boolean;

  // -- ML Metadata --
  confidence: Map<string, number>;

  // -- Review --
  reviewedNoteIds: Set<string>;

  // -- Audio --
  trackVolumes: Record<string, number>;
  soloTrack: string | null;
  mutedTracks: Set<string>;
  loopRegion: {startMs: number; endMs: number} | null;
}
```

All managed via `useReducer` with a comprehensive set of actions. No zustand.

---

## 9. Implementation Steps

1. **Confidence loading and display**: Load `confidence.json` from OPFS. Add confidence-based visual styling to highway notes (material changes in Three.js). Add confidence toggle and threshold slider to toolbar.

2. **Confidence navigation**: Implement jump-to-next/prev low-confidence note. Wire `N` and `Shift+N` shortcuts.

3. **Review tracking**: Mark notes as reviewed on interaction. Save/load review state from OPFS. Add statistics panel.

4. **Undo/redo stack**: Wire the command objects from 0007a into an undo/redo stack in the reducer. Add `Ctrl+Z` / `Ctrl+Shift+Z` shortcuts. Test with add/delete/move operations.

5. **Copy/paste**: Implement clipboard operations. `Ctrl+C`, `Ctrl+V`, `Ctrl+X`.

6. **Auto-save**: Implement the auto-save timer and `beforeunload` handler. Build the chart serializer. Add dirty indicator. Wire `Ctrl+S`.

7. **Stem volume controls**: Build the volume control panel. Wire to `audioManager.setVolume()`. Implement solo/mute logic.

8. **Loop region**: Wire up loop region to AudioManager's practice mode. Add visual markers. Implement `[`/`]` shortcuts.

9. **End-to-end testing**: Load a real ML transcription with confidence data. Walk through the full workflow: view confidence, navigate to low-confidence notes, edit, review, save. Verify SheetMusic and highway stay in sync throughout.

---

## 10. Performance Notes

- **Undo stack memory**: Commands store diffs (the note data that changed), not full state snapshots. A command adding one note stores one note object. A batch delete of 20 notes stores 20 note objects. This is negligible memory.

- **Auto-save serialization**: Chart serialization is string concatenation over the note array. For a 5,000-note chart, this takes <10ms. No need for a worker.

- **Confidence overlay**: The confidence visual is a per-note material property set once on load and updated only when the note changes. No per-frame cost.

- **Volume changes**: `audioManager.setVolume()` adjusts gain nodes directly. Instant, no audio re-decode needed.
