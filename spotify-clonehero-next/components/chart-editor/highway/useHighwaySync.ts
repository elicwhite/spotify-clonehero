'use client';

/**
 * Pushes editor-side state into one highway of the shared stage each time
 * relevant slices change.
 *
 * Each effect has the same shape: read the highway handle, read some React
 * state, call one of `handle.setX(...)`. Co-locating them keeps the lane
 * component focused on UI, and makes it obvious which pieces of state the
 * renderer actually consumes.
 *
 * Everything here is per highway. The chart-wide pushes — the karaoke lyrics
 * overlay and the tempo map — belong to the stage and live in `useStageSync`.
 *
 * One-way data flow: editor state → renderer. The renderer never reads
 * back; it just consumes the most recent push.
 */

import {useEffect, type RefObject} from 'react';
import type {StageHighwayHandle} from '@/lib/preview/highway';
import type {ChartDocument} from '@/lib/chart-edit';
import type {HighwayMode} from '@/lib/preview/highway';
import type {ToolMode} from '@/lib/chart-editor-core';

export interface HighwaySyncInputs {
  stageHandleRef: RefObject<StageHighwayHandle | null>;
  /**
   * Bumped whenever this highway's handle is created or torn down. Drives
   * "first push after mount" — every effect lists this so a freshly mounted
   * highway gets seeded with the current state.
   */
  stageHighwayVersion: number;

  // Document
  chartDoc: ChartDocument | null;
  durationSeconds: number | undefined;

  // Audio waveform
  audioData: Float32Array | undefined;
  audioChannels: number;

  // Highway mode (classic/waveform)
  highwayMode: HighwayMode;

  // Overlay state (cursor, hover, tool, loop, playing)
  cursorTick: number;
  isPlaying: boolean;
  activeTool: ToolMode;
  hoverLane: number | null;
  hoverTick: number | null;
  loopRegion: {startMs: number; endMs: number} | null;
}

/**
 * One umbrella hook that owns every sync-to-renderer effect. Pure side
 * effects — no return value.
 */
export function useHighwaySync(inputs: HighwaySyncInputs): void {
  const {
    stageHandleRef,
    stageHighwayVersion,
    chartDoc,
    durationSeconds,
    audioData,
    audioChannels,
    highwayMode,
    cursorTick,
    isPlaying,
    activeTool,
    hoverLane,
    hoverTick,
    loopRegion,
  } = inputs;

  // -----------------------------------------------------------------------
  // Waveform highway texture
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = stageHandleRef.current;
    if (!handle || !audioData || !durationSeconds) return;
    handle.setWaveformData({
      audioData,
      channels: audioChannels,
      durationMs: durationSeconds * 1000,
    });
  }, [
    stageHandleRef,
    stageHighwayVersion,
    audioData,
    audioChannels,
    durationSeconds,
  ]);

  // -----------------------------------------------------------------------
  // Grid (beats + bars)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = stageHandleRef.current;
    if (!handle || !chartDoc || !durationSeconds) return;
    const tempos = chartDoc.parsedChart.tempos.map(t => ({
      tick: t.tick,
      beatsPerMinute: t.beatsPerMinute,
    }));
    const timeSignatures = chartDoc.parsedChart.timeSignatures.map(ts => ({
      tick: ts.tick,
      numerator: ts.numerator,
      denominator: ts.denominator,
    }));
    handle.setGridData({
      tempos,
      timeSignatures,
      resolution: chartDoc.parsedChart.resolution,
      durationMs: durationSeconds * 1000,
    });
  }, [stageHandleRef, stageHighwayVersion, chartDoc, durationSeconds]);

  // -----------------------------------------------------------------------
  // Highway mode (classic vs waveform)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = stageHandleRef.current;
    if (!handle) return;
    handle.setHighwayMode(highwayMode);
  }, [stageHandleRef, stageHighwayVersion, highwayMode]);

  // -----------------------------------------------------------------------
  // Overlay state (cursor, tool, hover, loop, playing). Selection visuals are
  // pushed through SceneReconciler.setSelectedKeys (see useChartElements) so
  // notes share the same dispatch path as the marker entities.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = stageHandleRef.current;
    if (handle) {
      handle.setOverlayState({
        cursorTick: hoverTick ?? cursorTick,
        isPlaying,
        activeTool,
        hoverLane,
        hoverTick,
        loopRegion,
      });
    }
  }, [
    stageHandleRef,
    stageHighwayVersion,
    cursorTick,
    isPlaying,
    activeTool,
    hoverLane,
    hoverTick,
    loopRegion,
  ]);
}
