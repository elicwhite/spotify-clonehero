'use client';

import {useCallback} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';
import type {EditCommand} from '../commands';

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
 * Element derivation is subscription-driven: `useChartElements` re-derives
 * `ChartElement[]` from `state.chartDoc` (via `selectRenderDoc`) in its own
 * effect and pushes to the reconciler whenever that doc reference changes.
 * This hook only needs to dispatch the new doc — it does not push to the
 * reconciler itself.
 */
export function useExecuteCommand() {
  const {state, dispatch} = useChartEditorContext();

  const executeCommand = useCallback(
    (command: EditCommand) => {
      const doc = state.chartDoc;
      if (!doc) return;

      const newDoc = command.execute(doc);
      dispatch({type: 'EXECUTE_COMMAND', command, chartDoc: newDoc});
    },
    [state.chartDoc, dispatch],
  );

  return {executeCommand};
}

/**
 * Hook that provides undo and redo functions.
 *
 * Undo/redo replay the `ChartDocument` snapshots pushed onto
 * undoDocStack/redoDocStack at EXECUTE_COMMAND time — no re-parsing.
 * As with `useExecuteCommand`, the reconciler push is subscription-driven
 * (`useChartElements` reacts to the dispatched doc), so these only dispatch.
 */
export function useUndoRedo() {
  const {state, dispatch} = useChartEditorContext();

  const undo = useCallback(() => {
    if (state.undoStack.length === 0 || state.undoDocStack.length === 0) return;

    // Snapshots in undoDocStack are the PRE-command ChartDocuments: the
    // reducer pushes the doc that was current *before* each command applied
    // (EXECUTE_COMMAND stores `prevDoc`). Undo restores the top one directly,
    // no re-parsing.
    const prevDoc = state.undoDocStack[state.undoDocStack.length - 1];
    dispatch({type: 'UNDO', chartDoc: prevDoc});
  }, [state.undoStack, state.undoDocStack, dispatch]);

  const redo = useCallback(() => {
    if (state.redoStack.length === 0 || state.redoDocStack.length === 0) return;

    const redoDoc = state.redoDocStack[state.redoDocStack.length - 1];
    dispatch({type: 'REDO', chartDoc: redoDoc});
  }, [state.redoStack, state.redoDocStack, dispatch]);

  return {
    undo,
    redo,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}
