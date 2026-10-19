'use client';

import {useEffect} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';
import type {AudioManager} from '@/lib/preview/audioManager';

/**
 * Pushes the editor's `loopRegion` state onto the audio engine, which does
 * the wrapping from its own rAF tick.
 *
 * State is the single source of truth: whoever moves the markers (the A/B
 * buttons, the piano roll's draggable flags, the Mod+L clear) only has to
 * dispatch `SET_LOOP_REGION`, and playback follows on the next commit —
 * including mid-playback edits. `ChartEditor` is the one caller, so the
 * region reaches the engine on every editor surface.
 */
export function useLoopRegionSync(audioManager: AudioManager | null): void {
  const {state} = useChartEditorContext();
  const startMs = state.loopRegion?.startMs ?? null;
  const endMs = state.loopRegion?.endMs ?? null;

  // Depend on the bounds rather than the object: installing a region tells
  // the engine the loop is back in charge of the playhead, so re-pushing an
  // unchanged region would drag back a user who had seeked past its end.
  useEffect(() => {
    if (!audioManager) return;
    audioManager.setLoopRegion(
      startMs === null || endMs === null ? null : {startMs, endMs},
    );
    return () => {
      // Don't leave the engine wrapping playback for a region nothing is
      // showing any more.
      audioManager.setLoopRegion(null);
    };
  }, [audioManager, startMs, endMs]);
}
