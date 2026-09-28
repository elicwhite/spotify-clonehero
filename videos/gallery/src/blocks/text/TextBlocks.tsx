/**
 * The text area's blocks: KineticText in its main uses, and every preset
 * caught mid-flight.
 */
import {AbsoluteFill} from 'remotion';
import {
  BrandStage,
  color,
  fontFamily,
  lane,
} from '@musiccharts/video-kit/brand';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  enterPresets,
  exitPresets,
  KineticText,
  type KineticPreset,
} from '@musiccharts/video-kit/text';
import {BlockLabel} from '../visualShared';

const accentWord = {
  background: `linear-gradient(95deg, ${color.white} 0%, ${color.fuchsia} 45%, ${color.purple} 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

/** A headline, a title, blur-rise copy with an accent word, a typed eyebrow and a decoded URL. */
export const KineticTextBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  const s = (sec: number) => sec * fps;
  return (
    <BrandStage accent={lane.blue}>
      <BlockLabel text="text / KineticText" />
      <AbsoluteFill
        style={{
          padding: `${140 * unit}px ${160 * unit}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 44 * unit,
        }}>
        <KineticText
          text="drum transcription"
          variant="eyebrow"
          enter="typeOn"
          enterAt={s(0.1)}
          color={lane.yellow}
        />
        <KineticText
          text="Turn a song into a first-pass drum chart"
          maxWidth={1100 * unit}
          maxLines={2}
          enterAt={s(0.3)}
        />
        <KineticText
          text="Chart Editor"
          variant="display"
          enter="flipUp"
          enterAt={s(0.8)}
          weightFrom={420}
        />
        <KineticText
          text={[
            'Your',
            'library',
            'is',
            'already',
            'a',
            {text: 'setlist.', style: accentWord},
          ]}
          variant="h2"
          enter="blurRise"
          enterAt={[s(1.2), s(1.28), s(1.36), s(1.5), s(1.58), s(1.66)]}
          exit="blurLift"
          exitAt={s(3.4)}
          float
        />
        <KineticText
          text="musiccharts.tools/example"
          variant="url"
          enter="decode"
          enterAt={s(1.6)}
        />
      </AbsoluteFill>
    </BrandStage>
  );
};

const SAMPLE = 'Kinetic type';

/** Every enter and exit preset at 45% of its own run, at the block's still frame (1 s). */
export const KineticPresetsBlock: React.FC = () => {
  const {unit, fps} = useFormat();
  const still = fps;
  const units = (p: KineticPreset) =>
    p.split === 'chars' ? SAMPLE.replace(/ /g, '').length : 2;
  const runSec = (p: KineticPreset) =>
    p.duration > 0
      ? p.duration + p.stagger * (units(p) - 1)
      : p.stagger * units(p);
  const startFor = (p: KineticPreset) => still - 0.45 * runSec(p) * fps;
  const row = (name: string, node: React.ReactNode) => (
    <div
      key={name}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24 * unit,
        height: 74 * unit,
      }}>
      <div
        style={{
          width: 170 * unit,
          fontFamily: fontFamily.mono,
          fontSize: 18 * unit,
          color: 'rgba(255,255,255,0.5)',
        }}>
        {name}
      </div>
      {node}
    </div>
  );
  return (
    <BrandStage grain={false}>
      <BlockLabel text="text / presets at 45%" />
      <AbsoluteFill
        style={{
          padding: `${110 * unit}px ${120 * unit}px`,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          columnGap: 60 * unit,
        }}>
        <div>
          {Object.entries(enterPresets).map(([name, p]) =>
            row(
              `enter ${name}`,
              <KineticText
                text={SAMPLE}
                variant="h2"
                size={52 * unit}
                enter={p}
                enterAt={startFor(p)}
              />,
            ),
          )}
        </div>
        <div>
          {Object.entries(exitPresets).map(([name, p]) =>
            row(
              `exit ${name}`,
              <KineticText
                text={SAMPLE}
                variant="h2"
                size={52 * unit}
                exit={p}
                exitAt={startFor(p)}
              />,
            ),
          )}
        </div>
      </AbsoluteFill>
    </BrandStage>
  );
};
