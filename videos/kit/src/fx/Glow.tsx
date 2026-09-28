import type {CSSProperties} from 'react';
import {alpha} from '../motion';

/**
 * A soft radial light as a CSS gradient: a Gaussian-like falloff written as
 * many stops, so the edge never reads as a disc and the gradient dithers well
 * under grain. `x`/`y` are any CSS lengths (`'82%'`, `'960px'`), `radius` px.
 * Stack several in one `background` for free light.
 */
export const softGlow = (
  x: string,
  y: string,
  radius: number,
  color: string,
  strength: number,
): string => {
  const stops = [
    [0, 1],
    [0.12, 0.92],
    [0.25, 0.74],
    [0.4, 0.5],
    [0.55, 0.29],
    [0.7, 0.13],
    [0.85, 0.04],
    [1, 0],
  ] as const;
  const s = stops
    .map(
      ([at, k]) => `${alpha(color, strength * k)} ${Math.round(at * radius)}px`,
    )
    .join(', ');
  return `radial-gradient(circle ${Math.max(1, Math.round(radius))}px at ${x} ${y}, ${s})`;
};

export interface GlowProps {
  /** Centre, px in the parent. */
  x: number;
  y: number;
  /** Falloff radius, px. */
  radius: number;
  color: string;
  /** Peak alpha at the centre, 0..1 (default 1). */
  strength?: number;
  blend?: CSSProperties['mixBlendMode'];
  style?: CSSProperties;
}

/** A soft pool of light at a point (the `softGlow` falloff in its own box). */
export const Glow: React.FC<GlowProps> = ({
  x,
  y,
  radius,
  color,
  strength = 1,
  blend,
  style,
}) =>
  strength <= 0.001 ? null : (
    <div
      style={{
        position: 'absolute',
        left: x - radius,
        top: y - radius,
        width: 2 * radius,
        height: 2 * radius,
        background: softGlow('50%', '50%', radius, color, strength),
        mixBlendMode: blend,
        pointerEvents: 'none',
        ...style,
      }}
    />
  );
