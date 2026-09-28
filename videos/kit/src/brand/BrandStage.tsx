import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {useGlobalFrame, useScene} from '../clock';
import {softGlow} from '../fx/Glow';
import {Grain, type GrainProps} from '../fx/Grain';
import {WhipFilter} from '../fx/MotionBlur';
import {Vignette} from '../fx/Vignette';
import {useFormat} from '../format';
import {colorAt, kf, progress, wave, type Key, type Point} from '../motion';
import {ease} from './ease';
import {color} from './tokens';

/** Whip-pan entrance and exit for the stage's content, in film frames. */
export interface StageWhip {
  /** The frame the content starts whipping in from the right (it lands about 0.23 s later). */
  enter?: number;
  /** The frame the content has whipped out to the left: the cut. It starts 0.2 s before. */
  exit?: number;
}

export interface BrandStageProps {
  /**
   * Film grain over the whole stage (default on). Grain is blended over
   * everything under it, so turn it off (`false`) on any shot that shows the
   * product highway: no blend may touch the highway's pixels.
   */
  grain?: boolean | GrainProps;
  /** Edge darkening, 0..1 (default 0.55; 0 = none). */
  vignette?: number;
  /** Multiplier on the brand glow (default 1). */
  glow?: number;
  /** Where the brand glow sits, px (default: top right, wandering slowly). */
  glowAt?: Point;
  /** How far the glows wander (default 1; 0 = still). */
  drift?: number;
  /**
   * The accent glow, bottom left: a colour, or colour keys that crossfade
   * over half a second, `[[frame, colour], ...]`. Omit for none.
   */
  accent?: string | readonly (readonly [frame: number, color: string])[];
  /** The accent glow's strength: a number or keyframes over film frames (default 0.6). */
  tint?: number | readonly Key[];
  /** Whip-pan the content in and out across hard cuts, with horizontal motion blur. */
  whip?: StageWhip;
  /** A slow linear push-in of the content across the enclosing scene (0.03 = 3%; default 0). */
  push?: number;
  children?: ReactNode;
  style?: CSSProperties;
}

/**
 * The brand stage: the near-black purple sweep, the brand glow wandering top
 * right, an optional accent glow bottom left, the vignette and film grain,
 * with the content between the light and the lens. Pure CSS gradients, so it
 * costs almost nothing per frame. The content can whip in and out and push in
 * slowly; the stage itself stays put, so a whip reads as the camera panning
 * off one plane and onto the next.
 */
export const BrandStage: React.FC<BrandStageProps> = ({
  grain = true,
  vignette = 0.55,
  glow = 1,
  glowAt,
  drift = 1,
  accent,
  tint = 0.6,
  whip,
  push = 0,
  children,
  style,
}) => {
  const f = useGlobalFrame();
  const scene = useScene();
  const {fps, unit, width} = useFormat();
  const t = f / fps;
  // A slow Lissajous wander, periods of 19 to 31 s: it never loops within a film.
  const gx = 82 + drift * 5 * wave(t, 23);
  const gy = 16 + drift * 6 * wave(t, 31, Math.PI / 2);
  const ax = 14 + drift * 5 * wave(t, 29, 1.3);
  const ay = 90 + drift * 4 * wave(t, 19, 0.4 + Math.PI / 2);
  const breathe = 1 + 0.06 * wave(t, 7.5);

  const accentColor =
    accent === undefined
      ? null
      : typeof accent === 'string'
        ? accent
        : colorAt(f, accent, 0.5 * fps);
  const tintNow = typeof tint === 'number' ? tint : kf(f, tint);

  const glowX = glowAt ? `${glowAt.x}px` : `${gx}%`;
  const glowY = glowAt ? `${glowAt.y}px` : `${gy}%`;
  const layers = [
    softGlow(glowX, glowY, 1100 * unit, color.purple, 0.2 * glow * breathe),
    accentColor && tintNow > 0
      ? softGlow(`${ax}%`, `${ay}%`, 1000 * unit, accentColor, 0.1 * tintNow)
      : null,
    `linear-gradient(135deg, ${color.stageWarm} 0%, ${color.stageMid} 58%, ${color.stage} 100%)`,
  ].filter((l): l is string => l !== null);

  // Content motion: whips across cuts and a slow push over the scene.
  const tin =
    whip?.enter === undefined
      ? 1
      : ease.enter(progress(f, whip.enter, 0.233 * fps));
  const tout =
    whip?.exit === undefined
      ? 0
      : Math.pow(progress(f, whip.exit - 0.2 * fps, 0.2 * fps), 3);
  const x = (1 - tin) * 0.4 * width - tout * 0.51 * width;
  const blur = ((1 - tin) * 40 + tout * 48) * unit;
  const scale = 1 + push * progress(f, scene.from, scene.durationInFrames);
  const moved = x !== 0 || scale !== 1;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: color.stage,
        backgroundImage: layers.join(', '),
        overflow: 'hidden',
        ...style,
      }}>
      <WhipFilter
        amount={blur}
        style={
          moved ? {transform: `translateX(${x}px) scale(${scale})`} : undefined
        }>
        {children}
      </WhipFilter>
      {vignette > 0 ? <Vignette strength={vignette} /> : null}
      {grain ? <Grain {...(grain === true ? {} : grain)} /> : null}
    </AbsoluteFill>
  );
};
