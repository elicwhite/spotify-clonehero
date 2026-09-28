/**
 * The ui area's blocks, cued in seconds. Each names the moment worth looking
 * at in its comment (the still the gallery renders).
 */
import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import {BrandStage, color, lane} from '@musiccharts/video-kit/brand';
import {
  PlaneView,
  project,
  restPose,
  useLens,
  type Pose,
} from '@musiccharts/video-kit/camera';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {useFormat} from '@musiccharts/video-kit/format';
import {inOutCubic, rng, wave, type Point} from '@musiccharts/video-kit/motion';
import {
  BeatMarker,
  Callout,
  ChapterSlate,
  Chip,
  ClickRing,
  Cursor,
  Eyebrow,
  Leader,
  PlaneFlash,
  PlaneRing,
  Playhead,
  Waveform,
  clipPeaks,
  peakMax,
} from '@musiccharts/video-kit/ui';
import {
  BlockLabel,
  DEMO_BOXES,
  DEMO_PLANE,
  DemoPlane,
  Row,
} from '../visualShared';

/**
 * A scripted cursor: arcs between keys, a click at 0.67 s, a drag from 1.17
 * to 1.67 s, a light arrow on a straight eased path. Stills: 0.57 s
 * (moving), 0.73 s (click).
 */
export const CursorBlock: React.FC = () => {
  const {width: w, height: h, fps} = useFormat();
  const s = (sec: number) => sec * fps;
  return (
    <BrandStage>
      <Cursor
        path={[
          {at: s(0.17), x: 0.8 * w, y: 0.8 * h},
          {at: s(0.63), x: 0.45 * w, y: 0.4 * h},
          {at: s(1.17), x: 0.5 * w, y: 0.45 * h},
          {at: s(1.67), x: 0.62 * w, y: 0.45 * h},
        ]}
        clicks={[s(0.67)]}
        drags={[[s(1.17), s(1.67)]]}
        visible={[{appearAt: s(0.07)}]}
        rippleColor={lane.blue}
      />
      <Cursor
        look="light"
        path={[
          {at: s(0.17), x: 0.15 * w, y: 0.3 * h, ease: inOutCubic, arc: 0},
          {at: s(0.67), x: 0.3 * w, y: 0.7 * h, ease: inOutCubic, arc: 0},
        ]}
        clicks={[s(0.73)]}
        rippleColor={color.fuchsia}
      />
      <BlockLabel text="ui / Cursor (dark scripted, light straight)" />
    </BrandStage>
  );
};

/** Click rings: the default, a wide ring around a label, no core, at 0.5 s. Still: 0.6 s. */
export const ClickRingBlock: React.FC = () => {
  const {width, height, unit, fps} = useFormat();
  const at = 0.5 * fps;
  return (
    <BrandStage>
      <ClickRing x={width * 0.25} y={height / 2} at={at} />
      <div
        style={{
          position: 'absolute',
          left: width / 2,
          top: height / 2,
          transform: 'translate(-50%, -50%)',
        }}>
        <Chip label="Install" accent={color.emerald} size="lg" />
      </div>
      <ClickRing
        x={width / 2}
        y={height / 2}
        at={at}
        from={90 * unit}
        to={220 * unit}
        color={color.emerald}
        core={0}
      />
      <ClickRing x={width * 0.75} y={height / 2} at={at} color={lane.blue} />
      <BlockLabel text="ui / ClickRing at 0.5 s" />
    </BrandStage>
  );
};

/**
 * Callouts onto a tilted, slowly turning plane, every anchor a plane point
 * projected through the camera: a box label drawn from the label end, a
 * plain label drawn from the anchor, and a bare leader with corners.
 * Still: 1 s.
 */
export const CalloutBlock: React.FC = () => {
  const f = useGlobalFrame();
  const fmt = useFormat();
  const {width, height, unit, fps} = fmt;
  const lens = useLens();
  const s = (sec: number) => sec * fps;
  const scale = 0.62 * unit;
  const pose: Pose = {
    ...restPose(fmt, {x: DEMO_PLANE.width / 2, y: DEMO_PLANE.height / 2}),
    sx: width * 0.42 + (DEMO_PLANE.width / 2) * scale,
    sy: height * 0.18 + (DEMO_PLANE.height / 2) * scale,
    s: scale,
    rx: 6,
    ry: -12 + 2 * wave(f / fps, 6),
    rz: 1,
  };
  const onScreen = (p: Point): Point => project(pose, lens, p);
  const button = DEMO_BOXES.button;
  const row = DEMO_BOXES.row(2);
  const buttonAt = onScreen({
    x: button.x + 20,
    y: button.y + button.height / 2,
  });
  const rowAt = onScreen({x: row.x + 10, y: row.y + row.height / 2});
  const sidebarAt = onScreen({x: 160, y: 272});
  return (
    <BrandStage>
      <PlaneView
        pose={pose}
        lens={lens}
        width={DEMO_PLANE.width}
        height={DEMO_PLANE.height}
        style={{borderRadius: 18}}>
        <DemoPlane />
      </PlaneView>
      <Callout
        at={s(0.17)}
        anchor={buttonAt}
        label={{x: width * 0.3, y: height * 0.12}}
        via={[{x: width * 0.52, y: height * 0.12}]}>
        One click.
      </Callout>
      <Callout
        at={s(0.27)}
        from="anchor"
        look="plain"
        anchor={rowAt}
        label={{x: width * 0.3, y: rowAt.y}}>
        Every score shows its work
      </Callout>
      <Leader
        at={s(0.37)}
        color={lane.yellow}
        anchor={sidebarAt}
        label={{x: width * 0.1, y: height * 0.8}}
        via={[{x: width * 0.3, y: height * 0.8}]}
      />
      <BlockLabel text="ui / Callout + Leader onto project(pose, lens, point)" />
    </BrandStage>
  );
};

/** A ring and a state flash drawn inside a tilted plane, from 1/3 s. Still: 0.57 s. */
export const PlaneMarksBlock: React.FC = () => {
  const fmt = useFormat();
  const {fps} = fmt;
  const lens = useLens();
  const pose = {
    ...restPose(fmt, {x: 720, y: 450}),
    sx: fmt.cx,
    sy: fmt.cy,
    s: 0.85 * fmt.unit,
    rx: 10,
    ry: -14,
    rz: 1.5,
  };
  return (
    <BrandStage>
      <PlaneView
        pose={pose}
        lens={lens}
        width={DEMO_PLANE.width}
        height={DEMO_PLANE.height}
        overlay={
          <>
            <PlaneRing at={fps / 3} box={DEMO_BOXES.sidebarItem} />
            <PlaneRing
              at={0.4 * fps}
              box={DEMO_BOXES.row(3)}
              color={lane.yellow}
            />
            <PlaneFlash at={0.43 * fps} box={DEMO_BOXES.button} />
          </>
        }>
        <DemoPlane />
      </PlaneView>
      <BlockLabel text="ui / PlaneRing + PlaneFlash (inside a PlaneView)" />
    </BrandStage>
  );
};

/** Chips: sizes, accents, a highlight. Still: any moment. */
export const ChipBlock: React.FC = () => (
  <BrandStage>
    <Row gap={30}>
      <Chip label="120 BPM" size="sm" />
      <Chip label="4/4" accent={lane.blue} />
      <Chip label="Expert" accent={lane.green} size="lg" />
      <Chip label="Ctrl+Z" shape="rounded" lead={null} />
      <Chip label="On the beat" accent={lane.yellow} highlight={1} size="lg" />
    </Row>
    <BlockLabel text="ui / Chip" />
  </BrandStage>
);

/** Three eyebrows, typed, decoded and slid up, from 1/6 s. Stills: 0.67 s (mid), 2 s (rest). */
export const EyebrowBlock: React.FC = () => {
  const {unit, width, fps} = useFormat();
  const x = width * 0.3;
  const at = fps / 6;
  return (
    <BrandStage>
      <Eyebrow
        text="Tempo map"
        accent={lane.blue}
        x={x}
        y={360 * unit}
        enterAt={at}
      />
      <Eyebrow
        text="Drum transcription"
        accent={lane.yellow}
        x={x}
        y={500 * unit}
        enterAt={at}
        enter="decode"
        tone="accent"
      />
      <Eyebrow
        text="Lyric sync"
        accent={lane.kick}
        x={x}
        y={640 * unit}
        enterAt={at}
        enter="mask"
        tone="text"
      />
      <BlockLabel text="ui / Eyebrow (type, decode, mask)" />
    </BrandStage>
  );
};

/**
 * A slate over a busy plane with a scrim, entering at 1/6 s and leaving at
 * 3.33 s. It stays inside the title-safe box in every format. Stills: 2.5 s,
 * 3.53 s (leaving).
 */
export const ChapterSlateBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  return (
    <BrandStage accent={lane.yellow}>
      <AbsoluteFill
        style={{
          transform: `translate(${520 * unit}px, ${260 * unit}px) scale(${0.9 * unit})`,
          transformOrigin: '0 0',
          opacity: 0.8,
        }}>
        <DemoPlane />
      </AbsoluteFill>
      <ChapterSlate
        accent={lane.yellow}
        eyebrow="Drum transcription"
        headline="Turn a song into a first-pass drum chart"
        caption="A trained model listens to the audio and proposes every note."
        enterAt={fps / 6}
        exitAt={(10 / 3) * fps}
        scrim={1}
      />
    </BrandStage>
  );
};

/** Synthetic peaks: a steady pulse with a louder middle, 100 bins per second for 20 s. */
const usePeaks = (): number[] =>
  useMemo(() => {
    const r = rng('gallery-peaks');
    return Array.from({length: 2000}, (_, i) => {
      const t = i / 100;
      const beat = Math.pow(1 - ((t * 2) % 1), 3);
      const swell = 0.45 + 0.35 * wave(t, 40);
      return Math.min(
        1,
        swell * (0.35 + 0.65 * beat) * (0.75 + 0.25 * r.next()),
      );
    });
  }, []);

/**
 * Three waveforms from one peak array: mirrored with a playhead split,
 * growing out from the centre over the first second, and a clipped,
 * gain-normalised excerpt drawn one-sided. Still: 1 s.
 */
export const WaveformBlock: React.FC = () => {
  const f = useGlobalFrame();
  const {unit, width, height, fps} = useFormat();
  const peaks = usePeaks();
  const w = width * 0.8;
  const x0 = width * 0.1;
  const startSec = 2 + f / fps;
  const clipped = clipPeaks(peaks, 100, 6, 9);
  const gain = 1 / Math.max(0.05, peakMax(peaks, 100, 6, 9));
  return (
    <BrandStage>
      <div style={{position: 'absolute', left: x0, top: height * 0.14}}>
        <Waveform
          peaks={peaks}
          rate={100}
          startSec={startSec}
          endSec={startSec + 8}
          width={w}
          height={180 * unit}
          playheadX={w / 2}
          playedColors={[color.white, lane.blue]}
        />
        <Playhead x={w / 2} top={-20 * unit} height={220 * unit} />
      </div>
      <div style={{position: 'absolute', left: x0, top: height * 0.45}}>
        <Waveform
          peaks={peaks}
          rate={100}
          startSec={4}
          endSec={12}
          width={w}
          height={140 * unit}
          reveal={Math.min(1, f / fps)}
          fadeEdges={120 * unit}
        />
      </div>
      <div style={{position: 'absolute', left: x0, top: height * 0.72}}>
        <Waveform
          peaks={clipped}
          rate={100}
          startSec={5}
          endSec={10}
          width={w}
          height={120 * unit}
          mirror={false}
          gain={gain}
          colors={[lane.kick, lane.yellow]}
        />
      </div>
      <BlockLabel text="ui / Waveform + Playhead (peaks, clipPeaks, peakMax)" />
    </BrandStage>
  );
};

/** A bar of beat markers landing one after another from 1/6 s, beat 3 highlighted. Still: 0.67 s. */
export const BeatMarkerBlock: React.FC = () => {
  const {unit, width, height, fps} = useFormat();
  const n = 9;
  return (
    <BrandStage accent={lane.blue}>
      {Array.from({length: n}, (_, i) => (
        <BeatMarker
          key={i}
          x={width * 0.14 + (i * width * 0.72) / (n - 1)}
          baseline={height * 0.6}
          height={180 * unit}
          downbeat={i % 4 === 0}
          label={`${Math.floor(i / 4) + 1}.${(i % 4) + 1}`}
          landAt={fps / 6 + (i * fps) / 15}
          highlight={i === 2 ? 1 : 0}
          highlightColor={lane.blue}
        />
      ))}
      <BlockLabel text="ui / BeatMarker" />
    </BrandStage>
  );
};
