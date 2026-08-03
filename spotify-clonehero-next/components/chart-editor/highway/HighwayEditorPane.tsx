'use client';

/**
 * One highway pane in the multi-pane `HighwayEditor` grid (plan 0074 Phase
 * 3). Wraps a single `HighwayPreview` + its transparent interaction layer,
 * and owns every per-pane piece of the interaction stack: the renderer
 * handle, the resolved `InteractionManager` + `SceneReconciler` pair, and
 * one instance each of `useHighwayMouseInteraction`, `useChartElements`,
 * `useHighwaySync`, and `useMarkerDrag` — all parameterized by this pane's
 * own `scope` instead of a single shared `activeScope`.
 *
 * Commands issued from this pane target this pane's `scope` because every
 * hook here is fed a `paneState` — a shallow copy of the real editor state
 * with `activeScope` overridden to the pane's scope — rather than the real
 * `state.activeScope`. Tools resolve their command's `trackKey` exclusively
 * from `ctx.state.activeScope` (`tools/tools.ts`), so this is enough to
 * retarget the entire existing tool/command stack per pane with no changes
 * to `tools/*`.
 *
 * A pane's scope is a track scope on every notes-editing surface; on
 * `/add-lyrics` it is the vocals scope, which resolves no notes track (the
 * neutral floor) and drives lyric/phrase markers off the active vocal part.
 *
 * "Last-interacted" semantics: a mousedown in a pane that is not already
 * the active one dispatches `SET_ACTIVE_SCOPE` to this pane's scope. This
 * is the ONLY place `activeScope` changes on interaction — it drives the
 * Note Inspector and keyboard note entry, and is never rendered as a visual
 * focus treatment (plan 0074 Design C — "no focus concept anywhere").
 *
 * Performance guard: this component never subscribes to the assist-run
 * store — assist progress ticks must not re-render panes.
 *
 * Props, not context, for the shared derivations (`renderDoc`, timing,
 * `editingLocked`): `HighwayEditor` memoizes each one once and every pane
 * reads the same object. The pane is deliberately NOT wrapped in `memo` —
 * `state` is a prop and changes on every `SET_CURRENT_TIME` tick during
 * playback, so a memo boundary here would re-render on every tick anyway
 * while reading as a guarantee it cannot make.
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  ChartEditorAction,
  ChartEditorState,
} from '@/lib/chart-editor-core';
import {
  DEFAULT_VOCALS_PART,
  findTrack,
  listNotes,
  schemaForTrack,
} from '@/lib/chart-edit';
import {useAudioServiceContext} from '../AudioServiceContext';
import {msToTick} from '@/lib/drum-transcription/timing';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {InteractionManager} from '@/lib/preview/highway';
import type {SceneReconciler} from '@/lib/preview/highway/SceneReconciler';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {ChartDocument} from '@/lib/chart-edit';
import HighwayPreview, {type HighwayRendererHandle} from '../HighwayPreview';
import type {EditCommand} from '../commands';
import type {EditorCapabilities} from '../capabilities';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {useChartElements} from './useChartElements';
import {useHighwaySync} from './useHighwaySync';
import {useMarkerDrag} from './useMarkerDrag';
import {useHighwayMouseInteraction} from './useHighwayMouseInteraction';
import HighwayPopovers, {type HighwayPopoverState} from './HighwayPopovers';
import {parseChartFile} from '@eliwhite/scan-chart';
import {scopePaneKey, trackKeyFromScope, type EditorScope} from '../scope';
import {trackLabel} from '../trackLabels';

type ParsedChart = ReturnType<typeof parseChartFile>;

export interface HighwayEditorPaneProps {
  /** What this pane edits — a track on notes surfaces, the active vocal
   *  part on `/add-lyrics`. */
  scope: EditorScope;
  metadata: ChartResponseEncore;
  chart: ParsedChart;
  audioManager: AudioManager;
  audioData?: Float32Array | undefined;
  audioChannels: number;
  durationSeconds?: number | undefined;
  state: ChartEditorState;
  dispatch: (action: ChartEditorAction) => void;
  capabilities: EditorCapabilities;
  executeCommand: (cmd: EditCommand) => void;
  renderDoc: ChartDocument | null;
  timedTempos: TimedTempo[];
  renderTimedTempos: TimedTempo[];
  resolution: number;
  editingLocked: boolean;
  className?: string | undefined;
}

function HighwayEditorPane({
  scope,
  metadata,
  chart,
  audioManager,
  audioData,
  audioChannels,
  durationSeconds,
  state,
  dispatch,
  capabilities,
  executeCommand,
  renderDoc,
  timedTempos,
  renderTimedTempos,
  resolution,
  editingLocked,
  className,
}: HighwayEditorPaneProps) {
  const paneScope = scope;
  const track = trackKeyFromScope(paneScope);

  // Shallow copy with `activeScope` overridden — every selector/tool that
  // reads `state.activeScope` resolves to THIS pane's scope without any
  // change to the selectors or the tool registry.
  const paneState = useMemo(
    () => ({...state, activeScope: paneScope}),
    [state, paneScope],
  );

  const activePartName =
    paneScope.kind === 'vocals' ? paneScope.part : DEFAULT_VOCALS_PART;

  const interactionRef = useRef<HTMLDivElement>(null);

  const rendererHandleRef = useRef<HighwayRendererHandle | null>(null);
  const [rendererVersion, setRendererVersion] = useState(0);
  const reconcilerRef = useRef<SceneReconciler | null>(null);
  const interactionManagerRef = useRef<InteractionManager | null>(null);

  const readyGenerationRef = useRef(0);
  const handleRendererReady = useCallback(
    (handle: HighwayRendererHandle | null) => {
      rendererHandleRef.current = handle;
      // Every ready/teardown callback invalidates the previous generation, so
      // a `Promise.all` still in flight for a renderer that has since gone
      // away can never write its disposed reconciler back into the refs.
      const gen = ++readyGenerationRef.current;
      if (!handle) {
        interactionManagerRef.current = null;
        reconcilerRef.current = null;
        setRendererVersion(v => v + 1);
        return;
      }
      Promise.all([
        handle.getReconciler(),
        handle.getInteractionManager(),
      ]).then(([rec, im]) => {
        if (readyGenerationRef.current !== gen) return;
        reconcilerRef.current = rec;
        interactionManagerRef.current = im;
        setRendererVersion(v => v + 1);
      });
    },
    [],
  );

  /** Whether this pane is the last-interacted one. Drives only the
   *  `SET_ACTIVE_SCOPE` dispatch below — never a visual treatment. */
  const isActivePane = scopePaneKey(state.activeScope) === scopePaneKey(scope);

  const [popover, setPopover] = useState<HighwayPopoverState | null>(null);
  const closePopover = useCallback(() => setPopover(null), []);

  // Keyed on the doc and this pane's track only. Deriving it from
  // `paneState` would re-list every note in the track, once per pane, on
  // every playback tick (`SET_CURRENT_TIME`) — nothing about the note list
  // depends on transport state.
  const chartDoc = state.chartDoc;
  const activeNotes = useMemo(() => {
    if (!chartDoc || !track) return [];
    const activeTrack = findTrack(chartDoc, track)?.track ?? null;
    if (!activeTrack) return [];
    const schema = schemaForTrack(activeTrack, chartDoc.parsedChart.drumType);
    return schema ? listNotes(activeTrack, schema) : [];
  }, [chartDoc, track]);

  const {markerDrag, beginMarkerDrag, updateMarkerDrag, commitMarkerDrag} =
    useMarkerDrag({
      chart: state.chartDoc?.parsedChart ?? null,
      activeScope: paneScope,
      activePartName,
      executeCommand,
      dispatch,
    });

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
    state: paneState,
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

  // Last-interacted semantics: any pointer-down in this pane becomes the
  // active scope. Never a visual focus treatment — just retargets keyboard
  // entry / Note Inspector.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isActivePane) {
        dispatch({type: 'SET_ACTIVE_SCOPE', scope: paneScope});
      }
      onMouseDown(e);
    },
    [dispatch, isActivePane, onMouseDown, paneScope],
  );

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

  useChartElements({
    reconcilerRef,
    rendererVersion,
    chart: renderDoc?.parsedChart ?? null,
    activeScope: paneScope,
    partName: activePartName,
    capabilities,
    selection: state.selection,
    hovered: state.hovered,
    markerDrag,
    noteDrag: noteDragHint,
    timedTempos: renderTimedTempos,
    resolution,
  });

  // ---------------------------------------------------------------------
  // Wheel scrolling -- scrub cursor forward/backward by one grid step.
  // Chart-wide (not per-track), attached per pane so scrubbing works no
  // matter which pane the pointer is over.
  // ---------------------------------------------------------------------
  const {audioManagerRef} = useAudioServiceContext();
  useEffect(() => {
    const el = interactionRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (state.isPlaying || !state.chartDoc) return;
      e.preventDefault();

      const am = audioManagerRef.current;
      if (!am) return;

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
    state.gridDivision,
    timedTempos,
    resolution,
    audioManagerRef,
    dispatch,
  ]);

  const cursorStyle = useMemo(() => {
    if (markerDrag || noteDrag?.active) return 'grabbing';
    if (hoveredHitType === 'note') {
      if (state.activeTool === 'cursor' || state.activeTool === 'erase') {
        return 'pointer';
      }
    }
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

  const label = track ? trackLabel(track) : null;

  return (
    <div
      className={className}
      style={{cursor: cursorStyle, position: 'relative'}}
      data-testid={`highway-pane-${scopePaneKey(scope)}`}>
      {label && (
        <div className="pointer-events-none absolute left-2 top-2 z-30 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
          {label}
        </div>
      )}

      <HighwayPreview
        metadata={metadata}
        chart={chart}
        audioManager={audioManager}
        className="h-full w-full"
        showLanes={capabilities.showDrumLanes}
        trackKey={track}
        onRendererReady={handleRendererReady}
      />

      <div
        ref={interactionRef}
        className="absolute inset-0 z-10"
        style={{cursor: cursorStyle}}
        onMouseDown={handleMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
      />

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

export default HighwayEditorPane;
