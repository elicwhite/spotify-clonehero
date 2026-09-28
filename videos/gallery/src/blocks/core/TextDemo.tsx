/**
 * Text: one headline measured with the loaded fonts and broken greedily and
 * balanced into the same measure, then the type scale and palette.
 */
import {useMemo} from 'react';
import {AbsoluteFill} from 'remotion';
import {
  color,
  fontFamily,
  lane,
  space,
  stageBackground,
  type,
  type TypeName,
} from '@musiccharts/video-kit/brand';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  breakLines,
  measureWidth,
  PIXEL_STABLE_LINE_HEIGHT,
  useFontsReady,
  type FontSpec,
} from '@musiccharts/video-kit/text';

const HEADLINE = 'Chart any song you know, then play it on the highway tonight';
const SCALE: TypeName[] = ['h2', 'caption', 'eyebrow', 'micro'];

const Broken: React.FC<{title: string; balance: boolean; font: FontSpec}> = ({
  title,
  balance,
  font,
}) => {
  const {unit} = useFormat();
  const lines = useMemo(() => {
    const words = HEADLINE.split(' ');
    const widths = words.map(w => measureWidth(w, font));
    const spaceWidth = measureWidth(' ', font);
    const maxWidth = space.headlineMaxWidth * 0.6 * unit;
    return breakLines(widths, spaceWidth, maxWidth, {balance}).map(line =>
      line.map(i => words[i]).join(' '),
    );
  }, [balance, font, unit]);
  return (
    <div style={{marginBottom: 48 * unit}}>
      <div
        style={{
          fontFamily: fontFamily.mono,
          fontSize: 20 * unit,
          color: color.faint,
        }}>
        {title}
      </div>
      {lines.map(line => (
        <div
          key={line}
          style={{
            fontFamily: font.family,
            fontSize: font.size,
            fontWeight: font.weight,
            letterSpacing: `${font.tracking}em`,
            lineHeight: 1.06,
            color: color.text,
            whiteSpace: 'nowrap',
          }}>
          {line}
        </div>
      ))}
    </div>
  );
};

export const TextDemo: React.FC = () => {
  const ready = useFontsReady();
  const {unit} = useFormat();
  const h1 = type.h1;
  const font: FontSpec = {
    family: fontFamily[h1.family],
    size: h1.size * 0.7 * unit,
    weight: h1.weight,
    tracking: h1.tracking,
  };
  return (
    <AbsoluteFill
      style={{background: stageBackground, padding: space.safe * unit}}>
      {ready ? (
        <div style={{display: 'flex', gap: 96 * unit}}>
          <div>
            <Broken title="greedy" balance={false} font={font} />
            <Broken title="balanced" balance font={font} />
          </div>
          <div>
            {SCALE.map(name => {
              const t = type[name];
              return (
                <div
                  key={name}
                  style={{
                    fontFamily: fontFamily[t.family],
                    fontSize: t.size * unit,
                    fontWeight: t.weight,
                    letterSpacing: `${t.tracking}em`,
                    textTransform: 'uppercase' in t ? 'uppercase' : undefined,
                    lineHeight: PIXEL_STABLE_LINE_HEIGHT,
                    color: 'color' in t ? t.color : color.text,
                    marginBottom: 24 * unit,
                  }}>
                  {name}: The quick brown fox
                </div>
              );
            })}
            <div
              style={{display: 'flex', gap: 16 * unit, marginTop: 32 * unit}}>
              {[
                ...Object.values(lane),
                color.brand,
                color.purple,
                color.fuchsia,
                color.emerald,
              ].map(c => (
                <div
                  key={c}
                  style={{
                    width: 56 * unit,
                    height: 56 * unit,
                    borderRadius: 12 * unit,
                    background: c,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
