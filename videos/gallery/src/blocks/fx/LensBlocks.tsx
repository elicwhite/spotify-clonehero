/**
 * The fx area's lens and motion blocks, cued in seconds. Each names the
 * moment worth looking at in its comment (the still the gallery renders).
 */
import {AbsoluteFill} from 'remotion';
import {
  BrandMark,
  BrandStage,
  color,
  ease,
  lane,
} from '@musiccharts/video-kit/brand';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {
  CameraShake,
  ChromaSplit,
  DepthOfField,
  GlassPlane,
  MotionBlur,
  Pop,
  SampledMotionBlur,
  WhipFilter,
  type PopEnterName,
  type PopExitName,
} from '@musiccharts/video-kit/fx';
import {useFormat} from '@musiccharts/video-kit/format';
import {kf, velocity} from '@musiccharts/video-kit/motion';
import {KineticText} from '@musiccharts/video-kit/text';
import {Chip} from '@musiccharts/video-kit/ui';
import {BlockLabel, DemoPlane, Row} from '../visualShared';

/** A title and a mark with the channels split 8 reference px. Still: any frame. */
export const ChromaSplitBlock: React.FC = () => {
  const {unit} = useFormat();
  return (
    <BrandStage>
      <ChromaSplit amount={8 * unit}>
        <Row>
          <BrandMark size={180 * unit} finish="lit" />
          <KineticText text="Chroma" variant="display" />
        </Row>
      </ChromaSplit>
      <BlockLabel text="fx / ChromaSplit 8" />
    </BrandStage>
  );
};

/** A shake from 0.5 s on a layer the caller already scaled to 0.8 (the scale is kept). Still: 0.53 s. */
export const CameraShakeBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  return (
    <BrandStage>
      <CameraShake
        at={0.5 * fps}
        intensity={40 * unit}
        rotation={1.5}
        style={{transform: 'scale(0.8)'}}>
        <AbsoluteFill style={{border: `${4 * unit}px solid ${color.purple}`}}>
          <Row>
            <div style={{transform: `scale(${0.7 * unit})`}}>
              <DemoPlane />
            </div>
          </Row>
        </AbsoluteFill>
      </CameraShake>
      <BlockLabel text="fx / CameraShake at 0.5 s, caller scale 0.8 kept" />
    </BrandStage>
  );
};

/**
 * A chip whipping across, a mark flying diagonally to land under it, and a
 * spinning bar under sampled blur. Still: 1/3 s (all three mid-move).
 */
export const MotionBlurBlock: React.FC = () => {
  const f = useGlobalFrame();
  const {unit, width, height, fps} = useFormat();
  const x = (g: number) =>
    kf(g, [
      [fps / 6, -0.35 * width],
      [(2 / 3) * fps, 0.2 * width, ease.enter],
    ]);
  const d = (g: number) =>
    kf(g, [
      [0.23 * fps, 0],
      [0.73 * fps, 1, ease.enter],
    ]);
  const dx = (g: number) => -0.3 * width + d(g) * 0.5 * width;
  const dy = (g: number) => 0.3 * height - d(g) * 0.5 * height;
  return (
    <BrandStage>
      <div
        style={{
          position: 'absolute',
          left: width / 2,
          top: height * 0.2,
          transform: `translateX(${x(f)}px)`,
        }}>
        <MotionBlur vx={velocity(x, f)} vy={0}>
          <Chip label="4/4" accent={lane.blue} size="lg" />
        </MotionBlur>
      </div>
      <div
        style={{
          position: 'absolute',
          left: width / 2,
          top: height / 2,
          transform: `translate(${dx(f)}px, ${dy(f)}px)`,
        }}>
        <MotionBlur vx={velocity(dx, f)} vy={velocity(dy, f)} method="smear">
          <BrandMark size={120 * unit} />
        </MotionBlur>
      </div>
      <SampledMotionBlur samples={8} shutter={0.9}>
        <Spinner fps={fps} />
      </SampledMotionBlur>
      <BlockLabel text="fx / MotionBlur (filter, smear) + SampledMotionBlur" />
    </BrandStage>
  );
};

/** A bar turning a full turn a second; drawn from the film clock so SampledMotionBlur can shift it. */
const Spinner: React.FC<{fps: number}> = ({fps}) => {
  const f = useGlobalFrame();
  const {unit, width, height} = useFormat();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0.8 * width - 120 * unit,
        top: 0.75 * height - 12 * unit,
        width: 240 * unit,
        height: 24 * unit,
        borderRadius: 12 * unit,
        background: lane.yellow,
        transform: `rotate(${(f / fps) * 360}deg)`,
      }}
    />
  );
};

/** Content whipping with a 30 px horizontal blur. Still: any frame. */
export const WhipFilterBlock: React.FC = () => {
  const {unit} = useFormat();
  return (
    <BrandStage>
      <WhipFilter amount={30 * unit}>
        <Row>
          <KineticText text="Whip pan" variant="display" />
        </Row>
      </WhipFilter>
      <BlockLabel text="fx / WhipFilter 30" />
    </BrandStage>
  );
};

/** Text presets that work on a whole element, each pair on one element. */
const POPS: readonly (readonly [PopEnterName, PopExitName])[] = [
  ['scalePop', 'shrinkOut'],
  ['dropIn', 'fallOut'],
  ['fadeUp', 'riseOut'],
  ['fadeIn', 'fadeOut'],
  ['blurIn', 'blurOut'],
  ['blurRise', 'blurLift'],
];

/**
 * Elements entering on KineticText's presets from 1/3 s and leaving from
 * 4/3 s. Stills: 0.45 s (mid-enter), 1.5 s (mid-exit).
 */
export const PopBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  return (
    <BrandStage>
      <Row gap={40}>
        {POPS.map(([enter, exit]) => (
          <Pop
            key={enter}
            at={fps / 3}
            exitAt={(4 / 3) * fps}
            enter={enter}
            exit={exit}
            size={120 * unit}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16 * unit,
              }}>
              <BrandMark size={120 * unit} />
              <Chip label={`${enter} / ${exit}`} size="sm" />
            </div>
          </Pop>
        ))}
      </Row>
      <BlockLabel text="fx / Pop on text presets: in at 1/3 s, out at 4/3 s" />
    </BrandStage>
  );
};

/** A plane lifted onto tilted glass with its sheen. Still: any frame. */
export const GlassPlaneBlock: React.FC = () => {
  const {unit, width, height} = useFormat();
  return (
    <BrandStage accent={lane.blue}>
      <AbsoluteFill style={{perspective: 2200 * unit}}>
        <GlassPlane
          x={width * 0.18}
          y={height * 0.14}
          zoom={0.75 * unit}
          transform="rotateY(-14deg) rotateX(8deg)"
          sheen={0.55}>
          <DemoPlane />
        </GlassPlane>
      </AbsoluteFill>
      <BlockLabel text="fx / GlassPlane" />
    </BrandStage>
  );
};

/** A plane sharp around one point, soft elsewhere. Still: any frame. */
export const DepthOfFieldBlock: React.FC = () => {
  const {unit, width, height} = useFormat();
  return (
    <BrandStage>
      <DepthOfField
        focus={{x: width * 0.62, y: height * 0.42}}
        radius={220 * unit}
        blur={7 * unit}>
        <AbsoluteFill
          style={{
            transform: `scale(${1.25 * unit})`,
            transformOrigin: '30% 20%',
          }}>
          <DemoPlane />
        </AbsoluteFill>
      </DepthOfField>
      <BlockLabel text="fx / DepthOfField (children rendered twice: never WebGL)" />
    </BrandStage>
  );
};
