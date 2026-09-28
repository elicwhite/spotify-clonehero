import type {CSSProperties} from 'react';
import {AbsoluteFill} from 'remotion';
import {accent, color as palette, timing} from '../brand/tokens';
import {pulseAt, useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha} from '../motion';

export interface FlashProps {
  /** Film frame(s) of the hit. */
  at: number | readonly number[];
  /** Peak opacity (default `accent.flashPeak`, the hero flash). */
  peak?: number;
  /** Frames to decay to 0 (default `timing.flash` seconds). */
  decay?: number;
  color?: string;
  /** A radial flash centred here instead of a flat one (px; radius default 0.83 of the frame height). */
  origin?: {x: number; y: number; radius?: number};
  blend?: CSSProperties['mixBlendMode'];
}

/**
 * A light flash on a hit: `peak` on the hit frame, gone `decay` frames later.
 * Renders nothing between hits.
 */
export const Flash: React.FC<FlashProps> = ({
  at,
  peak = accent.flashPeak,
  decay,
  color = palette.white,
  origin,
  blend = 'screen',
}) => {
  const f = useGlobalFrame();
  const {fps, height} = useFormat();
  const frames = typeof at === 'number' ? [at] : [...at].sort((a, b) => a - b);
  const v = pulseAt(frames, f, decay ?? timing.flash * fps, 1.6) * peak;
  if (v <= 0.002) return null;
  const background = origin
    ? `radial-gradient(circle ${origin.radius ?? 0.83 * height}px at ${origin.x}px ${origin.y}px, ${alpha(color, 1)} 0%, ${alpha(
        color,
        0.55,
      )} 30%, ${alpha(color, 0)} 100%)`
    : color;
  return (
    <AbsoluteFill
      style={{
        background,
        opacity: v,
        mixBlendMode: blend,
        pointerEvents: 'none',
      }}
    />
  );
};
