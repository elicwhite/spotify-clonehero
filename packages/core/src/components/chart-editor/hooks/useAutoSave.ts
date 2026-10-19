'use client';

import {useCallback, useEffect, useRef} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';

/**
 * Saves the chart as soon as an edit lands, and again on tab hide / unload.
 *
 * There is no interval and no debounce: an edit is a discrete command, so the
 * document goes dirty once per edit rather than once per animation frame, and
 * writing immediately is what lets the editor have no unsaved state to warn
 * about. Concurrent saves are coalesced rather than queued: a save that lands
 * while one is in flight is picked up by the effect re-running once the first
 * finishes, so a burst of edits collapses into at most one follow-up write.
 *
 * The actual save logic is provided by the caller via the `saveFn` callback,
 * keeping this hook independent of any specific storage backend (OPFS, etc.).
 *
 * @param saveFn - The function to call when saving. Should persist the chart
 *                 and any other page-specific data. Must return a Promise.
 *                 Pass `null` to disable saving.
 * @returns A `save` function for manual triggering (Ctrl+S).
 */
export function useAutoSave(saveFn: (() => Promise<void>) | null) {
  const {state, dispatch} = useChartEditorContext();
  const savingRef = useRef(false);

  const save = useCallback(async () => {
    if (!saveFn || !state.chartDoc || savingRef.current) return;
    if (!state.dirty) return;

    savingRef.current = true;
    try {
      await saveFn();
      dispatch({type: 'MARK_SAVED'});
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, [saveFn, state.chartDoc, state.dirty, dispatch]);

  // Save the moment the document goes dirty. `savingRef` inside `save` makes
  // a re-entrant call a no-op, and this effect re-runs when that save clears
  // `dirty`, so edits made mid-save are written by the next pass.
  useEffect(() => {
    if (!saveFn || !state.dirty) return;
    void save();
  }, [saveFn, state.dirty, save]);

  // Save on visibility change (tab switch)
  useEffect(() => {
    if (!saveFn) return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && state.dirty) {
        save();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [saveFn, state.dirty, save]);

  // Save on beforeunload
  useEffect(() => {
    if (!saveFn) return;

    function handleBeforeUnload() {
      if (state.dirty && state.chartDoc) {
        // A synchronous save is not available for OPFS, so this is best
        // effort. It rarely has anything to do: an edit is written as it
        // lands, so the only window this covers is a close during the one
        // write already in flight.
        save();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveFn, state.dirty, state.chartDoc, save]);

  return {save};
}
