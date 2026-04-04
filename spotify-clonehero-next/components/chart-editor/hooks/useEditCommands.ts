'use client';

import {useCallback} from 'react';
import {parseChartFile, writeChartFolder} from '@eliwhite/scan-chart';
import {useChartEditorContext} from '../ChartEditorContext';
import type {ChartDocument} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import {chartToElements} from '@/lib/preview/highway/chartToElements';

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

/**
 * Round-trip a ChartDocument through the writer + parser so derived fields
 * (HOPOs, chord flags, section timing, etc.) are recomputed after an edit.
 * The editor only writes `.chart` right now, so we look for `notes.chart` in
 * the serialized output.
 */
function chartDocumentToParsedChart(doc: ChartDocument) {
  const files = writeChartFolder({
    parsedChart: {...doc.parsedChart, format: 'chart'},
    assets: doc.assets,
  });
  const chartFile = files.find(f => f.fileName === 'notes.chart')!;
  return parseChartFile(chartFile.data, 'chart', PRO_DRUMS_MODIFIERS);
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

      const newDoc = command.execute(doc);
      const newChart = chartDocumentToParsedChart(newDoc);

      // Update the reconciler with new elements (if available).
      // The reconciler diffs internally and only patches what changed.
      const reconciler = reconcilerRef.current;
      if (reconciler) {
        const newTrack = newChart.trackData.find(
          t => t.instrument === 'drums' && t.difficulty === 'expert',
        );
        if (newTrack) {
          reconciler.setElements(chartToElements(newChart, newTrack));
        }
      }

      dispatch({
        type: 'EXECUTE_COMMAND',
        command,
        chart: newChart,
        chartDoc: newDoc,
      });
    },
    [state.chartDoc, dispatch, reconcilerRef],
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

    const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];
    const prevChart = chartDocumentToParsedChart(prevDoc);

    // Update the reconciler with the previous state's elements
    const reconciler = reconcilerRef.current;
    if (reconciler) {
      const prevTrack = prevChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (prevTrack) {
        reconciler.setElements(chartToElements(prevChart, prevTrack));
      }
    }

    dispatch({
      type: 'UNDO',
      chart: prevChart,
      chartDoc: prevDoc,
    });
  }, [state.undoStack, state.undoDocStack, reconcilerRef, dispatch]);

  const redo = useCallback(() => {
    if (state.redoStack.length === 0 || state.redoDocStack.length === 0) return;

    const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];
    const redoChart = chartDocumentToParsedChart(redoDoc);

    // Update the reconciler with the redo state's elements
    const reconciler = reconcilerRef.current;
    if (reconciler) {
      const redoTrack = redoChart.trackData.find(
        t => t.instrument === 'drums' && t.difficulty === 'expert',
      );
      if (redoTrack) {
        reconciler.setElements(chartToElements(redoChart, redoTrack));
      }
    }

    dispatch({
      type: 'REDO',
      chart: redoChart,
      chartDoc: redoDoc,
    });
  }, [state.redoStack, state.redoDocStack, reconcilerRef, dispatch]);

  return {
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
