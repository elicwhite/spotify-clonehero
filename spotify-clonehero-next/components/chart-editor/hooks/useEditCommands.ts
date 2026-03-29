'use client';

import {useCallback} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import {useChartEditorContext} from '../ChartEditorContext';
import {writeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import {getDrumNotes} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import {
  AddNoteCommand,
  DeleteNotesCommand,
  MoveNotesCommand,
  ToggleFlagCommand,
  AddSectionCommand,
  DeleteSectionCommand,
  RenameSectionCommand,
  MoveSectionCommand,
  AddBPMCommand,
  AddTimeSignatureCommand,
  BatchCommand,
} from '../commands';
import {noteTypes, noteFlags, type NoteType} from '@eliwhite/scan-chart';
import {NotesManager, type PreparedNote, PAD_TO_HIGHWAY_LANE, calculateNoteXOffset} from '@/lib/preview/highway';
import {buildTimedTempos, tickToMs} from '@/lib/drum-transcription/timing';
import {interpretDrumNote} from '@/lib/drum-mapping/noteToInstrument';
import type {Note} from '@/lib/preview/highway/types';

/** Default modifiers for pro drums chart parsing. */
const PRO_DRUMS_MODIFIERS = {
  song_length: 0,
  hopo_frequency: 0,
  eighthnote_hopo: false,
  multiplier_note: 0,
  sustain_cutoff_threshold: -1,
  chord_snap_threshold: 0,
  five_lane_drums: false,
  pro_drums: true,
} as const;

/** Convert a ChartDocument to a ParsedChart via serialize -> parse round-trip. */
function chartDocumentToParsedChart(doc: ChartDocument) {
  const files = writeChart(doc);
  const chartFile = files.find(f => f.fileName === 'notes.chart')!;
  return parseChartFile(chartFile.data, 'chart', PRO_DRUMS_MODIFIERS);
}

// ---------------------------------------------------------------------------
// Command type checking for incremental vs full rebuild
// ---------------------------------------------------------------------------

/** Commands that can be applied incrementally (no full rebuild needed). */
function isIncrementalCommand(cmd: EditCommand): boolean {
  if (
    cmd instanceof AddNoteCommand ||
    cmd instanceof DeleteNotesCommand ||
    cmd instanceof MoveNotesCommand ||
    cmd instanceof AddSectionCommand ||
    cmd instanceof DeleteSectionCommand ||
    cmd instanceof RenameSectionCommand ||
    cmd instanceof MoveSectionCommand
  ) {
    return true;
  }
  if (cmd instanceof BatchCommand) {
    // A batch is incremental only if ALL sub-commands are incremental
    return cmd.getCommands().every(isIncrementalCommand);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Prepare notes from ChartDocument for diffing
// ---------------------------------------------------------------------------

/**
 * Convert a ChartDocument's expert drum notes into PreparedNote[] for diffing.
 *
 * This avoids the expensive writeChart() -> parseChartFile() round-trip by
 * computing msTime directly from the tempo map and interpreting note types
 * using the same logic as NotesManager.prepare().
 */
function prepareNotesFromDoc(doc: ChartDocument): PreparedNote[] {
  const track = doc.trackData.find(
    t => t.instrument === 'drums' && t.difficulty === 'expert',
  );
  if (!track) return [];

  const notes = getDrumNotes(track);
  const timedTempos = buildTimedTempos(doc.tempos, doc.chartTicksPerBeat);
  const resolution = doc.chartTicksPerBeat;
  const instrument = 'drums' as const;

  const prepared: PreparedNote[] = [];

  for (const note of notes) {
    const msTime = tickToMs(note.tick, timedTempos, resolution);

    // Build a scan-chart-compatible note flags number from the DrumNote flags
    let flags = 0;
    if (note.flags.cymbal) flags |= noteFlags.cymbal;
    if (note.flags.accent) flags |= noteFlags.accent;
    if (note.flags.ghost) flags |= noteFlags.ghost;
    if (note.flags.doubleKick) flags |= noteFlags.doubleKick;
    if (note.flags.flam) flags |= noteFlags.flam;

    // Map DrumNoteType to scan-chart noteType number
    // Skip fiveGreenDrum (5-lane only, no noteTypes equivalent)
    const noteType: NoteType | undefined = noteTypes[note.type as keyof typeof noteTypes] as NoteType | undefined;
    if (noteType === undefined) continue;

    // Build a minimal Note-like object for texture lookup and diffing
    const scanNote: Note = {
      msTime,
      msLength: 0,
      type: noteType,
      flags,
      tick: note.tick,
    } as Note;

    const interpreted = interpretDrumNote({type: noteType, flags});

    if (interpreted.isKick) {
      prepared.push({
        note: scanNote,
        msTime,
        msLength: 0,
        xPosition: 0,
        inStarPower: false,
        isKick: true,
        isOpen: false,
        lane: -1,
      });
    } else {
      const lane = PAD_TO_HIGHWAY_LANE[interpreted.pad] ?? -1;
      if (lane !== -1) {
        prepared.push({
          note: scanNote,
          msTime,
          msLength: 0,
          xPosition: calculateNoteXOffset(instrument, lane),
          inStarPower: false,
          isKick: false,
          isOpen: false,
          lane,
        });
      }
    }
  }

  // Sort by time
  prepared.sort((a, b) => a.msTime - b.msTime);
  return prepared;
}

/**
 * Hook that provides a function to execute an EditCommand.
 *
 * For incremental commands (note add/delete/move/flag toggle, sections),
 * it applies the diff directly to the NotesManager without rebuilding
 * the entire Three.js scene. For BPM/TS changes, it falls back to a
 * full re-parse and rebuild.
 */
export function useExecuteCommand() {
  const {state, dispatch, notesManagerRef} = useChartEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = command.execute(doc);

      // Determine if we can apply incrementally
      const nm = notesManagerRef.current;
      if (nm && isIncrementalCommand(command)) {
        // Build PreparedNote array for the new state
        const newPrepared = prepareNotesFromDoc(newDoc);

        // Diff based on actual renderer notes for accurate index mapping
        const rendererNotes = nm.getPreparedNotes();
        const rendererDiff = NotesManager.computeDiff(
          rendererNotes as PreparedNote[],
          newPrepared,
        );
        const hasDiff = rendererDiff.added.length > 0 || rendererDiff.removed.length > 0 || rendererDiff.moved.length > 0;
        if (hasDiff) {
          nm.applyDiff(rendererDiff);
        }

        // Update React state without changing `chart` prop (no remount)
        dispatch({
          type: 'EXECUTE_COMMAND_INCREMENTAL',
          command,
          chartDoc: newDoc,
        });
        return;
      }

      // Full rebuild path (BPM/TS changes, flag toggles, or no NotesManager)
      const newChart = chartDocumentToParsedChart(newDoc);

      dispatch({
        type: 'EXECUTE_COMMAND',
        command,
        chart: newChart,
        chartDoc: newDoc,
      });
    },
    [state.chartDoc, dispatch, notesManagerRef],
  );

  return {executeCommand};
}

/**
 * Hook that provides undo and redo functions.
 *
 * For incremental commands, undo/redo apply diffs directly to the
 * NotesManager. For full-rebuild commands (BPM/TS), they fall back
 * to a full re-parse.
 */
export function useUndoRedo() {
  const {state, dispatch, notesManagerRef} = useChartEditorContext();

  const undo = useCallback(() => {
    if (state.undoStack.length === 0 || state.undoDocStack.length === 0) return;

    const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];
    const command = state.undoStack[state.undoStack.length - 1];

    const nm = notesManagerRef.current;
    if (nm && isIncrementalCommand(command)) {
      // Apply diff incrementally
      const prevPrepared = prepareNotesFromDoc(prevDoc);

      const rendererNotes = nm.getPreparedNotes();
      const rendererDiff = NotesManager.computeDiff(
        rendererNotes as PreparedNote[],
        prevPrepared,
      );
      const hasDiff = rendererDiff.added.length > 0 || rendererDiff.removed.length > 0 || rendererDiff.moved.length > 0;
      if (hasDiff) {
        nm.applyDiff(rendererDiff);
      }

      dispatch({
        type: 'UNDO_INCREMENTAL',
        chartDoc: prevDoc,
      });
      return;
    }

    // Full rebuild path
    const prevChart = chartDocumentToParsedChart(prevDoc);

    dispatch({
      type: 'UNDO',
      chart: prevChart,
      chartDoc: prevDoc,
    });
  }, [state.undoStack, state.undoDocStack, notesManagerRef, dispatch]);

  const redo = useCallback(() => {
    if (state.redoStack.length === 0 || state.redoDocStack.length === 0) return;

    const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];
    const command = state.redoStack[state.redoStack.length - 1];

    const nm = notesManagerRef.current;
    if (nm && isIncrementalCommand(command)) {
      // Apply diff incrementally
      const redoPrepared = prepareNotesFromDoc(redoDoc);

      const rendererNotes = nm.getPreparedNotes();
      const rendererDiff = NotesManager.computeDiff(
        rendererNotes as PreparedNote[],
        redoPrepared,
      );
      const hasDiff = rendererDiff.added.length > 0 || rendererDiff.removed.length > 0 || rendererDiff.moved.length > 0;
      if (hasDiff) {
        nm.applyDiff(rendererDiff);
      }

      dispatch({
        type: 'REDO_INCREMENTAL',
        chartDoc: redoDoc,
      });
      return;
    }

    // Full rebuild path
    const redoChart = chartDocumentToParsedChart(redoDoc);

    dispatch({
      type: 'REDO',
      chart: redoChart,
      chartDoc: redoDoc,
    });
  }, [state.redoStack, state.redoDocStack, notesManagerRef, dispatch]);

  return {
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
