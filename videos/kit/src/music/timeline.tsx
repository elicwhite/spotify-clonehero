/**
 * The timeline in React: `<TimelineProvider>` takes a timeline object or the
 * path of timeline.json in public/ (plus optional peaks and envelopes, each
 * an object or a path), loads what it must before the frame renders, and
 * exposes the
 * `TimelineApi` through `useTimeline()`.
 *
 * Never hand-type seconds for a musical event: ask the timeline
 * (`tl.frameOfBeat(bar, beat)`, `tl.hitFrames.kick`, ...).
 */
import {createContext, useContext, useMemo, type ReactNode} from 'react';
import {useVideoConfig} from 'remotion';
import {loadJson, useLoaded} from '../load';
import {buildTimelineApi, type TimelineApi} from './api';
import type {Envelopes, Peaks, Timeline} from './contract';
import {assertTimeline} from './validate';

/** Fetch timeline.json from its path in public/ and check it against the contract. */
export const loadTimeline = async (
  path: string,
  opts: {writtenBy?: string} = {},
): Promise<Timeline> =>
  assertTimeline(await loadJson(path, opts), `public/${path}`);

const TimelineContext = createContext<TimelineApi | null>(null);

export type TimelineProviderProps = {
  /** Peaks, or the path of peaks.json in public/. */
  peaks?: Peaks | string;
  /** Envelopes, or the path of envelopes.json in public/. */
  envelopes?: Envelopes | string;
  /** What writes the files, named when one is missing. */
  writtenBy?: string;
  children?: ReactNode;
} & (
  | {/** The timeline itself. */ timeline: Timeline; src?: undefined}
  | {
      /** The path of timeline.json in public/. */ src: string;
      timeline?: undefined;
    }
);

/** The composition must run at the timeline's frame rate, or every cue lands on the wrong frame. */
const useCheckedFps = (api: TimelineApi | null): TimelineApi | null => {
  const {fps} = useVideoConfig();
  if (api && api.fps !== fps) {
    throw new Error(
      `[timeline] the timeline is at ${api.fps} fps but the composition runs at ${fps} fps; build the timeline at the composition's rate`,
    );
  }
  return api;
};

const InlineTimeline: React.FC<{
  timeline: Timeline;
  peaks: Peaks | undefined;
  envelopes: Envelopes | undefined;
  children?: ReactNode;
}> = ({timeline, peaks, envelopes, children}) => {
  const api = useMemo(
    () =>
      buildTimelineApi(assertTimeline(timeline, 'The timeline'), {
        peaks,
        envelopes,
      }),
    [timeline, peaks, envelopes],
  );
  return (
    <TimelineContext.Provider value={useCheckedFps(api)}>
      {children}
    </TimelineContext.Provider>
  );
};

/** The parts given as paths, once loaded. */
interface LoadedParts {
  timeline?: Timeline;
  peaks?: Peaks;
  envelopes?: Envelopes;
}

const LoadedTimeline: React.FC<{
  timeline: Timeline | string;
  peaks: Peaks | string | undefined;
  envelopes: Envelopes | string | undefined;
  writtenBy: string | undefined;
  children?: ReactNode;
}> = ({timeline, peaks, envelopes, writtenBy, children}) => {
  const paths = [timeline, peaks, envelopes].filter(
    (v): v is string => typeof v === 'string',
  );
  const loaded = useLoaded<LoadedParts>(
    `timeline|${paths.join('|')}`,
    async () => {
      const opts = {writtenBy};
      const [tl, p, e] = await Promise.all([
        typeof timeline === 'string' ? loadTimeline(timeline, opts) : undefined,
        typeof peaks === 'string' ? loadJson<Peaks>(peaks, opts) : undefined,
        typeof envelopes === 'string'
          ? loadJson<Envelopes>(envelopes, opts)
          : undefined,
      ]);
      return {timeline: tl, peaks: p, envelopes: e};
    },
    `Loading ${paths.join(', ')}`,
  );
  const api = useMemo(() => {
    if (!loaded) return null;
    const tl = typeof timeline === 'string' ? loaded.timeline : timeline;
    if (!tl) return null;
    return buildTimelineApi(
      tl === timeline ? assertTimeline(tl, 'The timeline') : tl,
      {
        peaks: typeof peaks === 'string' ? loaded.peaks : peaks,
        envelopes: typeof envelopes === 'string' ? loaded.envelopes : envelopes,
      },
    );
  }, [loaded, timeline, peaks, envelopes]);
  const checked = useCheckedFps(api);
  if (!checked) return null;
  return (
    <TimelineContext.Provider value={checked}>
      {children}
    </TimelineContext.Provider>
  );
};

/**
 * Provides the timeline API to its subtree. Inline objects are used as they
 * are; paths are loaded once per page while the frame waits, and a missing
 * or malformed file fails the render with its path. The innermost provider
 * wins.
 */
export const TimelineProvider: React.FC<TimelineProviderProps> = ({
  timeline,
  src,
  peaks,
  envelopes,
  writtenBy,
  children,
}) => {
  const source = timeline ?? src;
  if (
    typeof source === 'string' ||
    typeof peaks === 'string' ||
    typeof envelopes === 'string'
  ) {
    return (
      <LoadedTimeline
        timeline={source}
        peaks={peaks}
        envelopes={envelopes}
        writtenBy={writtenBy}>
        {children}
      </LoadedTimeline>
    );
  }
  return (
    <InlineTimeline timeline={source} peaks={peaks} envelopes={envelopes}>
      {children}
    </InlineTimeline>
  );
};

/** The timeline API. Throws without a <TimelineProvider> above. */
export const useTimeline = (): TimelineApi => {
  const api = useContext(TimelineContext);
  if (!api) {
    throw new Error(
      '[timeline] useTimeline() needs a <TimelineProvider> above it',
    );
  }
  return api;
};

/** The timeline API, or null without a provider: for blocks that work either way. */
export const useOptionalTimeline = (): TimelineApi | null =>
  useContext(TimelineContext);
