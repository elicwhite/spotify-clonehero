'use client';

import {useCallback} from 'react';
import {parseChartFile} from '@eliwhite/scan-chart';
import {useEditorContext} from '../contexts/EditorContext';
import {writeChart} from '@/lib/chart-edit';
import type {ChartDocument} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';

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

/**
 * Hook that provides a function to execute an EditCommand.
 *
 * It applies the command to the current ChartDocument, re-parses the
 * result via chartDocumentToParsedChart, and dispatches EXECUTE_COMMAND
 * to update both the document and the parsed chart in one reducer step.
 */
export function useExecuteCommand() {
  const {state, dispatch} = useEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = command.execute(doc);
      const newChart = chartDocumentToParsedChart(newDoc);

      dispatch({
        type: 'EXECUTE_COMMAND',
        command,
        chart: newChart,
        chartDoc: newDoc,
      });
    },
    [state.chartDoc, dispatch],
  );

  return executeCommand;
}

/**
 * Hook that provides undo and redo functions.
 *
 * Undo pops the last command from the undo stack and restores the
 * previous chart document. Redo re-applies the last undone command.
 */
export function useUndoRedo() {
  const {state, dispatch} = useEditorContext();

  const undo = useCallback(() => {
    if (state.undoStack.length === 0 || state.undoDocStack.length === 0) return;

    // The previous doc is stored in undoDocStack
    const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];
    const prevChart = chartDocumentToParsedChart(prevDoc);

    dispatch({
      type: 'UNDO',
      chart: prevChart,
      chartDoc: prevDoc,
    });
  }, [state.undoStack, state.undoDocStack, dispatch]);

  const redo = useCallback(() => {
    if (state.redoStack.length === 0 || state.redoDocStack.length === 0) return;

    // The redo doc is stored in redoDocStack
    const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];
    const redoChart = chartDocumentToParsedChart(redoDoc);

    dispatch({
      type: 'REDO',
      chart: redoChart,
      chartDoc: redoDoc,
    });
  }, [state.redoStack, state.redoDocStack, dispatch]);

  return {
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
