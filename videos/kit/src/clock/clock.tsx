/**
 * Film time. Scenes are authored in GLOBAL film frames, so a scene reads the
 * same inside the full film and on its own as a preview composition.
 *
 * - `<FilmClock>` marks a composition as (a window of) the film: composition
 *   frame 0 is film frame `offset`, and the soundtrack, if given, plays from
 *   there. The full film uses offset 0.
 * - `<SceneWindow from durationInFrames>` places a scene. Under a FilmClock
 *   it is a Sequence at the right spot. With no FilmClock above it (a
 *   scene's own preview composition) it is its own clock: composition frame
 *   0 is `from`, and it plays the matching slice of `audio`.
 * - `useGlobalFrame()` is the film frame anywhere below either of them, even
 *   inside nested Sequences. `useCurrentFrame()` keeps its local meaning.
 */
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  Audio,
  Freeze,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {publicUrl} from '../load';

interface Clock {
  /** Film frame at composition frame 0. */
  offset: number;
  /** Current film frame for this subtree. */
  frame: number;
}

const ClockContext = createContext<Clock | null>(null);

interface SceneInfo {
  from: number;
  durationInFrames: number;
  standalone: boolean;
}

const SceneContext = createContext<SceneInfo | null>(null);

/** The film frame. Works at any depth under a FilmClock or SceneWindow; elsewhere it is the composition frame. */
export const useGlobalFrame = (): number => {
  const local = useCurrentFrame();
  const clock = useContext(ClockContext);
  return clock ? clock.frame : local;
};

export interface FilmClockProps {
  /** Film frame shown at composition frame 0. Default 0. */
  offset?: number;
  /** The soundtrack's path in public/ ('generated/audio/mix.wav'); it plays from `offset`. */
  src?: string;
  volume?: number | ((frame: number) => number);
  children?: ReactNode;
}

/** Put this at the root of a composition that shows the film or a window of it, outside any Sequence. */
export const FilmClock: React.FC<FilmClockProps> = ({
  offset = 0,
  src,
  volume = 1,
  children,
}) => {
  const frame = useCurrentFrame();
  const value = useMemo<Clock>(
    () => ({offset, frame: frame + offset}),
    [offset, frame],
  );
  return (
    <ClockContext.Provider value={value}>
      {src ? (
        <Audio src={publicUrl(src)} trimBefore={offset} volume={volume} />
      ) : null}
      {children}
    </ClockContext.Provider>
  );
};

export interface SceneWindowProps {
  /** Film frame where the scene starts. */
  from: number;
  durationInFrames: number;
  children?: ReactNode;
  /** Label in the Studio's timeline. */
  name?: string;
  /** Standalone only: the soundtrack's path in public/; the scene plays its slice from `from`. */
  audio?: string;
  /** Under a FilmClock only: mount this many frames early (asset loading). */
  premountFor?: number;
  style?: CSSProperties;
}

/** A 2-frame fade, so a preview never starts with a click. */
const fadeIn = (f: number) => Math.min(1, f / 2);

const StandaloneScene: React.FC<SceneWindowProps> = ({
  from,
  durationInFrames,
  children,
  name,
  audio,
  style,
}) => {
  const frame = useCurrentFrame();
  const clock = useMemo<Clock>(
    () => ({offset: from, frame: frame + from}),
    [from, frame],
  );
  const info = useMemo<SceneInfo>(
    () => ({from, durationInFrames, standalone: true}),
    [from, durationInFrames],
  );
  return (
    <ClockContext.Provider value={clock}>
      {audio ? (
        <Audio src={publicUrl(audio)} trimBefore={from} volume={fadeIn} />
      ) : null}
      <SceneContext.Provider value={info}>
        <Sequence
          from={0}
          durationInFrames={durationInFrames}
          name={name ?? `Scene @${from}`}
          style={style}>
          {children}
        </Sequence>
      </SceneContext.Provider>
    </ClockContext.Provider>
  );
};

/**
 * A scene's window in film frames. Inside, `useCurrentFrame()` counts from
 * the scene's start and `useGlobalFrame()` is the film frame.
 */
export const SceneWindow: React.FC<SceneWindowProps> = props => {
  const clock = useContext(ClockContext);
  const {from, durationInFrames, children, name, premountFor, style} = props;
  const info = useMemo<SceneInfo>(
    () => ({from, durationInFrames, standalone: false}),
    [from, durationInFrames],
  );
  if (!clock) return <StandaloneScene {...props} />;
  return (
    <SceneContext.Provider value={info}>
      <Sequence
        from={from - clock.offset}
        durationInFrames={durationInFrames}
        name={name ?? `Scene @${from}`}
        premountFor={premountFor}
        style={style}>
        {children}
      </Sequence>
    </SceneContext.Provider>
  );
};

export interface SceneState {
  from: number;
  durationInFrames: number;
  /** First frame after the scene. */
  end: number;
  /** Current film frame. */
  frame: number;
  /** Frames since the scene started. */
  local: number;
  /** 0..1 across the scene. */
  progress: number;
  /** True when the scene is its own clock (a preview), or when there is no SceneWindow. */
  standalone: boolean;
}

/** The enclosing SceneWindow's range and where the frame is in it; without one, the whole composition. */
export const useScene = (): SceneState => {
  const info = useContext(SceneContext);
  const frame = useGlobalFrame();
  const {durationInFrames: compDuration} = useVideoConfig();
  const from = info?.from ?? 0;
  const durationInFrames = info?.durationInFrames ?? compDuration;
  return {
    from,
    durationInFrames,
    end: from + durationInFrames,
    frame,
    local: frame - from,
    progress: Math.min(1, Math.max(0, (frame - from) / durationInFrames)),
    standalone: info?.standalone ?? true,
  };
};

/**
 * Renders its children `by` frames later (or earlier, negative) in film
 * time, shifting `useCurrentFrame()` too (through Freeze). Every kit block
 * follows it, which is what sampled motion blur is built on. Never put audio
 * inside.
 */
export const TimeShift: React.FC<{by: number; children?: ReactNode}> = ({
  by,
  children,
}) => {
  const local = useCurrentFrame();
  const clock = useContext(ClockContext);
  const value = useMemo<Clock>(
    () => ({
      offset: clock?.offset ?? 0,
      frame: (clock ? clock.frame : local) + by,
    }),
    [clock, local, by],
  );
  return (
    <ClockContext.Provider value={value}>
      <Freeze frame={local + by}>{children}</Freeze>
    </ClockContext.Provider>
  );
};
