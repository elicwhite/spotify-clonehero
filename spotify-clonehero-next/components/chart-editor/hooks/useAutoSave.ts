'use client';

import {useCallback, useEffect, useRef} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';

/** Default auto-save interval in milliseconds. */
const DEFAULT_INTERVAL_MS = 30_000;

/** Configuration for auto-save behavior. */
export interface AutoSaveConfig {
  /** Interval between auto-save attempts in milliseconds. Defaults to 30s. */
  intervalMs?: number;
}

/**
 * Auto-saves the chart periodically and on page visibility changes / unload.
 *
 * The actual save logic is provided by the caller via the `saveFn` callback,
 * keeping this hook independent of any specific storage backend (OPFS, etc.).
 *
 * @param saveFn - The function to call when saving. Should persist the chart
 *                 and any other page-specific data. Must return a Promise.
 *                 Pass `null` to disable auto-save.
 * @param config - Optional configuration for auto-save behavior.
 * @returns A `save` function for manual triggering (Ctrl+S).
 */
export function useAutoSave(
  saveFn: (() => Promise<void>) | null,
  config?: AutoSaveConfig,
) {
  const {state, dispatch} = useChartEditorContext();
  const savingRef = useRef(false);
  const lastSaveRef = useRef<number>(0);
  const intervalMs = config?.intervalMs ?? DEFAULT_INTERVAL_MS;

  const save = useCallback(async () => {
    if (!saveFn || !state.chartDoc || savingRef.current) return;
    if (!state.dirty && lastSaveRef.current > 0) return;

    savingRef.current = true;
    try {
      await saveFn();
      lastSaveRef.current = Date.now();
      dispatch({type: 'MARK_SAVED'});
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, [saveFn, state.chartDoc, state.dirty, dispatch]);

  // Periodic auto-save timer
  useEffect(() => {
    if (!saveFn) return;

    const interval = setInterval(() => {
      if (state.dirty) {
        save();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [saveFn, state.dirty, save, intervalMs]);

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
        // Synchronous save attempt via sendBeacon is not available for OPFS.
        // Best effort: start the async save. The page may close before it completes
        // but the periodic auto-save should have already covered most changes.
        save();
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [saveFn, state.dirty, state.chartDoc, save]);

  return {
    save,
    lastSaveTime: lastSaveRef.current,
  };
}
