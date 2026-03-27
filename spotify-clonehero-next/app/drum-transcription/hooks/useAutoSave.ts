'use client';

import {useCallback, useEffect, useRef} from 'react';
import {useEditorContext} from '../contexts/EditorContext';
import {writeChart} from '@/lib/chart-edit';

/** Auto-save interval in milliseconds. */
const AUTO_SAVE_INTERVAL_MS = 30_000;

/**
 * Auto-saves the chart and review progress to OPFS periodically
 * and on page visibility changes / unload.
 *
 * Saves:
 * - `notes.edited.chart` - the edited chart in .chart format
 * - `review-progress.json` - reviewed note IDs
 *
 * @param projectId - The OPFS project directory name.
 * @returns A `save` function for manual triggering (Ctrl+S).
 */
export function useAutoSave(projectId: string | null) {
  const {state, dispatch} = useEditorContext();
  const savingRef = useRef(false);
  const lastSaveRef = useRef<number>(0);

  const save = useCallback(async () => {
    if (!projectId || !state.chartDoc || savingRef.current) return;
    if (!state.dirty && lastSaveRef.current > 0) return;

    savingRef.current = true;
    try {
      const root = await navigator.storage.getDirectory();
      const nsDir = await root.getDirectoryHandle('drum-transcription');
      const projectDir = await nsDir.getDirectoryHandle(projectId);

      // Save edited chart
      const files = writeChart(state.chartDoc);
      const chartText = new TextDecoder().decode(files.find(f => f.fileName === 'notes.chart')!.data);
      const chartFile = await projectDir.getFileHandle(
        'notes.edited.chart',
        {create: true},
      );
      const chartWritable = await chartFile.createWritable();
      await chartWritable.write(chartText);
      await chartWritable.close();

      // Save review progress
      const reviewJson = JSON.stringify({
        reviewed: Array.from(state.reviewedNoteIds),
      });
      const reviewFile = await projectDir.getFileHandle(
        'review-progress.json',
        {create: true},
      );
      const reviewWritable = await reviewFile.createWritable();
      await reviewWritable.write(reviewJson);
      await reviewWritable.close();

      lastSaveRef.current = Date.now();
      dispatch({type: 'MARK_SAVED'});
    } catch (err) {
      console.error('Auto-save failed:', err);
    } finally {
      savingRef.current = false;
    }
  }, [projectId, state.chartDoc, state.dirty, state.reviewedNoteIds, dispatch]);

  // Periodic auto-save timer
  useEffect(() => {
    if (!projectId) return;

    const interval = setInterval(() => {
      if (state.dirty) {
        save();
      }
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [projectId, state.dirty, save]);

  // Save on visibility change (tab switch)
  useEffect(() => {
    if (!projectId) return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden' && state.dirty) {
        save();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [projectId, state.dirty, save]);

  // Save on beforeunload
  useEffect(() => {
    if (!projectId) return;

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
  }, [projectId, state.dirty, state.chartDoc, save]);

  return {
    save,
    lastSaveTime: lastSaveRef.current,
  };
}
