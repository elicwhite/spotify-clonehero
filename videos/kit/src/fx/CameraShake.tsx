import {noise2D} from '@remotion/noise';
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {decayPulse, framesSince, useGlobalFrame} from '../clock';
import {timing} from '../brand/tokens';
import {useFormat} from '../format';

export interface CameraShakeProps {
  /** Film frame(s) that start a shake. */
  at: number | readonly number[];
  /** Peak translation, px (default 14 reference px). */
  intensity?: number;
  /** Peak rotation, degrees (default 0.5). */
  rotation?: number;
  /** Frames until still (default `timing.shake` seconds). */
  duration?: number;
  /** Noise speed, cycles per second (default 51: violent and short). */
  frequency?: number;
  seed?: string;
  /**
   * Layer style. A `transform` here is kept: the shake moves the layer inside
   * it, pivoting on the layer's transform origin (the centre by default, which
   * the overscan assumes).
   */
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * The uniform scale about the frame centre that keeps a `w` x `h` layer,
 * moved by (x, y) px and turned by `deg`, covering the whole frame.
 */
export const shakeOverscan = (
  w: number,
  h: number,
  x: number,
  y: number,
  deg: number,
): number => {
  const r = Math.abs((deg * Math.PI) / 180);
  const c = Math.cos(r);
  const s = Math.sin(r);
  const ax = w / 2 + Math.abs(x);
  const ay = h / 2 + Math.abs(y);
  return Math.max(1, (ax * c + ay * s) / (w / 2), (ax * s + ay * c) / (h / 2));
};

/**
 * A decaying, deterministic shake (simplex noise, not random jitter), scaled
 * up while it shakes just enough that the frame edge never shows.
 */
export const CameraShake: React.FC<CameraShakeProps> = ({
  at,
  intensity,
  rotation = 0.5,
  duration,
  frequency = 51,
  seed = 'shake',
  style,
  children,
}) => {
  const f = useGlobalFrame();
  const {fps, unit, width, height} = useFormat();
  const frames = typeof at === 'number' ? [at] : [...at].sort((a, b) => a - b);
  const since = framesSince(frames, f);
  const env = decayPulse(since, duration ?? timing.shake * fps, 1.5);
  if (env <= 0) return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
  const amp = (intensity ?? 14 * unit) * env;
  const n = (since / fps) * frequency;
  const x = noise2D(seed, n, 0.5) * amp;
  const y = noise2D(seed, 7.3, n) * amp;
  const r = noise2D(`${seed}-r`, n, 3.1) * rotation * env;
  const overscan = shakeOverscan(width, height, x, y, r);
  const shake = `translate(${x}px, ${y}px) rotate(${r}deg) scale(${overscan})`;
  return (
    <AbsoluteFill
      style={{
        ...style,
        transform: style?.transform ? `${style.transform} ${shake}` : shake,
      }}>
      {children}
    </AbsoluteFill>
  );
};
