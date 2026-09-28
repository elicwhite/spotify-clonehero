/**
 * The brand area's blocks, cued in seconds. Each names the moment worth
 * looking at in its comment (the still the gallery renders).
 */
import {AbsoluteFill} from 'remotion';
import {
  AppleMusicMark,
  BRAND,
  BrandMark,
  BrandStage,
  color,
  EndCard,
  Gem,
  InstrumentIcon,
  lane,
  LogoSting,
  SpotifyMark,
  stingCues,
  useStingMeta,
  Wordmark,
  type GemSprite,
  type Instrument,
  type StingCues,
} from '@musiccharts/video-kit/brand';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {useFormat} from '@musiccharts/video-kit/format';
import {KineticText} from '@musiccharts/video-kit/text';
import {Chip} from '@musiccharts/video-kit/ui';
import {BlockLabel, Row, type VisualBlockProps} from '../visualShared';

/** The mark: flat, lit with a glow and a sweep, and its outline half traced. Still: any moment. */
export const BrandMarkBlock: React.FC = () => {
  const {unit} = useFormat();
  return (
    <BrandStage>
      <Row gap={90}>
        <BrandMark size={220 * unit} />
        <BrandMark size={220 * unit} finish="lit" glow={0.7} sweep={0.45} />
        <BrandMark
          size={220 * unit}
          outline={1}
          trace={0.6}
          drawOn={0.5}
          tint={0.15}
        />
        <BrandMark size={220 * unit} outline={0.5} trace={1} glow={0.4} />
      </Row>
      <BlockLabel text="brand / BrandMark (flat, lit, outline, crossfade)" />
    </BrandStage>
  );
};

/** The lockup at the product's proportions, and the wordmark mid-reveal. Still: any moment. */
export const WordmarkBlock: React.FC = () => {
  const {unit} = useFormat();
  const mark = 112 * unit;
  return (
    <BrandStage>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 80 * unit,
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: mark * BRAND.gapScale,
          }}>
          <BrandMark size={mark} />
          <Wordmark size={mark * BRAND.wordmarkScale} />
        </div>
        <Wordmark size={96 * unit} reveal={0.6} />
      </AbsoluteFill>
      <BlockLabel text="brand / Wordmark (lockup, reveal 0.6)" />
    </BrandStage>
  );
};

const INSTRUMENTS: readonly Instrument[] = [
  'guitar',
  'bass',
  'drums',
  'keys',
  'vocals',
];
const GEMS: readonly GemSprite[] = [
  'strum0',
  'strum1',
  'strum2',
  'strum3',
  'strum4',
  'hopo2',
  'tap3',
  'drum-kick',
  'drum-tom-red',
  'drum-cymbal-yellow',
  'drum-tom-blue-accent',
  'drum-cymbal-green-ghost',
];

/** Service marks on the backgrounds they are allowed on, instrument art and gem sprites. Still: any moment. */
export const ServiceMarksBlock: React.FC = () => {
  const {unit} = useFormat();
  const tile = (bg: string, child: React.ReactNode) => (
    <div
      style={{
        width: 150 * unit,
        height: 150 * unit,
        borderRadius: 20 * unit,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {child}
    </div>
  );
  return (
    <BrandStage grain={false}>
      <AbsoluteFill
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 70 * unit,
        }}>
        <div style={{display: 'flex', gap: 40 * unit}}>
          {tile('#000000', <SpotifyMark size={72 * unit} />)}
          {tile('#ffffff', <SpotifyMark size={72 * unit} variant="black" />)}
          {tile(color.brand, <SpotifyMark size={72 * unit} variant="white" />)}
          {tile('#ffffff', <AppleMusicMark size={72 * unit} />)}
          {tile(
            color.stage,
            <AppleMusicMark size={72 * unit} variant="white" />,
          )}
        </div>
        <div style={{display: 'flex', gap: 50 * unit}}>
          {INSTRUMENTS.map(i => (
            <InstrumentIcon key={i} instrument={i} size={72 * unit} />
          ))}
        </div>
        <div style={{display: 'flex', gap: 26 * unit, alignItems: 'center'}}>
          {GEMS.map(g => (
            <Gem key={g} sprite={g} width={88 * unit} />
          ))}
        </div>
      </AbsoluteFill>
      <BlockLabel text="brand / SpotifyMark, AppleMusicMark, InstrumentIcon, Gem" />
    </BrandStage>
  );
};

/**
 * The stage with an accent that crossfades blue -> yellow at 1 s, a tint
 * envelope, a slow push, and its content whipping in at 1/6 s and out by
 * 2.83 s. Stills: 0.23 s (whip in), 1.5 s (rest), 2.77 s (whip out).
 */
export const BrandStageBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  return (
    <BrandStage
      accent={[
        [0, lane.blue],
        [fps, lane.yellow],
      ]}
      tint={[
        [0, 0.3],
        [fps, 1],
      ]}
      whip={{enter: fps / 6, exit: 2.83 * fps}}
      push={0.03}>
      <Row>
        <KineticText text="The brand stage" variant="h1" />
        <Chip label="accent keys" accent={lane.yellow} size="lg" />
      </Row>
      <div style={{position: 'absolute', left: 40 * unit, bottom: 40 * unit}}>
        <Chip label="grain, vignette, glow" size="sm" />
      </div>
      <BlockLabel text="brand / BrandStage" />
    </BrandStage>
  );
};

const CREDIT = {title: 'Placeholder Song', artist: 'Example Band'};

/**
 * The end card building from 1/6 s, with title and URL sweeps. Render it
 * with `--props '{"title": "...", "tagline": "..."}'` to see a long title fit
 * the safe width and a long tagline wrap with the stack still centred.
 * Stills: 0.83 s (building), the last frame (rest).
 */
export const EndCardBlock: React.FC<
  VisualBlockProps & {title?: string; tagline?: string}
> = ({
  title = 'Chart Editor',
  tagline = 'Runs in your browser. Your chart and audio are never uploaded.',
}) => {
  const {fps} = useFormat();
  const at = fps / 6;
  return (
    <BrandStage>
      <EndCard
        at={at}
        title={title}
        url="musiccharts.tools/example"
        tagline={tagline}
        credit={CREDIT}
        titleSweeps={[at + 2.2 * fps]}
        urlSweeps={[at + 3 * fps]}
      />
      <BlockLabel text="brand / EndCard" />
    </BrandStage>
  );
};

/** The gallery's sting: rendered by the kit's Blender tool (see the gallery README). */
const STING = 'generated/sting';

/** Which part of the sting a film frame shows. */
const stingCue = (f: number, cues: StingCues, fps: number): string => {
  if (f < cues.appear) return 'before';
  if (f < cues.impact) return 'fly-in';
  if (cues.sheens.some(s => Math.abs(f - s) <= 0.433 * fps)) return 'sheen';
  if (f > cues.end) return 'held';
  if (f >= cues.rest) return 'rest';
  if (cues.flashes.some(at => f >= at && f - at < 0.05 * fps)) return 'flash';
  return 'impact';
};

/**
 * The sting player on the Blender sting in `public/generated/sting` (from the
 * gallery's invented timeline, at 60 fps): the mark enters at 0.5 s, flies
 * in, hits at 1 s, flashes a lane rim per note of the run at 1.05-1.2 s,
 * rests from 1.33 s, takes a sheen at 2 s, and holds its last frame after
 * 2.43 s. A chip names the cue on screen. Stills: 0.75 s (fly-in), 1.05 s
 * (flash), 1.45 s (rest), 2 s (sheen), 2.83 s (held).
 */
export const LogoStingBlock: React.FC = () => {
  const f = useGlobalFrame();
  const {unit, fps, cx, cy} = useFormat();
  const meta = useStingMeta(`${STING}.json`);
  if (!meta) return <BrandStage />;
  const cues = stingCues(meta);
  return (
    <BrandStage>
      <LogoSting
        meta={meta}
        src={STING}
        x={cx}
        y={cy - 40 * unit}
        size={280 * unit}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 150 * unit,
          display: 'flex',
          justifyContent: 'center',
        }}>
        <Chip label={`sting: ${stingCue(f, cues, fps)}`} accent={lane.blue} />
      </div>
      <BlockLabel text="brand / LogoSting (the Blender sting)" />
    </BrandStage>
  );
};
