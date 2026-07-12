'use client';

import {useCallback} from 'react';
import {
  defaultIniChartModifiers,
  parseChartFile,
  writeChartFolder,
} from '@eliwhite/scan-chart';
import {useChartEditorContext} from '../ChartEditorContext';
import type {ChartDocument} from '@/lib/chart-edit';
import {DEFAULT_VOCALS_PART, findTrackInParsedChart} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import type {EditorScope} from '../scope';
import {isTrackScope} from '../scope';
import {chartToElements} from '@/lib/preview/highway/chartToElements';

/**
 * The vocal part name to render markers for. `vocals` is the default and
 * the only part most charts have; multi-part charts pick a different
 * part via the LeftSidebar's part picker, which dispatches
 * `SET_ACTIVE_SCOPE` with the new part.
 */
function activeVocalPartName(scope: EditorScope): string {
  return scope.kind === 'vocals' ? scope.part : DEFAULT_VOCALS_PART;
}

/**
 * Round-trip a ChartDocument through the writer + parser so derived fields
 * (HOPOs, chord flags, section timing, etc.) are recomputed after an edit,
 * and return a new ChartDocument carrying the re-parsed chart. Preserves
 * whichever format (`.chart` or `.mid`) the document already has —
 * writeChartFolder/parseChartFile both handle either symmetrically, so an
 * edit must not silently convert a `.mid`-sourced chart-flow document to
 * `.chart` (it previously did, unconditionally: every edit reset format to
 * 'chart', so the FIRST edit on a MIDI-sourced project would flip its
 * persisted chart file out from under the pipeline/storage layer that
 * wrote notes.mid).
 *
 * Modifiers come from the parsed chart's `iniChartModifiers` when present.
 * Falls back to scan-chart's exported defaults otherwise.
 */
function rebuildChartDocument(doc: ChartDocument): ChartDocument {
  const format = doc.parsedChart.format;
  const files = writeChartFolder({
    parsedChart: doc.parsedChart,
    assets: doc.assets,
  });
  const chartFileName = format === 'chart' ? 'notes.chart' : 'notes.mid';
  const chartFile = files.find(f => f.fileName === chartFileName)!;
  const modifiers =
    doc.parsedChart.iniChartModifiers ?? defaultIniChartModifiers;
  const parsed = parseChartFile(chartFile.data, format, modifiers);
  return {
    parsedChart: {
      ...parsed,
      chartBytes: chartFile.data,
      format,
      iniChartModifiers: modifiers,
    },
    assets: doc.assets,
  };
}

/**
 * Hook that provides a function to execute an EditCommand.
 *
 * All commands use the full rebuild path: command modifies ChartDocument,
 * then writeChart -> parseChartFile -> trackToElements -> reconciler.setElements().
 * The reconciler's internal diffing ensures only changed elements are patched
 * in the Three.js scene.
 */
export function useExecuteCommand() {
  const {state, dispatch, reconcilerRef} = useChartEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = rebuildChartDocument(command.execute(doc));

      // Update the reconciler with new elements (if available).
      // The reconciler diffs internally and only patches what changed.
      const reconciler = reconcilerRef.current;
      if (reconciler) {
        const newTrack = isTrackScope(state.activeScope)
          ? (findTrackInParsedChart(newDoc.parsedChart, state.activeScope.track)
              ?.track ?? null)
          : null;
        // chartToElements tolerates a null track (lyrics-only / global scopes).
        reconciler.setElements(
          chartToElements(
            newDoc.parsedChart,
            newTrack,
            activeVocalPartName(state.activeScope),
          ),
        );
      }

      dispatch({type: 'EXECUTE_COMMAND', command, chartDoc: newDoc});
    },
    [state.chartDoc, state.activeScope, dispatch, reconcilerRef],
  );

  return {executeCommand};
}

/**
 * Hook that provides undo and redo functions.
 *
 * All undo/redo operations use the full rebuild path with the reconciler.
 */
export function useUndoRedo() {
  const {state, dispatch, reconcilerRef} = useChartEditorContext();

  const undo = useCallback(() => {
    if (state.undoStack.length === 0 || state.undoDocStack.length === 0) return;

    // Snapshots in undoDocStack are stored in derived form (rebuilt at
    // EXECUTE_COMMAND time), so we can use them directly without re-parsing.
    const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];

    const reconciler = reconcilerRef.current;
    if (reconciler) {
      const prevTrack = isTrackScope(state.activeScope)
        ? (findTrackInParsedChart(prevDoc.parsedChart, state.activeScope.track)
            ?.track ?? null)
        : null;
      reconciler.setElements(
        chartToElements(
          prevDoc.parsedChart,
          prevTrack,
          activeVocalPartName(state.activeScope),
        ),
      );
    }

    dispatch({type: 'UNDO', chartDoc: prevDoc});
  }, [
    state.undoStack,
    state.undoDocStack,
    state.activeScope,
    reconcilerRef,
    dispatch,
  ]);

  const redo = useCallback(() => {
    if (state.redoStack.length === 0 || state.redoDocStack.length === 0) return;

    const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];

    const reconciler = reconcilerRef.current;
    if (reconciler) {
      const redoTrack = isTrackScope(state.activeScope)
        ? (findTrackInParsedChart(redoDoc.parsedChart, state.activeScope.track)
            ?.track ?? null)
        : null;
      reconciler.setElements(
        chartToElements(
          redoDoc.parsedChart,
          redoTrack,
          activeVocalPartName(state.activeScope),
        ),
      );
    }

    dispatch({type: 'REDO', chartDoc: redoDoc});
  }, [
    state.redoStack,
    state.redoDocStack,
    state.activeScope,
    reconcilerRef,
    dispatch,
  ]);

  return {
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
