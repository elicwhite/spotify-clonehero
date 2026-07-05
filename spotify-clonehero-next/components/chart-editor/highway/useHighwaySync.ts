'use client';

/**
 * Pushes editor-side state into the Three.js renderer/scene each time
 * relevant slices change.
 *
 * Each effect has the same shape: read a renderer handle, read some React
 * state, call one of `handle.setX(...)`. Co-locating them keeps the editor
 * component focused on UI, and makes it obvious which pieces of state the
 * renderer actually consumes.
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
  /** Active vocal part — drives which `vocalTracks.parts[part]` powers the karaoke overlay. */
  partName: string;

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

  // Note overlays (reviewed-state). Selection visuals are dispatched through
  // the reconciler's hook channels — see useChartElements.
  reviewedNoteIds?: Set<string> | undefined;
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
    partName,
    audioData,
    audioChannels,
    highwayMode,
    cursorTick,
    isPlaying,
    activeTool,
    hoverLane,
    hoverTick,
    loopRegion,
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
  // Karaoke lyrics overlay — re-push on every chartDoc change so the
  // overlay tracks lyric/phrase edits (drag, rename, add, remove).
  // The handle lazy-creates the overlay if the original chart had no
  // lyrics but the user has now added some.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const handle = rendererHandleRef.current;
    if (!handle || !chartDoc) return;
    const vocals = chartDoc.parsedChart.vocalTracks?.parts?.[partName];
    const lyrics = vocals?.notePhrases.flatMap(p => p.lyrics) ?? [];
    const phrases =
      vocals?.notePhrases.map(p => ({
        msTime: p.msTime,
        msLength: p.msLength,
      })) ?? [];
    handle.setLyricsData(lyrics, phrases);
  }, [rendererHandleRef, rendererVersion, chartDoc, partName]);

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

    // Selection visuals are pushed through SceneReconciler.setSelectedKeys
    // (see useChartElements) so notes share the same dispatch path as the
    // marker entities. NoteRenderer keeps the review overlay on per-frame
    // `updateOverlays`, which doesn't fit the reconciler's hover/select hooks.
    const nr = noteRendererRef.current;
    if (nr) {
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
    reviewedNoteIds,
  ]);
}
