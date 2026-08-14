'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {Loader2} from 'lucide-react';
import {useChartEditorContext} from './ChartEditorContext';
import {useAudioManager} from './AudioServiceContext';
import {parseTrackKeyId, selectRenderDoc} from '@/lib/chart-editor-core';
import {scopePaneKey, type EditorScope} from './scope';
import {useExecuteCommand} from './hooks/useEditCommands';
import {buildTimedTempos, msToTick} from '@/lib/drum-transcription/timing';
import HighwayLane from './highway/HighwayLane';
import {useStageSync} from './highway/useStageSync';
import {setupStage, type HighwayStage} from '@/lib/preview/highway';
import {computeStageLayout} from '@/lib/preview/highway/layout';
import {DEFAULT_VOCALS_PART, snapTickToGrid} from '@/lib/chart-edit';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {TrackKey} from '@/lib/chart-edit';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {cn} from '@/lib/utils';
import type {AudioSamples} from './audioSamples';

interface HighwayEditorProps {
  chart: ParsedChart;
  audioManager: AudioManager;
  className?: string | undefined;
  /** Raw PCM audio data for waveform highway surface. */
  audioData?: AudioSamples | undefined;
  /**
   * The host is still decoding the audio. Only the waveform surface needs it
   * — a classic highway is drawn entirely from the chart — so this decides
   * the wording of the waveform mode's placeholder, not whether the highway
   * renders.
   */
  audioLoading?: boolean | undefined;
  /** Number of audio channels. */
  audioChannels?: number | undefined;
  /** Total duration in seconds. */
  durationSeconds?: number | undefined;
  /**
   * Whether the piano roll below stacks one row per track. Only affects the
   * overflow chip's copy: a stacked piano roll does show the tracks that
   * didn't get a lane, a single-track one doesn't.
   */
  stackedPianoRoll?: boolean | undefined;
}

/**
 * On surfaces that show the Chart Matrix, renders one highway lane per
 * visible track (`state.visibleTrackKeys`, insertion order), capped at
 * `layout.maxHighways` with a "+N more" overflow chip. Every lane is
 * independently editable — no "focused" lane concept; `activeScope` tracks
 * only which lane was last interacted with, for keyboard entry and the Note
 * Inspector (plan 0074 Design C). Surfaces with `showChartMatrix: false`
 * have no way to change the visible set, so they render a single lane on
 * `activeScope`, the track they were configured with.
 *
 * A vocals scope (`/add-lyrics`) is the one non-track surface: it renders a
 * single lane scoped to the active vocal part, with no notes track and no
 * matrix behind it, so the neutral floor plus lyric/phrase markers is what
 * the lane draws.
 *
 * One scene, one canvas. This component owns a single `HighwayStage`: one
 * `WebGLRenderer`, one `THREE.Scene`, one animation loop, with each lane's
 * highway a group inside it rendered through its own camera into its own
 * viewport/scissor slice. It measures the canvas host, derives the lane rects
 * from `computeStageLayout`, and pushes that one `StageLayout` object to both
 * consumers — the absolutely-positioned lane overlays and the stage's GL
 * rects — so DOM pixels and GL pixels cannot drift apart.
 *
 * The lane cap comes from that same layout: `maxHighways` is how many lanes
 * the measured canvas width can hold at `MIN_HIGHWAY_PX` each. Showing or
 * hiding a track, or resizing the window past a lane's worth of width, adds
 * or removes one highway on the live stage — it never rebuilds the stage, the
 * renderer, or the context.
 *
 * Chart-wide chrome is drawn once by the stage rather than once per lane: the
 * karaoke lyrics line spans the whole strip, top-center, reading the active
 * vocal part on a vocals scope and the default part everywhere else.
 *
 * All per-lane interaction (mouse handling, chart-element push, renderer
 * sync, marker drag) lives in `HighwayLane`; this component resolves the lane
 * list, the state shared by every lane (render doc, timing, lock state), and
 * the stage.
 */
export default function HighwayEditor({
  chart,
  audioManager,
  className,
  audioData,
  audioLoading = false,
  audioChannels = 2,
  durationSeconds,
  stackedPianoRoll = false,
}: HighwayEditorProps) {
  const {state, dispatch, capabilities} = useChartEditorContext();
  const {executeCommand} = useExecuteCommand();
  // Subscribes to AudioManager instance changes (created/rebuilt/destroyed)
  // so the cursor-sync effect below resubscribes instead of closing over a
  // possibly-stale ref.
  const activeAudioManager = useAudioManager();

  const renderDoc = selectRenderDoc(state);

  const timedTempos = useMemo(() => {
    if (!state.chartDoc) return [];
    return buildTimedTempos(
      state.chartDoc.parsedChart.tempos,
      state.chartDoc.parsedChart.resolution,
    );
  }, [state.chartDoc]);

  const renderTimedTempos = useMemo(() => {
    if (!renderDoc) return [];
    return buildTimedTempos(
      renderDoc.parsedChart.tempos,
      renderDoc.parsedChart.resolution,
    );
  }, [renderDoc]);

  const resolution = state.chartDoc?.parsedChart.resolution ?? 480;

  // A pending candidate is a read-only preview contract: note editing is
  // gated in every lane while it's up (see HighwayLane).
  const editingLocked = state.pendingTempoCandidate !== null;

  // ---------------------------------------------------------------------------
  // Sync cursor tick with playback. Chart-wide, so it lives once here
  // rather than once per lane.
  // ---------------------------------------------------------------------------
  const prevIsPlayingRef = useRef(state.isPlaying);
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = state.isPlaying;

    if (!state.isPlaying && wasPlaying && state.chartDoc) {
      const currentMs = (activeAudioManager?.currentTime ?? 0) * 1000;
      const cursorTick = msToTick(currentMs, timedTempos, resolution);
      // The editor's one snap: `gridDivision` counts subdivisions per whole
      // note, and 0 means free placement (which `snapTickToGrid` handles).
      const snapped = snapTickToGrid(
        cursorTick,
        resolution,
        state.gridDivision,
      );
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
  // Lane list -- ordered by state.visibleTrackKeys insertion order, capped.
  // The reducer guarantees every id here names a track the doc contains, so
  // this only has to parse them.
  // ---------------------------------------------------------------------------
  const visibleTracks = useMemo(
    () =>
      Array.from(state.visibleTrackKeys)
        .map(parseTrackKeyId)
        .filter((t): t is TrackKey => t !== null),
    [state.visibleTrackKeys],
  );

  const vocalsScope =
    state.activeScope.kind === 'vocals' ? state.activeScope : null;

  // `visibleTrackKeys` is the Chart Matrix's state, and the matrix is the
  // only thing that writes it. Surfaces without a matrix (`/preview`,
  // `/tempo`, `/add-lyrics`) configure their track through `activeScope`
  // instead, and their piano roll reads it too, so their single lane follows
  // it -- deriving from the reducer-seeded visible set would show whichever
  // track `preferredTrackForChart` picked, out of step with the rest of the
  // page.
  const matrixDrivesLanes = capabilities.showChartMatrix;
  const activeScope = state.activeScope;

  const laneScopes: EditorScope[] = useMemo(() => {
    if (vocalsScope) return [vocalsScope];
    if (!matrixDrivesLanes) return [activeScope];
    // With no track shown — the matrix can hide the last one, and a chart
    // may have none to begin with — the song is still worth looking at. A
    // global scope draws the highway, its tempo markers and its lyrics, and
    // no notes, instead of replacing all of it with a message.
    if (visibleTracks.length === 0) return [{kind: 'global' as const}];
    return visibleTracks.map(track => ({kind: 'track' as const, track}));
  }, [vocalsScope, matrixDrivesLanes, activeScope, visibleTracks]);

  // ---------------------------------------------------------------------------
  // The stage: one renderer, one canvas, one scene, one animation loop.
  // ---------------------------------------------------------------------------
  const sizingRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<HighwayStage | null>(null);

  // Chart data updates flow through the reconciler, never through a stage
  // rebuild, so the stage only reads the chart when a highway is first built.
  const chartRef = useRef(chart);
  useEffect(() => {
    chartRef.current = chart;
  });

  // One context now backs every lane, so losing it blanks the whole strip.
  // Bumping this generation destroys the dead stage and builds a new one; each
  // lane's mount effect keys off the stage identity, so the current visible
  // set re-adds itself onto the new context.
  const [stageGeneration, setStageGeneration] = useState(0);

  // The stage reads the playback clock through this, so swapping the
  // AudioManager (the chart editor does, when a project's audio finishes
  // decoding behind the open editor) does not rebuild the WebGL context and
  // every highway on it.
  const audioManagerRef = useRef(audioManager);
  useEffect(() => {
    audioManagerRef.current = audioManager;
  });
  const getAudioManager = useCallback(() => audioManagerRef.current, []);

  useEffect(() => {
    const created = setupStage(
      chartRef.current,
      sizingRef,
      canvasHostRef,
      getAudioManager,
    );
    const unsubscribe = created.onContextLost(() => {
      setStageGeneration(generation => generation + 1);
    });
    created.startRender();
    setStage(created);
    return () => {
      unsubscribe();
      setStage(null);
      created.destroy();
    };
  }, [getAudioManager, stageGeneration]);

  // ---------------------------------------------------------------------------
  // Measurement -> layout. React measures the canvas host once for the whole
  // strip; the stage never measures anything itself.
  // ---------------------------------------------------------------------------
  const [canvasSize, setCanvasSize] = useState({width: 0, height: 0});

  const measure = useCallback(() => {
    const el = sizingRef.current;
    if (!el) return;
    setCanvasSize(prev =>
      prev.width === el.offsetWidth && prev.height === el.offsetHeight
        ? prev
        : {width: el.offsetWidth, height: el.offsetHeight},
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = sizingRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // ---------------------------------------------------------------------------
  // Layout -> lane slice. One `StageLayout` object drives everything: how many
  // lanes fit, the overflow chip, the lane overlay rects, and the stage's GL
  // rects. `maxHighways` depends only on the canvas width, so a first pass
  // over the full lane list reports the cap and a second lays out only the
  // lanes that fit. At width 0 -- before the first measurement, and in jsdom,
  // which has no layout at all -- `computeStageLayout` reports
  // `measured: false` and falls back to `MAX_HIGHWAYS`, so lane routing
  // behaves as it does at full width instead of collapsing to one lane.
  // ---------------------------------------------------------------------------
  const layout = useMemo(() => {
    const canvas = {
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    };
    const probe = computeStageLayout({
      ...canvas,
      highwayCount: laneScopes.length,
    });
    if (laneScopes.length <= probe.maxHighways) return probe;
    return computeStageLayout({...canvas, highwayCount: probe.maxHighways});
  }, [canvasSize.width, canvasSize.height, laneScopes.length]);

  const lanes = useMemo(
    () => laneScopes.slice(0, layout.maxHighways),
    [laneScopes, layout.maxHighways],
  );
  const overflowCount = Math.max(0, laneScopes.length - layout.maxHighways);

  const laneIds = useMemo(() => lanes.map(scopePaneKey), [lanes]);

  // The same `layout` object that positions the lane overlays below.
  useEffect(() => {
    stage?.setLayout(layout, laneIds);
  }, [stage, layout, laneIds]);

  // Lyrics belong to the song: one push for the whole strip, off the active
  // vocal part on `/add-lyrics` and the default part everywhere else.
  const stagePartName = vocalsScope ? vocalsScope.part : DEFAULT_VOCALS_PART;
  useStageSync({
    stage,
    chartDoc: renderDoc,
    timedTempos: renderTimedTempos,
    resolution,
    partName: stagePartName,
  });

  return (
    <div
      ref={sizingRef}
      className={cn(
        'relative h-full w-full overflow-hidden bg-[var(--ed-surface)]',
        className,
      )}>
      <div ref={canvasHostRef} className="absolute inset-0" />

      {/* Waveform mode draws the song itself, so it has nothing to show until
       *  the samples are here. Classic mode is drawn from the chart alone and
       *  is fully usable meanwhile, so it is never covered. */}
      {lanes.length > 0 && state.highwayMode === 'waveform' && !audioData && (
        <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-[var(--ed-surface)]/80 text-sm text-[color:var(--ed-surface-fg-muted)]">
          {audioLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading audio for the waveform…</span>
            </>
          ) : (
            <span>No audio to draw a waveform from.</span>
          )}
        </div>
      )}

      {lanes.map((scope, index) => (
        <HighwayLane
          key={scopePaneKey(scope)}
          scope={scope}
          stage={stage}
          rect={layout.highways[index]}
          chart={chart}
          audioData={audioData}
          audioChannels={audioChannels}
          durationSeconds={durationSeconds}
          state={state}
          dispatch={dispatch}
          capabilities={capabilities}
          executeCommand={executeCommand}
          renderDoc={renderDoc}
          timedTempos={timedTempos}
          renderTimedTempos={renderTimedTempos}
          resolution={resolution}
          editingLocked={editingLocked}
        />
      ))}

      {overflowCount > 0 && (
        <div
          className="pointer-events-none absolute bottom-2 right-2 z-30 rounded-full bg-black/70 px-3 py-1 text-xs font-medium text-white"
          data-testid="highway-overflow-indicator">
          +{overflowCount} more{' '}
          {stackedPianoRoll ? 'shown in piano roll' : 'hidden'}
        </div>
      )}
    </div>
  );
}
