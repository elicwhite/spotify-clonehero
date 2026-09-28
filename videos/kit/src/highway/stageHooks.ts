/**
 * The hooks `ProductHighway` is built from: the app's stage, the panes
 * mounted on it, the karaoke replay, and the hold that keeps Remotion from
 * capturing a frame before the highway has drawn it.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import {cancelRender, continueRender, delayRender} from 'remotion';
import type {ChartDocument} from '@eliwhite/scan-chart';
import {
  setupStage,
  type HighwayStage,
} from '@product/lib/preview/highway/stage';
import type {StageLayout} from '@product/lib/preview/highway/layout';
import {findTrack} from '@product/lib/chart-edit';
import {buildTimedTempos} from '@product/lib/drum-transcription/timing';
import {trackKeyId} from '@product/components/chart-editor/scope';
import {
  drawReplayed,
  type Karaoke,
  type Replay,
  type ReplayTarget,
} from './karaokeReplay';
import {productAssets, type ProductAssets} from './productAssets';
import type {SongPositionInput} from './songPosition';
import {
  gridDataFor,
  PLAYBACK_OVERLAYS,
  SongClock,
  type HighwayPane,
  type MountedPane,
} from './stageSync';

/**
 * Holds the frame (`delayRender`) until the highway has drawn it: from the
 * first render, and again whenever a render finds the highway not ready to
 * draw (the chart, the stage or new panes still on their way; they arrive
 * through a chain of async steps, and a frame captured between two of them
 * would show an empty or stale canvas). The draw releases it.
 */
export const useDrawHold = (): {
  hold: (label: string) => void;
  release: () => void;
} => {
  const [first] = useState(() =>
    delayRender('Drawing the first highway frame'),
  );
  const pending = useRef<number | null>(first);
  const release = () => {
    if (pending.current === null) return;
    continueRender(pending.current);
    pending.current = null;
  };
  // An unmounted highway must not hold the render.
  useLayoutEffect(() => release, []);
  return {
    hold: label => {
      pending.current ??= delayRender(label);
    },
    release,
  };
};

export interface BuiltStage {
  stage: HighwayStage;
  clock: SongClock;
  assets: ProductAssets;
}

/**
 * Whether a stage is the one the component draws on now. The stage in
 * state lags a rebuild by a render (a new `pixelRatio` or `assetsPath`, or
 * Fast Refresh re-running the effect): the old one is already destroyed
 * when the effects of that render run, so they check this first.
 */
export type IsLiveStage = (stage: HighwayStage) => boolean;

/**
 * The app's stage in `hostRef`'s element, built from `chart` the way the
 * editor builds it: at `pixelRatio`, loading the app's art from
 * `assetsPath` through the stage's own loading manager. Destroyed on
 * unmount and on a rebuild. A lost WebGL context fails the render.
 */
export const useHighwayStage = (
  hostRef: RefObject<HTMLDivElement | null>,
  chart: ChartDocument | null,
  pixelRatio: number,
  assetsPath: string | undefined,
): {built: BuiltStage | null; isLive: IsLiveStage} => {
  const [built, setBuilt] = useState<BuiltStage | null>(null);
  const live = useRef<HighwayStage | null>(null);
  const isLive = useCallback<IsLiveStage>(stage => live.current === stage, []);
  useLayoutEffect(() => {
    if (!chart) return;
    const clock = new SongClock();
    const assets = productAssets(assetsPath);
    let stage: HighwayStage;
    try {
      stage = setupStage(chart.parsedChart, hostRef, hostRef, () => clock, {
        pixelRatio,
        loadingManager: assets.manager,
      });
    } catch (error) {
      cancelRender(error);
      return;
    }
    const stopWatching = stage.onContextLost(() =>
      cancelRender(new Error("[highway] the app's WebGL context was lost")),
    );
    live.current = stage;
    setBuilt({stage, clock, assets});
    return () => {
      live.current = null;
      stopWatching();
      setBuilt(null);
      stage.destroy();
    };
  }, [hostRef, chart, pixelRatio, assetsPath]);
  return {built, isLive};
};

export interface MountedPanes {
  stage: HighwayStage;
  /** The pane ids, left to right, joined: what was mounted. */
  key: string;
  layout: StageLayout;
  panes: MountedPane[];
}

/** The ids of the panes, as the editor names its highways. */
export const paneKeyOf = (panes: readonly HighwayPane[]): string =>
  panes.map(pane => trackKeyId(pane.track)).join('|');

/**
 * The panes on the stage, left to right, once each is mounted with what the
 * editor gives a highway (its track, the layout, the tempo map, the grid and
 * the playback overlays); null until they are. Panes that leave the list
 * are removed from the stage. A mount still running when its stage is
 * replaced stops quietly (the stage it mounted on is gone).
 */
export const useHighwayPanes = (
  built: BuiltStage | null,
  isLive: IsLiveStage,
  chart: ChartDocument | null,
  panes: readonly HighwayPane[],
  layout: StageLayout,
): MountedPanes | null => {
  const key = paneKeyOf(panes);
  const [mounted, setMounted] = useState<MountedPanes | null>(null);
  const onStage = useRef<{stage: HighwayStage; ids: string[]} | null>(null);

  useLayoutEffect(() => {
    if (!built || !chart || !isLive(built.stage)) return;
    const {stage, assets} = built;
    let cancelled = false;
    const stale = () => cancelled || !isLive(stage);
    // `panes` is read for its tracks, which `key` spells out.
    const wanted = panes.map(pane => ({
      id: trackKeyId(pane.track),
      track: pane.track,
    }));
    (async () => {
      const mountedPanes = await Promise.all(
        wanted.map(async ({id, track}): Promise<MountedPane> => {
          const data = findTrack(chart, track)?.track;
          if (!data)
            throw new Error(
              `[highway] the chart has no ${track.instrument} ${track.difficulty} track`,
            );
          const handle = await stage.addHighway(id, {
            track: data,
            showDrumLanes: true,
          });
          if (!handle)
            throw new Error(`[highway] the ${id} highway did not mount`);
          return {
            handle,
            reconciler: await handle.getReconciler(),
            pushed: {chart: null, drag: '', selection: '', hover: null},
          };
        }),
      );
      if (stale()) return;
      const failed = assets.failures();
      if (failed.length > 0)
        throw new Error(
          `[highway] the app's art did not load (the app would draw placeholders): ${failed.slice(0, 5).join(', ')}`,
        );
      const ids = wanted.map(pane => pane.id);
      if (onStage.current?.stage === stage)
        for (const id of onStage.current.ids)
          if (!ids.includes(id)) stage.removeHighway(id);
      onStage.current = {stage, ids};
      stage.setLayout(layout, ids);
      const parsed = chart.parsedChart;
      stage.setTimingData(
        buildTimedTempos(parsed.tempos, parsed.resolution),
        parsed.resolution,
      );
      const grid = gridDataFor(chart);
      await Promise.all(
        mountedPanes.map(pane => pane.handle.setGridData(grid)),
      );
      if (stale()) return;
      for (const pane of mountedPanes) {
        pane.handle.setHighwayMode('classic');
        pane.handle.setOverlayState(PLAYBACK_OVERLAYS);
      }
      setMounted({stage, key, layout, panes: mountedPanes});
    })().catch((error: unknown) => {
      if (!stale()) cancelRender(error);
    });
    return () => {
      cancelled = true;
    };
  }, [built, isLive, chart, key, layout]);

  return mounted &&
    mounted.stage === built?.stage &&
    mounted.key === key &&
    mounted.layout === layout
    ? mounted
    : null;
};

/**
 * Draws a frame the way the app's playback would have (`drawReplayed`),
 * carrying where the replay got to from one frame to the next. Returns the
 * song second drawn. A failed draw starts the next one from scratch.
 */
export const useKaraokeReplay = (): ((
  target: ReplayTarget,
  owner: unknown,
  karaoke: Karaoke,
  input: SongPositionInput,
) => number) => {
  const replay = useRef<Replay | null>(null);
  return useCallback((target, owner, karaoke, input) => {
    const previous = replay.current;
    replay.current = null;
    const drawn = drawReplayed(target, owner, karaoke, input, previous);
    replay.current = drawn.replay;
    return drawn.songSec;
  }, []);
};
