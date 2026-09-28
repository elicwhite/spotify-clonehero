/**
 * What `ProductHighway` pushes into the app's stage, done the way the chart
 * editor does it: its playback clock, its overlay state during playback, the
 * grid, each pane's elements, selection and hover, and the karaoke lines.
 */
import type {ChartDocument} from '@eliwhite/scan-chart';
import type {
  GridData,
  StageClock,
  StageHighwayHandle,
} from '@product/lib/preview/highway/stage';
import type {OverlayState} from '@product/lib/preview/highway/SceneOverlays';
import type {SceneReconciler} from '@product/lib/preview/highway/SceneReconciler';
import {reconcilerKeyFor} from '@product/lib/preview/highway/reconcilerKey';
import {DEFAULT_VOCALS_PART} from '@product/lib/chart-edit';
import type {TimedTempo} from '@product/lib/drum-transcription/chart-types';
import {DRUM_EDIT_CAPABILITIES} from '@product/components/chart-editor/capabilities';
import {trackQualifiedNoteId} from '@product/components/chart-editor/scope';
import {computeChartElements} from '@product/components/chart-editor/highway/useChartElements';
import type {TrackRef} from './editing';
import type {Karaoke} from './karaokeReplay';

export interface HighwayPane {
  /** The track this highway shows. */
  track: TrackRef;
  /** Notes drawn with the editor's selection highlight (ids from `noteIdOf`). */
  selectedNoteIds?: readonly string[];
  /** The note under the pointer, drawn with the editor's hover highlight. */
  hoveredNoteId?: string | null;
  /**
   * A note drag in progress: the listed notes follow it before the move
   * lands, exactly as the editor previews a drag. Lanes are pad lanes.
   */
  noteDrag?: {ticks: number; lanes: number; noteIds: readonly string[]} | null;
}

/**
 * What the editor pushes to a highway's overlays while the transport plays:
 * no cursor line, no tick label, no placement ghosts.
 */
export const PLAYBACK_OVERLAYS: OverlayState = {
  cursorTick: -1,
  isPlaying: true,
  activeTool: 'cursor',
  hoverLane: null,
  hoverTick: null,
  loopRegion: null,
};

/**
 * The playback clock the stage reads (the members of the app's AudioManager
 * it uses). `chartTime` is the song time of the frame being drawn. It reports
 * not playing on purpose: that flag only gates the stage's own animation loop
 * (latency compensation, keep-awake, and a wall-clock texture tick), and
 * `renderFrame` draws the playback picture itself. If the loop draws while a
 * frame is up, it draws the same time with the same textures.
 */
export class SongClock implements StageClock {
  chartTime = 0;
  readonly delay = 0;
  readonly chartDelay = 0;
  readonly isPlaying = false;
  readonly isInitialized = true;
}

export interface MountedPane {
  handle: StageHighwayHandle;
  reconciler: SceneReconciler;
  /** Inputs last pushed to the reconciler, so unchanged frames push nothing. */
  pushed: {
    chart: ChartDocument | null;
    drag: string;
    selection: string;
    hover: string | null;
  };
}

/** The grid the editor gives each highway: the chart's tempo map and its length. */
export const gridDataFor = (doc: ChartDocument): GridData => {
  const chart = doc.parsedChart;
  let lastNoteMs = 0;
  for (const track of chart.trackData) {
    for (const group of track.noteEventGroups) {
      for (const note of group)
        lastNoteMs = Math.max(lastNoteMs, note.msTime + note.msLength);
    }
  }
  return {
    tempos: chart.tempos.map(({tick, beatsPerMinute}) => ({
      tick,
      beatsPerMinute,
    })),
    timeSignatures: chart.timeSignatures.map(
      ({tick, numerator, denominator}) => ({tick, numerator, denominator}),
    ),
    resolution: chart.resolution,
    // The editor passes the audio's length; the chart's own is the same span.
    durationMs: Math.max(chart.metadata.song_length ?? 0, lastNoteMs),
  };
};

/** Push one pane's editor state to its reconciler, the way `useChartElements` does. */
export const pushPaneState = (
  mounted: MountedPane,
  pane: HighwayPane,
  doc: ChartDocument,
  timedTempos: TimedTempo[],
): void => {
  const {reconciler, pushed} = mounted;
  const drag = pane.noteDrag;
  const dragKey = drag
    ? `${drag.ticks}|${drag.lanes}|${drag.noteIds.join(',')}`
    : '';
  if (pushed.chart !== doc || pushed.drag !== dragKey) {
    reconciler.setElements(
      computeChartElements({
        chart: doc.parsedChart,
        activeScope: {kind: 'track', track: pane.track},
        capabilities: DRUM_EDIT_CAPABILITIES,
        noteDrag: drag
          ? {
              tickDelta: drag.ticks,
              laneDelta: drag.lanes,
              ids: new Set(
                drag.noteIds.map(id => trackQualifiedNoteId(pane.track, id)),
              ),
            }
          : null,
        timedTempos,
        resolution: doc.parsedChart.resolution,
      }),
    );
    pushed.chart = doc;
    pushed.drag = dragKey;
  }
  const selected = pane.selectedNoteIds ?? [];
  const selectionKey = selected.join(',');
  if (pushed.selection !== selectionKey) {
    reconciler.setSelectedKeys(
      new Set(selected.map(id => reconcilerKeyFor('note', id))),
    );
    pushed.selection = selectionKey;
  }
  const hover = pane.hoveredNoteId ?? null;
  if (pushed.hover !== hover) {
    reconciler.setHoveredKey(
      hover === null ? null : reconcilerKeyFor('note', hover),
    );
    pushed.hover = hover;
  }
};

/**
 * The chart's karaoke lines as the editor's `useStageSync` gives them to the
 * stage, or none.
 */
export const karaokeOf = (
  doc: ChartDocument | null,
  showLyrics: boolean,
): Karaoke => {
  const vocals = showLyrics
    ? doc?.parsedChart.vocalTracks?.parts?.[DEFAULT_VOCALS_PART]
    : undefined;
  return {
    lyrics: vocals?.notePhrases.flatMap(phrase => phrase.lyrics) ?? [],
    phrases:
      vocals?.notePhrases.map(phrase => ({
        msTime: phrase.msTime,
        msLength: phrase.msLength,
      })) ?? [],
  };
};
