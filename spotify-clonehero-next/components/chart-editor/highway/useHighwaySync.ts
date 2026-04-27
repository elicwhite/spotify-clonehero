'use client';

/**
 * Pushes editor-side state into the Three.js renderer/scene each time
 * relevant slices change.
 *
 * This collects what used to be five separate `useEffect` blocks in
 * `HighwayEditor.tsx`, all of which had the same shape: read a renderer
 * handle, read some React state, call one of `handle.setX(...)`. Co-locating
 * them keeps the editor component focused on UI, and makes it obvious which
 * pieces of state the renderer actually consumes.
 *
 * One-way data flow: editor state → renderer. The renderer never reads
 * back; it just consumes the most recent push.
 */

import {useEffect, type RefObject} from 'react';
import type {HighwayRendererHandle} from '../DrumHighwayPreview';
import type {NoteRenderer} from '@/lib/preview/highway/NoteRenderer';
import type {ChartDocument} from '@/lib/chart-edit';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {HighwayMode} from '@/lib/preview/highway';
import type {ToolMode} from '../ChartEditorContext';

export interface HighwaySyncInputs {
  rendererHandleRef: RefObject<HighwayRendererHandle | null>;
  noteRendererRef: RefObject<NoteRenderer | null>;
  /**
   * Bumped whenever the renderer handle is created or replaced. Drives
   * "first push after mount" — every effect lists this so the renderer
   * gets seeded with the current state on a fresh mount.
   */
  rendererVersion: number;

  // Document + timing
  chartDoc: ChartDocument | null;
  durationSeconds: number | undefined;
  timedTempos: TimedTempo[];
  resolution: number;

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

  // Note overlays (selection, confidence, reviewed-state)
  noteSelection: Set<string>;
  confidence?: Map<string, number>;
  showConfidence: boolean;
  confidenceThreshold: number;
  reviewedNoteIds?: Set<string>;
}

/**
 * One umbrella hook that owns every sync-to-renderer effect. Pure side
 * effects — no return value.
 */
export function useHighwaySync(inputs: HighwaySyncInputs): void {
  const {
    rendererHandleRef,
    noteRendererRef,
    rendererVersion,
    chartDoc,
    durationSeconds,
    timedTempos,
    resolution,
    audioData,
    audioChannels,
    highwayMode,
    cursorTick,
    isPlaying,
    activeTool,
    hoverLane,
    hoverTick,
    loopRegion,
    noteSelection,
    confidence,
    showConfidence,
    confidenceThreshold,
    reviewedNoteIds,
  } = inputs;

  // -----------------------------------------------------------------------
  // Waveform highway texture
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || !audioData || !durationSeconds) return;
    handle.setWaveformData({
      audioData,
      channels: audioChannels,
      durationMs: durationSeconds * 1000,
    });
  }, [
    rendererHandleRef,
    rendererVersion,
    audioData,
    audioChannels,
    durationSeconds,
  ]);

  // -----------------------------------------------------------------------
  // Grid (beats + bars)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
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
  }, [rendererHandleRef, rendererVersion, chartDoc, durationSeconds]);

  // -----------------------------------------------------------------------
  // Highway mode (classic vs waveform)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle) return;
    handle.setHighwayMode(highwayMode);
  }, [rendererHandleRef, rendererVersion, highwayMode]);

  // -----------------------------------------------------------------------
  // Timing data (tempos + resolution)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || timedTempos.length === 0) return;
    handle.setTimingData(timedTempos, resolution);
  }, [rendererHandleRef, rendererVersion, timedTempos, resolution]);

  // -----------------------------------------------------------------------
  // Overlay state (cursor, tool, hover, loop, playing) + note overlays
  // (selection, confidence, reviewed-state)
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
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

    const nr = noteRendererRef.current;
    if (nr) {
      nr.setSelectedNoteIds(noteSelection);
      nr.setConfidenceData(
        confidence ?? null,
        showConfidence,
        confidenceThreshold,
      );
      nr.setReviewedNoteIds(reviewedNoteIds ?? null);
    }
  }, [
    rendererHandleRef,
    rendererVersion,
    noteRendererRef,
    cursorTick,
    isPlaying,
    activeTool,
    hoverLane,
    hoverTick,
    loopRegion,
    noteSelection,
    confidence,
    showConfidence,
    confidenceThreshold,
    reviewedNoteIds,
  ]);
}
