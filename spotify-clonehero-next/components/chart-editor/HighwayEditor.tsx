'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useChartEditorContext} from './ChartEditorContext';
import {useAudioServiceContext, useAudioManager} from './AudioServiceContext';
import {
  selectActiveTrack,
  selectRenderDoc,
  getSelectedIds,
} from '@/lib/chart-editor-core';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  buildTimedTempos,
  msToTick,
  snapToGrid,
} from '@/lib/drum-transcription/timing';
import {DEFAULT_VOCALS_PART, getDrumNotes} from '@/lib/chart-edit';
import HighwayPreview, {type HighwayRendererHandle} from './HighwayPreview';
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
import {isTrackScope} from './scope';

interface HighwayEditorProps {
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string | undefined;
  /** Raw PCM audio data for waveform highway surface. */
  audioData?: Float32Array | undefined;
  /** Number of audio channels. */
  audioChannels?: number | undefined;
  /** Total duration in seconds. */
  durationSeconds?: number | undefined;
}

/**
 * Wraps HighwayPreview with a transparent interaction layer.
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
  audioData,
  audioChannels = 2,
  durationSeconds,
}: HighwayEditorProps) {
  const {state, dispatch, reconcilerRef, noteRendererRef, capabilities} =
    useChartEditorContext();
  const {audioManagerRef} = useAudioServiceContext();
  // Subscribes to AudioManager instance changes (created/rebuilt/destroyed)
  // so the cursor-sync effect below resubscribes instead of closing over a
  // possibly-stale ref.
  const activeAudioManager = useAudioManager();
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

  // While a tempo gesture is uncommitted, BOTH views render from the candidate
  // doc, not the committed one (0061 §7 — the one preview channel). This covers
  // the persistent class-(b) structural preview (accept/reject bar up, no
  // gesture in flight) as well as a class-(a) marker drag in flight. The
  // reducer clears the candidate on any command/undo/redo/reload, so the
  // highway never shows stale geometry once the gesture ends. Note EDITING
  // still targets the committed doc and is gated while a candidate is pending
  // (see `editingLocked` below) so a click can't hit a candidate-only note.
  const renderDoc = selectRenderDoc(state);

  // Committed timed tempos for interaction/cursor coordinate mapping (edits
  // target the committed doc).
  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
  }, [state.chartDoc]);

  // Rendered timed tempos — from the candidate doc when previewing, so the
  // moving grid and re-ticked notes draw the preview.
  const renderTimedTempos = useMemo(() => {
    if (!renderDoc) return [];
    return buildTimedTempos(
      renderDoc.parsedChart.tempos,
      renderDoc.parsedChart.resolution,
    );
  }, [renderDoc]);

  const resolution = state.chartDoc?.parsedChart.resolution ?? 480;

  // A pending candidate is a read-only preview contract: note editing is gated
  // in both views while it's up, so a gesture can't target a note that exists
  // only in the candidate (or the wrong committed note under a moved grid).
  const editingLocked = state.pendingTempoCandidate !== null;

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
      chart: state.chartDoc?.parsedChart ?? null,
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
    isDragging,
    noteDrag,
    dragStart,
    dragCurrent,
  } = useHighwayMouseInteraction({
    interactionRef,
    interactionManagerRef,
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
    editingLocked,
  });

  // ---------------------------------------------------------------------------
  // Renderer/scene state pushes (waveform, grid, highway-mode, overlay,
  // note overlays, timing) — collected into useHighwaySync so they don't
  // sprawl across the editor body.
  // ---------------------------------------------------------------------------

  useHighwaySync({
    rendererHandleRef,
    rendererVersion,
    chartDoc: renderDoc,
    durationSeconds,
    timedTempos: renderTimedTempos,
    resolution,
    partName: activePartName,
    audioData,
    audioChannels,
    highwayMode: state.highwayMode,
    cursorTick: state.cursorTick,
    isPlaying: state.isPlaying,
    activeTool: state.activeTool,
    hoverLane,
    hoverTick,
    loopRegion: state.loopRegion,
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

      // Scale the step by the wheel delta so trackpads (which fire many
      // small ~4px events per gesture) feel proportional, while mouse
      // wheels (which fire large ~100-300px discrete clicks) hit the cap
      // and stay at a comfortable fixed step per click. The cap is the
      // pre-tuned mouse-wheel feel; MS_PER_DELTA scales linearly below it.
      // deltaY < 0 = wheel up = scroll forward, deltaY > 0 = backward.
      // seekToChartTime updates timing fields without resuming the
      // AudioContext, so back-to-back wheel events don't drift forward.
      const MS_PER_DELTA = 0.45;
      const MAX_STEP_MS = 60;
      const stepMs = Math.min(MAX_STEP_MS, Math.abs(e.deltaY) * MS_PER_DELTA);
      const direction = e.deltaY < 0 ? 1 : -1;
      const currentChartMs = am.chartTime * 1000;
      const maxChartMs = am.duration * 1000 - am.chartDelay * 1000;
      const targetChartMs = Math.max(
        0,
        Math.min(currentChartMs + direction * stepMs, maxChartMs),
      );

      am.seekToChartTime(targetChartMs / 1000);

      // Update cursor tick to match. Round in the scroll direction so the
      // cursor never jumps backward when scrolling forward (or vice versa).
      if (timedTempos.length > 0) {
        const tick = msToTick(
          targetChartMs,
          timedTempos,
          state.chartDoc.parsedChart.resolution,
          direction > 0 ? 'ceil' : 'floor',
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

  // Live note-drag hint for the reconciler: the selected notes' elements
  // follow the anchored drag deltas so the drag previews in place.
  const noteDragHint = useMemo(() => {
    if (!noteDrag?.active) return null;
    const ids = getSelectedIds(state, 'note');
    if (ids.size === 0) return null;
    return {
      tickDelta: noteDrag.tickDelta,
      laneDelta: noteDrag.laneDelta,
      ids,
    };
  }, [noteDrag, state]);

  // Push the full chart's elements (notes + markers) to the reconciler.
  // Hover and selection are pushed through separate effects in the same
  // hook so mouse and drag can't race each other into the renderer.
  useChartElements({
    reconcilerRef,
    rendererVersion,
    chart: renderDoc?.parsedChart ?? null,
    activeScope: state.activeScope,
    partName: activePartName,
    capabilities,
    selection: state.selection,
    hovered: state.hovered,
    markerDrag,
    noteDrag: noteDragHint,
    timedTempos: renderTimedTempos,
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
      const currentMs = (activeAudioManager?.currentTime ?? 0) * 1000;
      const cursorTick = msToTick(currentMs, timedTempos, resolution);
      const snapped =
        state.gridDivision === 0
          ? Math.max(0, cursorTick)
          : Math.max(0, snapToGrid(cursorTick, resolution, state.gridDivision));
      dispatch({type: 'SET_CURSOR_TICK', tick: snapped});
    }
  }, [
    state.isPlaying,
    state.chartDoc,
    state.gridDivision,
    timedTempos,
    resolution,
    dispatch,
    activeAudioManager,
  ]);

  // ---------------------------------------------------------------------------
  // Cursor style based on tool mode and what's under the mouse
  // ---------------------------------------------------------------------------

  const cursorStyle = useMemo(() => {
    // While dragging a marker or notes, keep the grab cursor so the user
    // knows the entity is following.
    if (markerDrag || noteDrag?.active) return 'grabbing';
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
  }, [state.activeTool, hoveredHitType, capabilities, markerDrag, noteDrag]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      style={{cursor: cursorStyle}}>
      {/* The actual 3D highway renderer */}
      <HighwayPreview
        metadata={metadata}
        chart={chart}
        audioManager={audioManager}
        className="h-full w-full"
        showLanes={capabilities.showDrumLanes}
        trackKey={
          isTrackScope(state.activeScope) ? state.activeScope.track : undefined
        }
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
        tempoGlueMode={state.tempoGlueMode}
      />
    </div>
  );
}
