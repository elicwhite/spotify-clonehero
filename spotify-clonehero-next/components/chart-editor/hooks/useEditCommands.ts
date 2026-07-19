'use client';

import {useCallback} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';
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
 * Hook that provides a function to execute an EditCommand.
 *
 * Commands are pure in-memory clone+mutate (`command.execute(doc)`) — per
 * plan 0061's push model, every `lib/chart-edit` mutator computes its own
 * derived timing (msTime/msLength, tempo remap, etc.) at mutation time, so
 * there is no write→parse round trip here. The resulting `ChartDocument`'s
 * `parsedChart.chartBytes` is stale after the first edit — it reflects the
 * bytes as originally loaded, not the current in-memory state — and is
 * only ever read by `readChart`'s load-time `iniChartModifiers` override
 * reparse, not by anything on this edit path.
 *
 * trackToElements -> reconciler.setElements() still runs on every command;
 * the reconciler's internal diffing ensures only changed elements are
 * patched in the Three.js scene.
 */
export function useExecuteCommand() {
  const {state, dispatch, reconcilerRef} = useChartEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = command.execute(doc);

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
 * Undo/redo replay the `ChartDocument` snapshots pushed onto
 * undoDocStack/redoDocStack at EXECUTE_COMMAND time and push the result
 * straight to the reconciler — no re-parsing.
 */
export function useUndoRedo() {
  const {state, dispatch, reconcilerRef} = useChartEditorContext();

  const undo = useCallback(() => {
    if (state.undoStack.length === 0 || state.undoDocStack.length === 0) return;

    // Snapshots in undoDocStack are the PRE-command ChartDocuments: the
    // reducer pushes the doc that was current *before* each command applied
    // (EXECUTE_COMMAND stores `prevDoc`). Undo restores the top one directly,
    // no re-parsing.
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
