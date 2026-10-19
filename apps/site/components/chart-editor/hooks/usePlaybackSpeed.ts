'use client';

import {useCallback} from 'react';
import {useChartEditorContext} from '../ChartEditorContext';
import type {AudioManager} from '@/lib/preview/audioManager';

/** Playback-rate presets, in the order the stepper and the `[` / `]`
 *  hotkeys walk them. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

/** The preset nearest `speed`. Never -1: a speed set from outside the preset
 *  list still lands on a rung, so stepping from it stays possible. */
function nearestPresetIndex(speed: number): number {
  let best = 0;
  for (let i = 1; i < SPEED_PRESETS.length; i++) {
    if (
      Math.abs(SPEED_PRESETS[i] - speed) < Math.abs(SPEED_PRESETS[best] - speed)
    ) {
      best = i;
    }
  }
  return best;
}

export interface PlaybackSpeed {
  /** The editor-wide playback rate, 1 = normal. */
  speed: number;
  /** Sets an exact rate on the audio engine and the reducer together. */
  setSpeed: (next: number) => void;
  /** Moves `delta` rungs along the presets, clamped at both ends. */
  step: (delta: number) => void;
  canSlower: boolean;
  canFaster: boolean;
}

/**
 * The editor's one playback-speed control surface: the preset ladder, the
 * guards, and the two-step write (audio engine + reducer) that every setter
 * has to perform. The sidebar's stepper and the transport's `[` / `]`
 * hotkeys both go through here, so they cannot drift apart.
 */
export function usePlaybackSpeed(audioManager: AudioManager): PlaybackSpeed {
  const {state, dispatch} = useChartEditorContext();
  const speed = state.playbackSpeed;

  const setSpeed = useCallback(
    (next: number) => {
      audioManager.setTempo(next);
      dispatch({type: 'SET_PLAYBACK_SPEED', speed: next});
    },
    [audioManager, dispatch],
  );

  const index = nearestPresetIndex(speed);

  const step = useCallback(
    (delta: number) => {
      const nextIdx = Math.max(
        0,
        Math.min(SPEED_PRESETS.length - 1, nearestPresetIndex(speed) + delta),
      );
      setSpeed(SPEED_PRESETS[nextIdx]);
    },
    [speed, setSpeed],
  );

  return {
    speed,
    setSpeed,
    step,
    canSlower: index > 0,
    canFaster: index < SPEED_PRESETS.length - 1,
  };
}
