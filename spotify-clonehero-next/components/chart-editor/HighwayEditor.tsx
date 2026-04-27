'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useChartEditorContext, selectActiveTrack} from './ChartEditorContext';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  buildTimedTempos,
  msToTick,
  snapToGrid,
} from '@/lib/drum-transcription/timing';
import {DEFAULT_VOCALS_PART, getDrumNotes} from '@/lib/chart-edit';
import DrumHighwayPreview, {
  type HighwayRendererHandle,
} from './DrumHighwayPreview';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {InteractionManager} from '@/lib/preview/highway';
import {useChartElements} from './highway/useChartElements';
import {useHighwaySync} from './highway/useHighwaySync';
import {useMarkerDrag} from './highway/useMarkerDrag';
import {useHighwayMouseInteraction} from './highway/useHighwayMouseInteraction';
import HighwayPopovers, {
  type HighwayPopoverState,
} from './highway/HighwayPopovers';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {cn} from '@/lib/utils';

interface HighwayEditorProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string;
  /** Optional confidence scores for notes, keyed by noteId (tick:type). */
  confidence?: Map<string, number>;
  /** Whether to show confidence overlays. Defaults to false. */
  showConfidence?: boolean;
  /** Confidence threshold below which notes are flagged. Defaults to 0.7. */
  confidenceThreshold?: number;
  /** Set of note IDs that have been reviewed by the user. */
  reviewedNoteIds?: Set<string>;
  /** Raw PCM audio data for waveform highway surface. */
  audioData?: Float32Array;
  /** Number of audio channels. */
  audioChannels?: number;
  /** Total duration in seconds. */
  durationSeconds?: number;
}

/**
 * Wraps DrumHighwayPreview with a transparent interaction layer.
 *
 * Mouse events are captured by a transparent <div>, then delegated to
 * InteractionManager for hit-testing (raycasting against note sprites,
 * section banners, and the highway plane). React decides what to do
 * with the results (select, place, erase, etc.).
 *
 * All edits go through the command system via useExecuteCommand.
 */
export default function HighwayEditor({
  metadata,
  chart,
  audioManager,
  className,
  confidence,
  showConfidence = false,
  confidenceThreshold = 0.7,
  reviewedNoteIds,
  audioData,
  audioChannels = 2,
  durationSeconds,
}: HighwayEditorProps) {
  const {
    state,
    dispatch,
    audioManagerRef,
    reconcilerRef,
    noteRendererRef,
    capabilities,
  } = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();

  const interactionRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js renderer handle for coordinate mapping.
  // rendererVersion is bumped whenever the handle changes so that useEffects
  // that depend on it re-run (refs alone don't trigger re-renders).
  const rendererHandleRef = useRef<HighwayRendererHandle | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);

  const readyGenerationRef = useRef(0);
  const handleRendererReady = useCallback(
    (handle: HighwayRendererHandle | null) => {
      rendererHandleRef.current = handle;
      if (!handle) {
        interactionManagerRef.current = null;
        reconcilerRef.current = null;
        noteRendererRef.current = null;
        setRendererVersion(v => v + 1);
        return;
      }
      // Resolve all managers from the single trackPromise.
      // Generation counter avoids stale resolutions if called multiple times.
      const gen = ++readyGenerationRef.current;
      Promise.all([
        handle.getReconciler(),
        handle.getInteractionManager(),
        handle.getNoteRenderer(),
      ]).then(([rec, im, nr]) => {
        if (readyGenerationRef.current !== gen) return;
        reconcilerRef.current = rec;
        interactionManagerRef.current = im;
        noteRendererRef.current = nr;
        setRendererVersion(v => v + 1);
      });
    },
    [reconcilerRef, noteRendererRef],
  );

  // Open-popover state for BPM/TimeSig/Section/Section-rename. The
  // <HighwayPopovers> component owns its own form-input state seeded from
  // these `initial*` fields on each open; HighwayEditor only knows when to
  // open and close.
  const [popover, setPopover] = useState<HighwayPopoverState | null>(null);
  const closePopover = useCallback(() => setPopover(null), []);

  // Compute timed tempos for coordinate mapping
  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
  }, [state.chartDoc]);

  const resolution = state.chartDoc?.parsedChart.resolution ?? 480;

  // Active-track notes for hit-testing. When the active scope isn't a
  // notes track (e.g. add-lyrics with `{kind: 'vocals'}`) there are no
  // notes to hit-test.
  const activeNotes = useMemo(() => {
    const track = selectActiveTrack(state);
    return track ? getDrumNotes(track) : [];
  }, [state]);

  // Active vocal part name. `vocals` is the default and the only part most
  // charts have; harm1/harm2/harm3 only exist on tracks with harmonies.
  // Drives lyric/phrase id namespacing so harm1's lyric at tick 480 doesn't
  // collide with the main vocals' lyric at the same tick.
  const activePartName =
    state.activeScope.kind === 'vocals'
      ? state.activeScope.part
      : DEFAULT_VOCALS_PART;

  // Single-entity marker drag (sections, lyrics, phrase markers). The hook
  // owns the state, the per-kind clamp, and the commit handler — caller just
  // drives it from the pointer handlers.
  const {markerDrag, beginMarkerDrag, updateMarkerDrag, commitMarkerDrag} =
    useMarkerDrag({
      chart: state.chart,
      activeScope: state.activeScope,
      activePartName,
      executeCommand,
      dispatch,
    });

  // ---------------------------------------------------------------------------
  // InteractionManager ref — resolved asynchronously from the renderer handle
  // (see handleRendererReady above).
  // ---------------------------------------------------------------------------

  const interactionManagerRef = useRef<InteractionManager | null>(null);

  // ---------------------------------------------------------------------------
  // Mouse interaction
  //
  // The hook owns hover state, drag state, the four mouse handlers, the
  // coordinate helpers, and tool-mode dispatch (place / erase / popovers).
  // We hand it `onOpenPopover` for the four tool popovers and read back
  // hover/drag state for cursor styling, the box-select rectangle, and
  // useHighwaySync's overlay push.
  // ---------------------------------------------------------------------------

  const {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    hoverLane,
    hoverTick,
    hoveredHitType,
    hoveredMarkerKey,
    isDragging,
    dragStart,
    dragCurrent,
  } = useHighwayMouseInteraction({
    interactionRef,
    interactionManagerRef,
    noteRendererRef,
    state,
    capabilities,
    activePartName,
    activeNotes,
    timedTempos,
    resolution,
    markerDrag,
    beginMarkerDrag,
    updateMarkerDrag,
    commitMarkerDrag,
    executeCommand,
    dispatch,
    onOpenPopover: setPopover,
  });

  // ---------------------------------------------------------------------------
  // Renderer/scene state pushes (waveform, grid, highway-mode, overlay,
  // note overlays, timing) — collected into useHighwaySync so they don't
  // sprawl across the editor body.
  // ---------------------------------------------------------------------------

  useHighwaySync({
    rendererHandleRef,
    noteRendererRef,
    rendererVersion,
    chartDoc: state.chartDoc,
    durationSeconds,
    timedTempos,
    resolution,
    audioData,
    audioChannels,
    highwayMode: state.highwayMode,
    cursorTick: state.cursorTick,
    isPlaying: state.isPlaying,
    activeTool: state.activeTool,
    hoverLane,
    hoverTick,
    loopRegion: state.loopRegion,
    noteSelection: state.selection.get('note') ?? new Set<string>(),
    confidence,
    showConfidence,
    confidenceThreshold,
    reviewedNoteIds,
  });

  // ---------------------------------------------------------------------------
  // Wheel scrolling -- scrub cursor forward/backward by one grid step
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const el = interactionRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (state.isPlaying || !state.chartDoc) return;
      e.preventDefault();

      const am = audioManagerRef.current;
      if (!am) return;

      // Scroll by a fixed time amount per wheel tick (25ms).
      // deltaY < 0 = wheel up = scroll forward, deltaY > 0 = backward.
      const SCROLL_STEP_MS = 25;
      const direction = e.deltaY < 0 ? 1 : -1;
      const currentChartMs = am.chartTime * 1000;
      const maxChartMs = am.duration * 1000 - am.chartDelay * 1000;
      const targetChartMs = Math.max(
        0,
        Math.min(currentChartMs + direction * SCROLL_STEP_MS, maxChartMs),
      );

      am.playChartTime(targetChartMs / 1000).then(() => am.pause());

      // Update cursor tick to match
      if (timedTempos.length > 0) {
        const tick = msToTick(
          targetChartMs,
          timedTempos,
          state.chartDoc.parsedChart.resolution,
        );
        dispatch({type: 'SET_CURSOR_TICK', tick});
      }
    };

    el.addEventListener('wheel', handleWheel, {passive: false});
    return () => el.removeEventListener('wheel', handleWheel);
  }, [
    state.isPlaying,
    state.chartDoc,
    state.cursorTick,
    state.gridDivision,
    timedTempos,
    resolution,
    audioManagerRef,
    dispatch,
  ]);

  // Push the full chart's elements (notes + markers) to the reconciler.
  // Hover + marker-drag overlays are baked in. The hook owns the effect.
  useChartElements({
    reconcilerRef,
    rendererVersion,
    chart: state.chart,
    activeScope: state.activeScope,
    partName: activePartName,
    capabilities,
    hoveredMarkerKey,
    markerDrag,
    timedTempos,
    resolution,
  });

  // ---------------------------------------------------------------------------
  // Sync cursor tick with playback
  //
  // During playback, cursor follows audioManager.currentTime.
  // On stop, cursor stays at the current position.
  // ---------------------------------------------------------------------------

  const prevIsPlayingRef = useRef(state.isPlaying);

  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = state.isPlaying;

    if (!state.isPlaying && wasPlaying && state.chartDoc) {
      // Just stopped: update cursor to current audio position
      const currentMs = (audioManagerRef.current?.currentTime ?? 0) * 1000;
      const cursorTick = msToTick(currentMs, timedTempos, resolution);
      const snapped =
        state.gridDivision === 0
          ? Math.max(0, cursorTick)
          : Math.max(0, snapToGrid(cursorTick, resolution, state.gridDivision));
      dispatch({type: 'SET_CURSOR_TICK', tick: snapped});
    }
    // audioManagerRef is a stable ref from context, not a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.isPlaying,
    state.chartDoc,
    state.gridDivision,
    timedTempos,
    resolution,
    dispatch,
  ]);

  // ---------------------------------------------------------------------------
  // Cursor style based on tool mode and what's under the mouse
  // ---------------------------------------------------------------------------

  const cursorStyle = useMemo(() => {
    // While dragging a marker, keep the grab cursor so the user knows the
    // marker is following.
    if (markerDrag) return 'grabbing';
    // When hovering over a note, show pointer in cursor/erase mode
    if (hoveredHitType === 'note') {
      if (state.activeTool === 'cursor' || state.activeTool === 'erase') {
        return 'pointer';
      }
    }
    // Side-mounted markers (sections, lyrics, phrase markers) — pointer in
    // cursor mode when the kind is selectable on this page.
    if (
      state.activeTool === 'cursor' &&
      hoveredHitType &&
      (hoveredHitType === 'section' ||
        hoveredHitType === 'lyric' ||
        hoveredHitType === 'phrase-start' ||
        hoveredHitType === 'phrase-end') &&
      capabilities.selectable.has(hoveredHitType)
    ) {
      return 'pointer';
    }
    // Default cursors per tool mode
    switch (state.activeTool) {
      case 'cursor':
        return 'default';
      case 'place':
        return 'crosshair';
      case 'erase':
        return 'pointer';
      case 'bpm':
      case 'timesig':
      case 'section':
        return 'crosshair';
      default:
        return 'default';
    }
  }, [state.activeTool, hoveredHitType, capabilities, markerDrag]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={{cursor: cursorStyle}}>
      {/* The actual 3D highway renderer */}
      <DrumHighwayPreview
        metadata={metadata}
        chart={chart}
        audioManager={audioManager}
        className="h-full w-full"
        showDrumLanes={capabilities.showDrumLanes}
        onRendererReady={handleRendererReady}
      />

      {/* Transparent interaction layer for mouse events */}
      <div
        ref={interactionRef}
        className="absolute inset-0 z-10"
        style={{cursor: cursorStyle}}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />

      {/* Box selection rectangle (DOM div -- inherently screen-space).
       * Suppressed while a note or marker drag is in progress so the
       * rectangle doesn't track alongside the dragged element. */}
      {state.activeTool === 'cursor' &&
        dragStart &&
        dragCurrent &&
        !isDragging &&
        !markerDrag &&
        (Math.abs(dragCurrent.x - dragStart.x) > 3 ||
          Math.abs(dragCurrent.y - dragStart.y) > 3) && (
          <div
            className="pointer-events-none absolute z-20 border"
            style={{
              left: Math.min(dragStart.x, dragCurrent.x),
              top: Math.min(dragStart.y, dragCurrent.y),
              width: Math.abs(dragCurrent.x - dragStart.x),
              height: Math.abs(dragCurrent.y - dragStart.y),
              backgroundColor: 'rgba(100, 149, 237, 0.25)',
              borderColor: 'rgba(100, 149, 237, 0.6)',
            }}
          />
        )}

      <HighwayPopovers
        popover={popover}
        onClose={closePopover}
        executeCommand={executeCommand}
      />
    </div>
  );
}
