/**
 * The end card: the logo, the product title under it, the URL, a tagline,
 * and the music credit at the bottom, calm and breathing to the last frame.
 * The last frame is a complete, readable card (it doubles as the thumbnail).
 */
import type {ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {useGlobalFrame, useScene} from '../clock';
import {softGlow} from '../fx/Glow';
import {LightSweep} from '../fx/LightSweep';
import {particleField} from '../fx/particles';
import {useFormat} from '../format';
import {alpha, clamp01, mix, progress, spring01, wave} from '../motion';
import {useTimeline} from '../music';
import {useFitLineSize, useLineCount} from '../text/fit';
import {KineticText} from '../text/KineticText';
import {textStyle} from '../text/style';
import {BrandMark} from './BrandMark';
import {ease} from './ease';
import {endCardTiming, type EndCardTimingProps} from './endCardTiming';
import {color, lane, space, springs, type} from './tokens';

/** "Music: {title} by {artist}". The chart is never credited, only the music. */
export const musicCredit = (m: {title: string; artist: string}): string =>
  `Music: ${m.title} by ${m.artist}`;

const TimelineCredit: React.FC = () => musicCredit(useTimeline().meta);

const DUST_COLORS = [
  color.purpleHot,
  color.purple,
  color.white,
  color.purpleHot,
  lane.blue,
  lane.yellow,
  lane.green,
  lane.red,
  lane.kick,
];

/**
 * Sparse, slow, twinkling dust in the brand purple with a few lane colours,
 * at three depths, rising and wrapping around the frame: the shared particle
 * field, so it never empties however long the card holds.
 */
const Dust: React.FC<{from: number; fadeIn: number}> = ({from, fadeIn}) => {
  const f = useGlobalFrame();
  const {fps, width, height, unit} = useFormat();
  const vis = clamp01(progress(f, from, fadeIn));
  if (vis <= 0.001) return null;
  const motes = particleField(f, fps, {
    seed: 'endcard-dust',
    count: 46,
    area: [0.03 * width, 0, 0.97 * width, height],
    drift: [0, -unit],
    speed: [8, 22],
    depths: [0.45, 0.75, 1.15],
    size: [5.2 * unit, 12.8 * unit],
    sway: {amplitude: [6 * unit, 22 * unit], periodSec: [2.8, 5.3]},
    twinkleSec: [1.3, 3.2],
    colors: DUST_COLORS,
  });
  return (
    <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'plus-lighter'}}>
      {motes.map((m, i) => {
        const a = vis * (0.18 + 0.5 * m.twinkle) * (0.55 + 0.4 * m.depth);
        const s = m.size * (0.7 + 0.5 * m.depth);
        const {x, y} = m;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x - s / 2,
              top: y - s / 2,
              width: s,
              height: s,
              borderRadius: '50%',
              background: `radial-gradient(circle closest-side, ${alpha(color.white, a)} 0%, ${alpha(m.color, a * 0.8)} 28%, ${alpha(
                m.color,
                0,
              )} 100%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export interface EndCardProps extends EndCardTimingProps {
  /**
   * The music credit at the bottom: the music's title and artist, or a whole
   * line. Default: read from the timeline's meta (needs a timeline above).
   * `false` leaves it out.
   */
  credit?: false | string | {title: string; artist: string};
  /**
   * The logo, centred in its slot (default: the brand mark, lit, springing
   * in). Pass a `LogoSting` to use the Blender sting.
   */
  logo?: ReactNode;
  /** The logo slot's side, px (default 240 reference px). */
  logoSize?: number;
  /** Film frames a light sweep crosses the title, and the URL. */
  titleSweeps?: readonly number[];
  urlSweeps?: readonly number[];
  /** The glow behind the logo (default the brand purple). */
  glow?: string;
  /** Drifting dust in the hold (default true). */
  dust?: boolean;
  /** Slow push-in over the rest of the scene (default 0.012). */
  push?: number;
}

/**
 * The end card, laid out from the format: the stack sits a little above the
 * optical centre, the credit on the bottom safe margin. A title or URL too
 * long for the title-safe width sets smaller instead of running off the
 * frame.
 *
 * ```tsx
 * <EndCard at={f} title="Chart Editor" url="musiccharts.tools/chart-editor"
 *   tagline="Runs in your browser. Your chart and audio are never uploaded." />
 * ```
 */
export const EndCard: React.FC<EndCardProps> = ({
  at,
  title,
  url,
  tagline,
  credit,
  logo,
  logoSize,
  titleAt,
  urlAt,
  taglineAt,
  creditAt,
  titleSweeps = [],
  urlSweeps = [],
  glow = color.purple,
  dust = true,
  push = 0.012,
}) => {
  const f = useGlobalFrame();
  const scene = useScene();
  const {fps, unit, width, height, safeWidth} = useFormat();

  // The stack: logo, title, URL, tagline, from the type tokens, each line
  // fitted to the safe width as it is at the end of the push-in.
  const room = safeWidth / (1 + push);
  const logoSide = logoSize ?? 240 * unit;
  const titleSize = useFitLineSize(
    title,
    'display',
    type.display.size * unit,
    room,
  );
  const urlSize = useFitLineSize(url, 'url', type.url.size * unit, room);
  const titleH = titleSize * type.display.lineHeight;
  const urlH = urlSize * type.url.lineHeight;
  const taglineSize = 30 * unit;
  const taglineMax = Math.min(0.8 * width, room);
  // A tagline that wraps (in portrait) is as tall as its lines.
  const taglineLines = useLineCount(
    tagline ?? '',
    'caption',
    taglineSize,
    taglineMax,
  );
  const taglineH = taglineLines * taglineSize * type.caption.lineHeight;
  const gapLogo = 40 * unit;
  const gap = 30 * unit;
  const stack =
    logoSide + gapLogo + titleH + gap + urlH + (tagline ? gap + taglineH : 0);
  const top = 0.47 * height - stack / 2;
  const logoY = top + logoSide / 2;
  const titleTop = top + logoSide + gapLogo;
  const urlTop = titleTop + titleH + gap;
  const taglineTop = urlTop + urlH + gap;
  const creditTop = height - (space.safe + 40) * unit;

  const copy = endCardTiming(
    {at, title, url, tagline, titleAt, urlAt, taglineAt, creditAt},
    fps,
  );

  // The default mark springs in; the glow behind it settles into a slow breath.
  const landed = spring01(f, at, springs.hero, fps);
  const breath = 0.82 + 0.18 * wave((f - at) / fps, 3.2);
  const glowIn = clamp01(progress(f, at, 0.67 * fps));
  const cam =
    1 +
    push * ease.drift(clamp01(progress(f, at, Math.max(1, scene.end - at))));
  const credIn = ease.enter(clamp01(progress(f, copy.creditAt, 0.53 * fps)));

  const row = (y: number, child: ReactNode) => (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: y,
        display: 'flex',
        justifyContent: 'center',
      }}>
      {child}
    </div>
  );
  const swept = (
    sweeps: readonly number[],
    child: ReactNode,
    intensity: number,
  ) =>
    sweeps.reduce<ReactNode>(
      (inner, s, i) => (
        <LightSweep key={s} at={s} intensity={intensity * (i === 0 ? 1 : 0.65)}>
          {inner}
        </LightSweep>
      ),
      child,
    );

  return (
    <AbsoluteFill
      style={{
        transform: `scale(${cam})`,
        transformOrigin: `${width / 2}px ${0.46 * height}px`,
      }}>
      {glowIn > 0.002 ? (
        <AbsoluteFill
          style={{
            background: softGlow(
              `${width / 2}px`,
              `${logoY}px`,
              (260 + 180 * landed) * unit,
              glow,
              0.5 * glowIn * breath,
            ),
            mixBlendMode: 'plus-lighter',
          }}
        />
      ) : null}
      {dust ? <Dust from={at + 0.17 * fps} fadeIn={1.5 * fps} /> : null}
      <div
        style={{
          position: 'absolute',
          left: width / 2 - logoSide / 2,
          top: logoY - logoSide / 2,
          width: logoSide,
          height: logoSide,
        }}>
        {logo ?? (
          <BrandMark
            size={logoSide}
            finish="lit"
            glow={0.35 * glowIn}
            drawOn={clamp01(progress(f, at + 0.1 * fps, 0.5 * fps))}
            style={{
              transform: `scale(${mix(0.6, 1, landed)})`,
              opacity: clamp01(landed * 3),
            }}
          />
        )}
      </div>
      {row(
        titleTop,
        swept(
          titleSweeps,
          <KineticText
            {...copy.titleOptions}
            variant="display"
            size={titleSize}
            align="center"
          />,
          0.55,
        ),
      )}
      {row(
        urlTop,
        swept(
          urlSweeps,
          <KineticText
            {...copy.urlOptions}
            variant="url"
            size={urlSize}
            color="rgba(255,255,255,0.94)"
            align="center"
          />,
          0.45,
        ),
      )}
      {copy.taglineOptions
        ? row(
            taglineTop,
            <KineticText
              {...copy.taglineOptions}
              variant="caption"
              size={taglineSize}
              align="center"
              maxWidth={taglineMax}
            />,
          )
        : null}
      {credit === false
        ? null
        : row(
            creditTop,
            <div
              style={textStyle('small', unit, {
                fontSize: 22 * unit,
                color: 'rgba(255,255,255,0.5)',
                maxWidth: room,
                textAlign: 'center',
                opacity: credIn,
                transform: `translateY(${(1 - credIn) * 10 * unit}px)`,
              })}>
              {credit === undefined ? (
                <TimelineCredit />
              ) : typeof credit === 'string' ? (
                credit
              ) : (
                musicCredit(credit)
              )}
            </div>,
          )}
    </AbsoluteFill>
  );
};
