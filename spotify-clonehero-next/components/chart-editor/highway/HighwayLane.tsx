'use client';

/**
 * One highway in the side-by-side strip. A lane owns no canvas and no WebGL
 * context: `HighwayEditor` runs a single `HighwayStage`, and the lane mounts
 * one highway group inside it (`useStageHighway`) and positions its own
 * transparent interaction layer over that highway's rect of the shared canvas.
 *
 * Everything else is per lane: the resolved `InteractionManager` +
 * `SceneReconciler` pair, and one instance each of
 * `useHighwayMouseInteraction`, `useChartElements`, and `useHighwaySync` —
 * all parameterized by this lane's own `scope` instead of a single shared
 * `activeScope`.
 *
 * Commands issued from this lane target this lane's `scope` because every
 * hook here is fed a `laneState` — a shallow copy of the real editor state
 * with `activeScope` overridden to the lane's scope — rather than the real
 * `state.activeScope`. Tools resolve their command's `trackKey` exclusively
 * from `ctx.state.activeScope` (`tools/tools.ts`), so this is enough to
 * retarget the entire existing tool/command stack per lane with no changes
 * to `tools/*`.
 *
 * A lane's scope is a track scope on every notes-editing surface; on
 * `/add-lyrics` it is the vocals scope, which resolves no notes track (the
 * neutral floor) and drives lyric/phrase markers off the active vocal part.
 *
 * "Last-interacted" semantics: a mousedown in a lane that is not already
 * the active one dispatches `SET_ACTIVE_SCOPE` to this lane's scope. This
 * is the ONLY place `activeScope` changes on interaction — it drives the
 * Note Inspector and keyboard note entry, and is never rendered as a visual
 * focus treatment (plan 0074 Design C — "no focus concept anywhere").
 *
 * Chrome: a lane has no border and no rounding of its own — the stage paints
 * one continuous black canvas underneath every lane — and the only per-lane
 * chrome is the instrument · difficulty label chip. Chart-wide chrome (the
 * karaoke lyrics line) is drawn once by the stage.
 *
 * Performance guard: this component never subscribes to the assist-run
 * store — assist progress ticks must not re-render lanes.
 *
 * Props, not context, for the shared derivations (`renderDoc`, timing,
 * `editingLocked`): `HighwayEditor` memoizes each one once and every lane
 * reads the same object. The lane is deliberately NOT wrapped in `memo` —
 * `state` is a prop and changes on every `SET_CURRENT_TIME` tick during
 * playback, so a memo boundary here would re-render on every tick anyway
 * while reading as a guarantee it cannot make.
 */

import {useCallback, useEffect, useMemo, useRef} from 'react';
import type {
  ChartEditorAction,
  ChartEditorState,
} from '@/lib/chart-editor-core';
import {
  DEFAULT_VOCALS_PART,
  findTrack,
  guitarSchema,
  listNotes,
  schemaForTrack,
} from '@/lib/chart-edit';
import {useAudioServiceContext} from '../AudioServiceContext';
import {msToTick} from '@/lib/drum-transcription/timing';
import type {HighwayStage} from '@/lib/preview/highway';
import type {HighwayRect} from '@/lib/preview/highway/layout';
import type {TimedTempo} from '@/lib/drum-transcription/chart-types';
import type {ChartDocument} from '@/lib/chart-edit';
import type {EditCommand} from '../commands';
import type {EditorCapabilities} from '../capabilities';
import {getSelectedIds} from '@/lib/chart-editor-core';
import {useChartElements} from './useChartElements';
import {useHighwaySync} from './useHighwaySync';
import {useHighwayMouseInteraction} from './useHighwayMouseInteraction';
import {useStageHighway} from './useStageHighway';
import {parseChartFile} from '@eliwhite/scan-chart';
import {scopePaneKey, trackKeyFromScope, type EditorScope} from '../scope';
import {trackLabel} from '../trackLabels';
import type {AudioSamples} from '../audioSamples';

type ParsedChart = ReturnType<typeof parseChartFile>;

export interface HighwayLaneProps {
  /** What this lane edits — a track on notes surfaces, the active vocal
   *  part on `/add-lyrics`. */
  scope: EditorScope;
  /** The stage this lane mounts its highway into. Null before it exists. */
  stage: HighwayStage | null;
  /** This lane's slice of the shared canvas, in CSS pixels. */
  rect: HighwayRect | undefined;
  chart: ParsedChart;
  audioData?: AudioSamples | undefined;
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
}

function HighwayLane({
  scope,
  stage,
  rect,
  chart,
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
}: HighwayLaneProps) {
  const laneScope = scope;
  const track = trackKeyFromScope(laneScope);
  const laneId = scopePaneKey(laneScope);

  // Shallow copy with `activeScope` overridden — every selector/tool that
  // reads `state.activeScope` resolves to THIS lane's scope without any
  // change to the selectors or the tool registry.
  const laneState = useMemo(
    () => ({...state, activeScope: laneScope}),
    [state, laneScope],
  );

  const activePartName =
    laneScope.kind === 'vocals' ? laneScope.part : DEFAULT_VOCALS_PART;

  const interactionRef = useRef<HTMLDivElement>(null);

  // `null` when this lane has no notes track (vocals/global) or the chart
  // doesn't contain the requested one. The highway then skips lanes, hitbox,
  // and note-texture loading and draws only the neutral floor + markers.
  const activeTrack = useMemo(() => {
    if (!track) return null;
    return (
      chart.trackData.find(
        t =>
          t.instrument === track.instrument &&
          t.difficulty === track.difficulty,
      ) ?? null
    );
  }, [chart, track]);

  // A global lane has no track of its own, and the bare floor the renderer
  // draws without one reads as a broken highway rather than an empty song.
  // Guitar lanes give it something to look like — the five-fret highway is
  // the one most charts share. Geometry only: `track` stays null, so the
  // overlays and the interaction surface offer no ghost notes and no hit
  // targets, and nothing can be edited into a track the chart lacks.
  const neutralLaneSchema =
    laneScope.kind === 'global' && activeTrack == null ? guitarSchema : null;

  const {
    handleRef: stageHandleRef,
    reconcilerRef,
    interactionManagerRef,
    version: stageHighwayVersion,
  } = useStageHighway({
    stage,
    id: laneId,
    track: activeTrack,
    showDrumLanes:
      capabilities.showDrumLanes &&
      (activeTrack != null || neutralLaneSchema != null),
    neutralLaneSchema,
  });

  /** Whether this lane is the last-interacted one. Drives only the
   *  `SET_ACTIVE_SCOPE` dispatch below — never a visual treatment. */
  const isActiveLane = scopePaneKey(state.activeScope) === laneId;

  // Keyed on the doc and this lane's track only. Deriving it from
  // `laneState` would re-list every note in the track, once per lane, on
  // every playback tick (`SET_CURRENT_TIME`) — nothing about the note list
  // depends on transport state.
  const chartDoc = state.chartDoc;
  const activeNotes = useMemo(() => {
    if (!chartDoc || !track) return [];
    const trackData = findTrack(chartDoc, track)?.track ?? null;
    if (!trackData) return [];
    const schema = schemaForTrack(trackData, chartDoc.parsedChart.drumType);
    return schema ? listNotes(trackData, schema) : [];
  }, [chartDoc, track]);

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
    state: laneState,
    capabilities,
    activeNotes,
    timedTempos,
    resolution,
    executeCommand,
    dispatch,
    editingLocked,
  });

  // Last-interacted semantics: any pointer-down in this lane becomes the
  // active scope. Never a visual focus treatment — just retargets keyboard
  // entry / Note Inspector.
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isActiveLane) {
        dispatch({type: 'SET_ACTIVE_SCOPE', scope: laneScope});
      }
      onMouseDown(e);
    },
    [dispatch, isActiveLane, onMouseDown, laneScope],
  );

  useHighwaySync({
    stageHandleRef,
    stageHighwayVersion,
    chartDoc: renderDoc,
    durationSeconds,
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
    rendererVersion: stageHighwayVersion,
    chart: renderDoc?.parsedChart ?? null,
    activeScope: laneScope,
    partName: activePartName,
    capabilities,
    selection: state.selection,
    hovered: state.hovered,
    noteDrag: noteDragHint,
    timedTempos: renderTimedTempos,
    resolution,
  });

  // ---------------------------------------------------------------------
  // Wheel scrolling -- scrub cursor forward/backward by one grid step.
  // Chart-wide (not per-track), attached per lane so scrubbing works no
  // matter which lane the pointer is over.
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
    if (noteDrag?.active) return 'grabbing';
    if (hoveredHitType === 'note') {
      if (state.activeTool === 'cursor' || state.activeTool === 'erase') {
        return 'pointer';
      }
    }
    switch (state.activeTool) {
      case 'cursor':
        return 'default';
      case 'place':
        return 'crosshair';
      case 'erase':
        return 'pointer';
      default:
        return 'default';
    }
  }, [state.activeTool, hoveredHitType, noteDrag]);

  const label = track ? trackLabel(track) : null;

  return (
    <div
      className="absolute z-10 overflow-hidden"
      style={{
        cursor: cursorStyle,
        left: rect?.x ?? 0,
        top: rect?.y ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
      }}
      data-testid={`highway-lane-${laneId}`}>
      {/* The strikeline projects at ~91% of the pane's height (see
          `cameraFit`), and notes are clipped there, so a chip pinned to the
          pane's bottom edge sits under everything the player reads. */}
      {label && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--ed-surface-hover)] px-2 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm">
          {label}
        </div>
      )}

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
    </div>
  );
}

export default HighwayLane;
