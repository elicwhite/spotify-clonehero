# Plan 0022: Incremental Note Editing (No Full Rebuild)

> **Dependencies:** 0021 (interaction manager)
> **Unlocks:** Independent
>
> **Goal:** When a note is added, deleted, or moved via editor commands, update the Three.js scene incrementally instead of re-parsing the entire chart and rebuilding all note sprites. The highway should remain responsive during edits with no flicker.

## Context

Currently, every edit goes through this flow:
1. Command modifies ChartDocument (immutable clone)
2. `writeChart()` serializes to .chart text
3. `parseChartFile()` re-parses the text via scan-chart
4. `dispatch(EXECUTE_COMMAND)` updates state with new chart + chartDoc
5. DrumHighwayPreview re-renders because `chart` prop changed
6. `setupRenderer()` → `prepTrack()` rebuilds ALL note sprites from scratch

This is expensive (~100-500ms) and causes a visible flicker. With incremental updates, edits should be near-instant.

## Approach: Diff-Based Update

After a command executes, diff the old vs new PreparedNote arrays. Only add/remove/move the changed sprites.

### Step 1: NotesManager Diff API

```typescript
class NotesManager {
  // Existing
  prepare(track, textureManager): void  // full initial setup

  // New: incremental update
  applyDiff(diff: NotesDiff): void

  // New: compute diff between old and new note sets
  static computeDiff(
    oldNotes: PreparedNote[],
    newNotes: PreparedNote[],
  ): NotesDiff
}

interface NotesDiff {
  added: PreparedNote[];     // notes in new but not old
  removed: number[];          // indices in old array to remove
  moved: Array<{             // notes that changed position
    oldIndex: number;
    newNote: PreparedNote;
  }>;
}
```

### Step 2: Efficient Diffing

Notes are identified by `tick:type` composite key. Since notes are sorted by tick, the diff can be computed in O(n) via merge-join:

```typescript
static computeDiff(oldNotes, newNotes): NotesDiff {
  const oldMap = new Map(oldNotes.map((n, i) => [`${n.note.tick}:${n.note.type}`, {note: n, index: i}]));
  const newMap = new Map(newNotes.map((n, i) => [`${n.note.tick}:${n.note.type}`, {note: n, index: i}]));

  const added: PreparedNote[] = [];
  const removed: number[] = [];
  const moved: Array<{oldIndex: number; newNote: PreparedNote}> = [];

  // Find removed and moved
  for (const [key, {note, index}] of oldMap) {
    const newEntry = newMap.get(key);
    if (!newEntry) {
      removed.push(index);
    } else if (newEntry.note.msTime !== note.msTime || newEntry.note.xPosition !== note.xPosition) {
      moved.push({oldIndex: index, newNote: newEntry.note});
    }
  }

  // Find added
  for (const [key, {note}] of newMap) {
    if (!oldMap.has(key)) {
      added.push(note);
    }
  }

  return {added, removed, moved};
}
```

### Step 3: Apply Diff to Scene

```typescript
applyDiff(diff: NotesDiff): void {
  // Remove deleted notes
  for (const index of diff.removed) {
    const group = this.activeNoteGroups.get(index);
    if (group) {
      this.scene.remove(group);
      this.recycleGroup(group);
      this.activeNoteGroups.delete(index);
    }
  }

  // Update moved notes (reposition existing sprites)
  for (const {oldIndex, newNote} of diff.moved) {
    this.preparedNotes[oldIndex] = newNote;
    // Group will be repositioned on next updateDisplayedNotes() call
  }

  // Add new notes
  for (const note of diff.added) {
    this.preparedNotes.push(note);
    // Will be picked up by updateDisplayedNotes() if in visible window
  }

  // Re-sort and rebuild EventSequence
  this.preparedNotes.sort((a, b) => a.msTime - b.msTime);
  this.noteSequence = new EventSequence(this.preparedNotes);
}
```

### Step 4: Integration with Editor Commands

In `useEditCommands.ts`, after a command executes:

```typescript
function useExecuteCommand() {
  return (command: EditCommand) => {
    const oldDoc = state.chartDoc;
    const newDoc = command.execute(oldDoc);

    // Instead of full re-parse, compute note diff
    const oldNotes = getExpertDrumNotes(oldDoc);
    const newNotes = getExpertDrumNotes(newDoc);
    const diff = NotesManager.computeDiff(oldPrepared, newPrepared);

    // Apply diff to the live scene
    notesManager.applyDiff(diff);

    // Update React state (chartDoc only, NOT chart — skip re-parse for rendering)
    dispatch({ type: 'EXECUTE_COMMAND', command, chartDoc: newDoc });
  };
}
```

### Step 5: When Full Rebuild IS Needed

Some operations still require a full rebuild:
- **BPM changes** — all note msTime values change
- **Time signature changes** — affects grid and note positioning
- **Loading a new chart** — obviously
- **Undo/redo to a very different state** — diff might be larger than rebuild

For these, fall back to the existing full rebuild path. The incremental path is for the common case: adding/deleting/moving individual notes.

## Preventing DrumHighwayPreview Remount

Currently the `chart` prop change causes DrumHighwayPreview to destroy and recreate the renderer. For incremental edits, we need to prevent this:

- Don't pass `chart` as a prop that triggers re-render
- Instead, the editor calls `notesManager.applyDiff()` directly via a ref
- DrumHighwayPreview only remounts on truly different charts (initial load, undo to a very different state)

## Execution Order

1. Add `computeDiff()` static method to NotesManager.
2. Add `applyDiff()` method to NotesManager — handles add/remove/move.
3. Add `prepareSingleNote()` to NotesManager for creating PreparedNote from a DrumNote without full track prep.
4. Expose NotesManager instance from the highway module (via ref or callback).
5. Update `useEditCommands.ts` to compute diff and apply incrementally for note add/delete/move/flag-toggle commands.
6. Keep full rebuild path for BPM, time signature, and large changes.
7. Prevent DrumHighwayPreview remount on incremental edits (ref-based updates).
8. Test: add a note → appears instantly, no flicker. Delete → disappears instantly. Move → repositions.

## Verification

```bash
yarn test
yarn lint
```

## Browser Testing (chrome-devtools MCP)

1. Load test chart. Switch to Place tool. Click on highway — note appears instantly, no rebuild flicker.
2. Select a note, press Delete — disappears instantly.
3. Drag a note — repositions smoothly.
4. Toggle cymbal flag (Q) — note texture updates in place.
5. Add BPM marker — full rebuild triggers (expected, this is the fallback).
6. Ctrl+Z undo — reverts correctly.
7. Rapid clicking to add many notes — each appears instantly without lag.
