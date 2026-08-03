'use client';

import {useMemo, useEffect, useRef} from 'react';
import {useChartEditorContext} from './ChartEditorContext';
import {useAudioManager} from './AudioServiceContext';
import {parseTrackKeyId, selectRenderDoc} from '@/lib/chart-editor-core';
import {scopePaneKey, type EditorScope} from './scope';
import {useExecuteCommand} from './hooks/useEditCommands';
import {
  buildTimedTempos,
  msToTick,
  snapToGrid,
} from '@/lib/drum-transcription/timing';
import HighwayEditorPane from './highway/HighwayEditorPane';
import type {ChartResponseEncore} from '@/lib/chartSelection';
import type {AudioManager} from '@/lib/preview/audioManager';
import type {TrackKey} from '@/lib/chart-edit';
import {parseChartFile} from '@eliwhite/scan-chart';
type ParsedChart = ReturnType<typeof parseChartFile>;
import {cn} from '@/lib/utils';

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
  /**
   * Whether the piano roll below stacks one row per track. Only affects the
   * overflow chip's copy: a stacked piano roll does show the tracks that
   * didn't get a pane, a single-track one doesn't.
   */
  stackedPianoRoll?: boolean | undefined;
}

/** Highway panes render at most this many visible tracks at once (2026-08-03
 *  spike: 1-4 simultaneous `HighwayPreview` panes all sustained ~240
 *  draw-loops/s with a flat worst-1% frame; pane count was capped at 3 with
 *  an overflow indicator rather than at the untested 4th pane). */
const MAX_HIGHWAY_PANES = 3;

/**
 * On surfaces that show the Chart Matrix, renders one highway pane per
 * visible track (`state.visibleTrackKeys`, insertion order), capped at
 * `MAX_HIGHWAY_PANES` with a "+N more" overflow chip. Every pane is
 * independently editable — no "focused" pane concept; `activeScope` tracks
 * only which pane was last interacted with, for keyboard entry and the Note
 * Inspector (plan 0074 Design C). Surfaces with `showChartMatrix: false`
 * have no way to change the visible set, so they render a single pane on
 * `activeScope`, the track they were configured with.
 *
 * A vocals scope (`/add-lyrics`) is the one non-track surface: it renders a
 * single pane scoped to the active vocal part, with no notes track and no
 * matrix behind it, so the neutral floor plus lyric/phrase markers is what
 * the pane draws.
 *
 * All per-pane interaction (mouse handling, chart-element push, renderer
 * sync, marker drag) lives in `HighwayEditorPane`; this component only
 * resolves the pane list and the state shared by every pane (render doc,
 * timing, lock state).
 */
export default function HighwayEditor({
  metadata,
  chart,
  audioManager,
  className,
  audioData,
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
  // gated in every pane while it's up (see HighwayEditorPane).
  const editingLocked = state.pendingTempoCandidate !== null;

  // ---------------------------------------------------------------------------
  // Sync cursor tick with playback. Chart-wide, so it lives once here
  // rather than once per pane.
  // ---------------------------------------------------------------------------
  const prevIsPlayingRef = useRef(state.isPlaying);
  useEffect(() => {
    const wasPlaying = prevIsPlayingRef.current;
    prevIsPlayingRef.current = state.isPlaying;

    if (!state.isPlaying && wasPlaying && state.chartDoc) {
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
  // Pane list -- ordered by state.visibleTrackKeys insertion order, capped.
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
  // instead, and their piano roll reads it too, so their single pane follows
  // it -- deriving from the reducer-seeded visible set would show whichever
  // track `preferredTrackForChart` picked, out of step with the rest of the
  // page.
  const matrixDrivesPanes = capabilities.showChartMatrix !== false;
  const activeScope = state.activeScope;

  const paneScopes: EditorScope[] = useMemo(() => {
    if (vocalsScope) return [vocalsScope];
    if (!matrixDrivesPanes) return [activeScope];
    return visibleTracks.map(track => ({kind: 'track' as const, track}));
  }, [vocalsScope, matrixDrivesPanes, activeScope, visibleTracks]);

  const panes = paneScopes.slice(0, MAX_HIGHWAY_PANES);
  const overflowCount = Math.max(0, paneScopes.length - MAX_HIGHWAY_PANES);

  if (panes.length === 0) {
    // Reachable through the UI: the matrix lets the user hide every track,
    // including the last one (the approved prototype's "No tracks shown"
    // state).
    return (
      <div
        className={cn(
          'relative flex h-full w-full items-center justify-center rounded-lg border bg-black text-sm text-muted-foreground',
          className,
        )}>
        No tracks shown. Click a difficulty in the Chart Matrix to show it here.
      </div>
    );
  }

  return (
    <div
      className={cn('relative grid h-full w-full gap-2', className)}
      style={{gridTemplateColumns: `repeat(${panes.length}, 1fr)`}}>
      {panes.map(scope => (
        <HighwayEditorPane
          key={scopePaneKey(scope)}
          scope={scope}
          metadata={metadata}
          chart={chart}
          audioManager={audioManager}
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
          className="relative overflow-hidden rounded-lg border bg-black"
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
