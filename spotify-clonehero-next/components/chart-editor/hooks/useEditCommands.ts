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
 * Undo/redo replay the `ChartDocument` snapshots carried on the
 * `undoEntries`/`redoEntries` steps pushed at EXECUTE_COMMAND time — no
 * re-parsing. As with `useExecuteCommand`, the reconciler push is
 * subscription-driven (`useChartElements` reacts to the dispatched doc), so
 * these only dispatch.
 */
export function useUndoRedo() {
  const {state, dispatch} = useChartEditorContext();

  const undo = useCallback(() => {
    // An entry's `doc` is the PRE-command ChartDocument: the reducer stores
    // the doc that was current *before* that command applied. Undo reinstalls
    // the top one directly, no re-parsing.
    const entry = state.undoEntries[state.undoEntries.length - 1];
    if (!entry) return;
    dispatch({type: 'UNDO', chartDoc: entry.doc});
  }, [state.undoEntries, dispatch]);

  const redo = useCallback(() => {
    const entry = state.redoEntries[state.redoEntries.length - 1];
    if (!entry) return;
    dispatch({type: 'REDO', chartDoc: entry.doc});
  }, [state.redoEntries, dispatch]);

  return {
    undo,
    redo,
    canUndo: state.undoEntries.length > 0,
    canRedo: state.redoEntries.length > 0,
  };
}
