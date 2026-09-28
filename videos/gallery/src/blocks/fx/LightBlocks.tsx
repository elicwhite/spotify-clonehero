/**
 * The fx area's light blocks, cued in seconds. Each names the moment worth
 * looking at in its comment (the still the gallery renders).
 */
import {AbsoluteFill} from 'remotion';
import {
  BrandMark,
  BrandStage,
  color,
  LANE_COLORS,
  lane,
} from '@musiccharts/video-kit/brand';
import {
  Bokeh,
  Flash,
  Glow,
  Grain,
  LightSweep,
  Shockwave,
  SideShade,
  softGlow,
  SparkBurst,
  Vignette,
} from '@musiccharts/video-kit/fx';
import {useFormat} from '@musiccharts/video-kit/format';
import {KineticText} from '@musiccharts/video-kit/text';
import {BlockLabel, DemoPlane, Row} from '../visualShared';

/** Grain at 3x its usual opacity on the left half, the default on the right. Still: any frame. */
export const GrainBlock: React.FC = () => {
  const {width} = useFormat();
  return (
    <BrandStage grain={false} accent={lane.blue}>
      <AbsoluteFill style={{clipPath: `inset(0 ${width / 2}px 0 0)`}}>
        <Grain opacity={0.1} />
      </AbsoluteFill>
      <AbsoluteFill style={{clipPath: `inset(0 0 0 ${width / 2}px)`}}>
        <Grain />
      </AbsoluteFill>
      <BlockLabel text="fx / Grain (left 0.1, right default 0.035)" />
    </BrandStage>
  );
};

/** A strong vignette over a flat grey field. Still: any frame. */
export const VignetteBlock: React.FC = () => (
  <AbsoluteFill style={{background: '#5a5566'}}>
    <Vignette strength={0.85} />
    <BlockLabel text="fx / Vignette 0.85" />
  </AbsoluteFill>
);

/** Glow pools in lane colours, and a softGlow background. Still: any frame. */
export const GlowBlock: React.FC = () => {
  const {width, height, unit} = useFormat();
  return (
    <AbsoluteFill
      style={{
        background: `${softGlow('80%', '20%', 900 * unit, color.purple, 0.35)}, ${color.stage}`,
      }}>
      {LANE_COLORS.map((c, i) => (
        <Glow
          key={c}
          x={(width * (i + 1)) / 6}
          y={height * 0.58}
          radius={160 * unit}
          color={c}
          strength={0.35 + 0.15 * i}
        />
      ))}
      <BlockLabel text="fx / Glow + softGlow" />
    </AbsoluteFill>
  );
};

/** A radial flash from a mark at 0.5 s. Still: 0.52 s. */
export const FlashBlock: React.FC = () => {
  const {width, height, unit, fps} = useFormat();
  return (
    <BrandStage>
      <Row>
        <BrandMark size={200 * unit} finish="lit" />
      </Row>
      <Flash at={0.5 * fps} peak={0.6} origin={{x: width / 2, y: height / 2}} />
      <BlockLabel text="fx / Flash at 0.5 s" />
    </BrandStage>
  );
};

/** Two rings from the centre and a squashed ring on a tilted line, from 0.5 s. Still: 0.7 s. */
export const ShockwaveBlock: React.FC = () => {
  const {width, height, fps} = useFormat();
  return (
    <BrandStage>
      <Shockwave
        at={0.5 * fps}
        x={width / 2}
        y={height * 0.42}
        rings={2}
        color={color.purpleHot}
      />
      <Shockwave
        at={0.5 * fps}
        x={width / 2}
        y={height * 0.8}
        aspect={0.35}
        color={lane.yellow}
      />
      <BlockLabel text="fx / Shockwave at 0.5 s" />
    </BrandStage>
  );
};

/** Three bursts; the arrays are inline on purpose (a new array every render). Still: 0.67 s. */
export const SparkBurstBlock: React.FC = () => {
  const {width, height, fps} = useFormat();
  const at = 0.5 * fps;
  return (
    <BrandStage>
      <SparkBurst at={at} x={width * 0.25} y={height * 0.6} />
      <SparkBurst
        at={at}
        x={width * 0.5}
        y={height * 0.5}
        count={56}
        colors={[...LANE_COLORS, color.purpleHot, color.white]}
        speed={[900, 2400]}
        gravity={420}
        seed="burst"
      />
      <SparkBurst
        at={at}
        x={width * 0.75}
        y={height * 0.6}
        colors={[lane.blue, color.white]}
        angle={-90}
        spread={140}
        seed="fountain"
      />
      <BlockLabel text="fx / SparkBurst at 0.5 s" />
    </BrandStage>
  );
};

/** A gloss band crossing a title, from 1/6 s over 0.7 s. Still: 0.52 s. */
export const LightSweepBlock: React.FC = () => {
  const {fps} = useFormat();
  return (
    <BrandStage>
      <Row>
        <LightSweep at={fps / 6}>
          <KineticText text="Chart Editor" variant="display" />
        </LightSweep>
      </Row>
      <BlockLabel text="fx / LightSweep at 1/6 s" />
    </BrandStage>
  );
};

/**
 * Out-of-focus lights over a plane, drifting and wrapping around the frame:
 * the field is as full after 90 s as at the start. Stills: 0.5 s, 90 s.
 */
export const BokehBlock: React.FC = () => {
  const {unit} = useFormat();
  return (
    <BrandStage>
      <Row>
        <div style={{transform: `scale(${0.8 * unit})`, filter: 'blur(3px)'}}>
          <DemoPlane />
        </div>
      </Row>
      <Bokeh seed="gallery" count={12} />
      <BlockLabel text="fx / Bokeh" />
    </BrandStage>
  );
};

/** A plane with the left half shaded for type. Still: any frame. */
export const SideShadeBlock: React.FC = () => {
  const {unit} = useFormat();
  return (
    <BrandStage>
      <Row>
        <div style={{transform: `scale(${1.1 * unit})`}}>
          <DemoPlane />
        </div>
      </Row>
      <SideShade side="left" />
      <div style={{position: 'absolute', left: 120 * unit, top: 420 * unit}}>
        <KineticText
          text="Type reads over the shade"
          variant="h2"
          maxWidth={640 * unit}
        />
      </div>
      <BlockLabel text="fx / SideShade left" />
    </BrandStage>
  );
};
