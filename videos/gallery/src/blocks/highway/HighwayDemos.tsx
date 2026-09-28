/**
 * The highway blocks on the kit's invented test chart: the app's own
 * renderer as the editor's strip, its smoke check, edits through the
 * editor's commands, and the ways a film sets it into a shot. Sizes are
 * reference px (`unit`) and times seconds, so each block frames the same at
 * any format.
 */
import {useMemo} from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';
import {color, stageBackground} from '@musiccharts/video-kit/brand';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {toFrames, useFormat} from '@musiccharts/video-kit/format';
import {
  editHistory,
  EXPERT_DRUMS,
  EXPERT_GUITAR,
  floorQuad,
  GlassRim,
  HighwayCrop,
  HighwayPlate,
  HighwaySmoke,
  highwayPoint,
  Iris,
  isOnHighway,
  LaneBleed,
  laneOfNoteType,
  moveNotes,
  moveQuad,
  noteIdOf,
  notesBetween,
  paneRects,
  ProductHighway,
  useChartFolder,
  useSplitHighway,
  WarpedHighway,
} from '@musiccharts/video-kit/highway';
import {editFrom, testProbe, useTestChart} from './testChart';

/** Guitar and drums side by side in one stage, as the editor lays out its strip, with the karaoke line. */
export const StripDemo: React.FC = () => {
  const chart = useTestChart();
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ProductHighway
        chart={chart}
        panes={[{track: EXPERT_GUITAR}, {track: EXPERT_DRUMS}]}
        laneLabels
        // Film second 0 plays song second 2: the first sung phrase.
        segments={editFrom(2)}
      />
    </AbsoluteFill>
  );
};

/**
 * A chart folder in the gallery's gitignored public/generated/highway, read
 * the way a film reads its song's chart. Write one with
 * `node --import tsx kit/scripts/highway/link-chart.ts --test-chart --out gallery/public/generated/highway`
 * (or `--chart <folder>` to link a real one).
 */
export const ChartFolderDemo: React.FC = () => {
  const chart = useChartFolder({
    dir: 'generated/highway',
    writtenBy:
      'node --import tsx kit/scripts/highway/link-chart.ts --test-chart --out gallery/public/generated/highway',
  });
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ProductHighway chart={chart} segments={editFrom(10)} />
    </AbsoluteFill>
  );
};

/** When, in the smoke window, the probe note reaches the strikeline. */
const SMOKE_HIT_SEC = 0.75;
/** The smoke window: the approach and a quarter second after the hit. */
export const SMOKE_DEMO_SEC = SMOKE_HIT_SEC + 0.25;

export interface SmokeDemoProps extends Record<string, unknown> {
  failOnError?: boolean;
  /**
   * Draw the highways this many frames off the film's clock, to see the
   * check fail: a render with `--props='{"skewFrames":1}'` must.
   */
  skewFrames?: number;
}

/**
 * The smoke check: the probe snare approaches and lands on the strikeline
 * SMOKE_HIT_SEC into the window; a black or out-of-sync highway fails the
 * render.
 */
export const SmokeDemo: React.FC<SmokeDemoProps> = ({
  failOnError = true,
  skewFrames = 0,
}) => {
  const chart = useTestChart();
  const {fps} = useFormat();
  const hitFrame = Math.round(toFrames(SMOKE_HIT_SEC, fps));
  const probe = useMemo(() => testProbe(chart), [chart]);
  return (
    <HighwaySmoke
      chart={chart}
      probe={probe}
      segments={editFrom(probe.atSec - hitFrame / fps)}
      hitFrame={hitFrame}
      skewFrames={skewFrames}
      failOnError={failOnError}
    />
  );
};

/**
 * Edits through the editor's own commands on the drums: bar 2's notes are
 * selected, dragged a lane left (the editor's live preview), dropped (the
 * move command), then deselected. Rings mark the strikeline lanes and the
 * first selected gem, placed by the app's geometry.
 */
export const EditsDemo: React.FC = () => {
  const chart = useTestChart();
  // The highway plays the song on the global frame; so do the edits and rings.
  const frame = useGlobalFrame();
  const {width, height, fps, unit} = useFormat();
  const songStart = 3;
  const plan = useMemo(() => {
    const at = (sec: number) => Math.round(toFrames(sec, fps));
    const phrase = notesBetween(chart, EXPERT_DRUMS, 4000, 6000).filter(
      n => laneOfNoteType('drums', n.type) !== 'kick',
    );
    const commitAt = at(1.2);
    const history = editHistory(chart, [
      {
        frame: commitAt,
        apply: doc =>
          moveNotes(doc, EXPERT_DRUMS, phrase.map(noteIdOf), {lanes: -1}),
      },
    ]);
    const moved = notesBetween(
      history(commitAt),
      EXPERT_DRUMS,
      4000,
      6000,
    ).filter(n => laneOfNoteType('drums', n.type) !== 'kick');
    return {
      phrase,
      moved,
      history,
      selectFrom: at(0.2),
      dragFrom: at(0.7),
      commitAt,
      deselectAt: at(1.7),
    };
  }, [chart, fps]);
  const committed = frame >= plan.commitAt;
  const selection =
    frame >= plan.selectFrom && frame < plan.deselectAt
      ? committed
        ? plan.moved
        : plan.phrase
      : [];
  const dragging = frame >= plan.dragFrom && !committed;
  const nowSec = songStart + frame / fps;
  const box = {width, height};
  const first = (dragging ? plan.moved : selection)[0];
  const ring = (
    key: string,
    p: {x: number; y: number},
    size: number,
    c: string,
  ) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        left: p.x - size / 2,
        top: p.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `${2 * unit}px solid ${c}`,
      }}
    />
  );
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <ProductHighway
        chart={plan.history(frame)}
        segments={editFrom(songStart)}
        showLyrics={false}
        panes={[
          {
            track: EXPERT_DRUMS,
            selectedNoteIds: selection.map(noteIdOf),
            noteDrag: dragging
              ? {ticks: 0, lanes: -1, noteIds: plan.phrase.map(noteIdOf)}
              : null,
          },
        ]}>
        {(['kick', 'red', 'yellow', 'blue', 'green'] as const).map(lane =>
          ring(
            `lane-${lane}`,
            highwayPoint({box, instrument: 'drums', lane, nowSec}),
            24 * unit,
            'rgba(255,255,255,0.5)',
          ),
        )}
        {first && isOnHighway(first.msTime / 1000, nowSec)
          ? ring(
              'selected',
              highwayPoint({
                box,
                instrument: 'drums',
                lane: laneOfNoteType('drums', first.type),
                atSec: first.msTime / 1000,
                nowSec,
              }),
              44 * unit,
              color.fuchsia,
            )
          : null}
      </ProductHighway>
    </AbsoluteFill>
  );
};

/** A glass panel on the stage: lane light behind, the cropped highway, a rim. */
export const PanelDemo: React.FC = () => {
  const chart = useTestChart();
  const {width, unit} = useFormat();
  const w = 780 * unit;
  const h = 800 * unit;
  const radius = 28 * unit;
  return (
    <AbsoluteFill style={{background: stageBackground}}>
      <div
        style={{
          position: 'absolute',
          left: (width - w) / 2,
          top: 140 * unit,
          width: w,
          height: h,
        }}>
        <LaneBleed
          x={-w * 0.15}
          y={-h * 0.05}
          width={w * 1.3}
          height={h * 1.15}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: radius,
            overflow: 'hidden',
            boxShadow: `0 ${70 * unit}px ${160 * unit}px rgba(0,0,0,0.8)`,
          }}>
          <HighwayCrop
            chart={chart}
            width={w}
            height={h}
            renderHeight={1500 * unit}
            horizonAt={40 * unit}
            segments={editFrom(2)}
          />
        </div>
        <GlassRim radius={radius} />
      </div>
    </AbsoluteFill>
  );
};

/** The full-frame plate, seen through an iris that opens over the stage. */
export const PlateDemo: React.FC = () => {
  const chart = useTestChart();
  const frame = useCurrentFrame();
  const {width, height, fps, unit} = useFormat();
  const at = (sec: number) => toFrames(sec, fps);
  // The iris opens from a point right of centre until it clears the frame.
  const radius = interpolate(
    frame,
    [0, at(0.5), at(0.75)],
    [0, 240 * unit, Math.hypot(width, height)],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: t => t * t},
  );
  const rimOpacity = interpolate(frame, [at(0.53), at(0.75)], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const push = interpolate(frame, [0, at(1.5)], [1.12, 1], {
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{background: color.stage}}>
      <Iris
        cx={0.703 * width}
        cy={0.389 * height}
        radius={radius}
        rim={{opacity: rimOpacity}}>
        <HighwayPlate
          chart={chart}
          segments={editFrom(4)}
          move={{scale: push, rotate: -4 + 2 * push}}
        />
      </Iris>
    </AbsoluteFill>
  );
};

/** The drum floor warped onto another quad: the app's view moved in 2D, scaled down and turned. */
export const WarpedDemo: React.FC = () => {
  const chart = useTestChart();
  const frame = useCurrentFrame();
  const {width, height, fps, unit} = useFormat();
  const t = frame / fps;
  const target = moveQuad(
    {
      scale: 0.55,
      rotate: -10 + 6 * t,
      origin: {x: width / 2, y: height},
      x: 180 * unit,
      y: -120 * unit,
    },
    floorQuad({width, height}, 'drums'),
  );
  return (
    <AbsoluteFill style={{background: stageBackground}}>
      <WarpedHighway chart={chart} target={target} segments={editFrom(6)} />
    </AbsoluteFill>
  );
};

/** One stage's two panes split into canvases of their own that drift apart. */
export const SplitDemo: React.FC = () => {
  const chart = useTestChart();
  const frame = useCurrentFrame();
  const {width, height, fps, unit} = useFormat();
  const regions = useMemo(() => paneRects({width, height}, 2), [width, height]);
  const split = useSplitHighway(regions);
  const apart = interpolate(frame, [0, toFrames(1, fps)], [0, 90 * unit], {
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{background: stageBackground}}>
      {regions.map((r, i) => (
        <canvas
          key={i}
          ref={split.refs[i]}
          style={{
            position: 'absolute',
            left: r.x,
            top: r.y,
            width: r.width,
            height: r.height,
            mixBlendMode: 'lighten',
            transform: `translateX(${(i === 0 ? -1 : 1) * apart}px) rotate(${(i === 0 ? -1 : 1) * (apart / unit) * 0.03}deg)`,
          }}
        />
      ))}
      <ProductHighway
        chart={chart}
        panes={[{track: EXPERT_GUITAR}, {track: EXPERT_DRUMS}]}
        segments={editFrom(8)}
        showLyrics={false}
        onDraw={split.onDraw}
        style={{position: 'absolute', inset: 0, opacity: 0}}
      />
    </AbsoluteFill>
  );
};
