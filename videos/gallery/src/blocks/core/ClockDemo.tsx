/**
 * Clock and music: a tempo-only timeline, a three-scene storyboard on its
 * bars, and a beat meter pulsing on every beat. Built from the composition's
 * own fps, so every variant lands on the same beats.
 */
import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import {
  color,
  fontFamily,
  lane,
  stageBackground,
} from '@musiccharts/video-kit/brand';
import {
  defineStoryboard,
  FilmClock,
  SceneWindow,
  useGlobalFrame,
  useHitPulse,
  useScene,
} from '@musiccharts/video-kit/clock';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  beatGrid,
  tempoTimeline,
  TimelineProvider,
  useTimeline,
} from '@musiccharts/video-kit/music';

const BPM = 120;
/** Six bars at 120 BPM. */
export const CLOCK_DEMO_SEC = 12;

/** Three scenes of two bars each (a bar is 2 s at 120 BPM). */
const storyboardAt = (fps: number) =>
  defineStoryboard([
    {id: 'intro', from: 0, to: 4 * fps, bar: 0, tint: lane.blue},
    {id: 'feature', from: 4 * fps, to: 8 * fps, bar: 2, tint: lane.yellow},
    {id: 'outro', from: 8 * fps, to: 12 * fps, bar: 4, tint: lane.green},
  ]);

const SceneCard: React.FC<{label: string; tint: string}> = ({label, tint}) => {
  const {unit, width, height} = useFormat();
  const scene = useScene();
  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.1,
        top: height * 0.2,
        width: width * 0.8,
        height: height * 0.35,
        boxSizing: 'border-box',
        borderRadius: 16 * unit,
        border: `${2 * unit}px solid ${tint}`,
        background: color.glass,
        padding: 40 * unit,
        fontFamily: fontFamily.mono,
        color: color.text,
        fontSize: 32 * unit,
      }}>
      <div style={{fontSize: 56 * unit, fontFamily: fontFamily.sans}}>
        {label}
      </div>
      <div>
        film {scene.frame} / local {scene.local} of {scene.durationInFrames}
      </div>
      <div
        style={{
          marginTop: 24 * unit,
          height: 8 * unit,
          width: `${scene.progress * 100}%`,
          background: tint,
        }}
      />
    </div>
  );
};

const BeatMeter: React.FC = () => {
  const {unit, height} = useFormat();
  const tl = useTimeline();
  const frame = useGlobalFrame();
  const beatFrames = useMemo(() => tl.beats.map(b => b.frame), [tl]);
  const pulse = useHitPulse(beatFrames, 0.25);
  const current = tl.beatAt(frame);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: height * 0.7,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24 * unit,
        fontFamily: fontFamily.mono,
        color: color.muted,
        fontSize: 28 * unit,
      }}>
      {[0, 1, 2, 3].map(beat => (
        <div
          key={beat}
          style={{
            width: 48 * unit,
            height: 48 * unit,
            borderRadius: 999,
            background: current?.beat === beat ? lane.kick : color.hairline,
            transform: `scale(${current?.beat === beat ? 1 + pulse * 0.4 : 1})`,
          }}
        />
      ))}
      <div style={{width: 120 * unit}}>
        {current ? `${current.bar + 1}.${current.beat + 1}` : '-'}
      </div>
    </div>
  );
};

const StoryboardCheck: React.FC<{problems: string[]}> = ({problems}) => {
  const {unit, height, safe} = useFormat();
  return (
    <div
      style={{
        position: 'absolute',
        left: safe.x,
        bottom: height - (safe.y + safe.height),
        fontFamily: fontFamily.mono,
        fontSize: 22 * unit,
        color: problems.length === 0 ? color.emerald : lane.red,
      }}>
      {problems.length === 0
        ? 'storyboard on the beat grid'
        : problems.join('; ')}
    </div>
  );
};

export const ClockDemo: React.FC = () => {
  const {fps} = useFormat();
  const timeline = useMemo(
    () => tempoTimeline({bpm: BPM, durationSec: CLOCK_DEMO_SEC, fps}),
    [fps],
  );
  const board = useMemo(() => storyboardAt(fps), [fps]);
  const problems = useMemo(() => {
    const grid = beatGrid(timeline);
    return board.checkStoryboard(bar => grid.frameOfBeat(bar));
  }, [board, timeline]);
  return (
    <TimelineProvider timeline={timeline}>
      <FilmClock>
        <AbsoluteFill style={{background: stageBackground}}>
          {board.scenes.map(scene => (
            <SceneWindow key={scene.id} {...board.window(scene.id)}>
              <SceneCard label={scene.id} tint={scene.tint} />
            </SceneWindow>
          ))}
          <BeatMeter />
          <StoryboardCheck problems={problems} />
        </AbsoluteFill>
      </FilmClock>
    </TimelineProvider>
  );
};
