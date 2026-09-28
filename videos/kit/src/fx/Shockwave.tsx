import {color as palette} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha, expoOut, mix, type EasingFn} from '../motion';

export interface ShockwaveProps {
  /** Film frame of the impact. */
  at: number;
  /** Centre, px in the parent. */
  x: number;
  y: number;
  /** Final radius, px (default 420 reference px). */
  radius?: number;
  /** Starting radius, px (default 0). */
  startRadius?: number;
  /** Frames to expand and fade (default 0.6 s). */
  duration?: number;
  color?: string;
  /** Ring thickness at the start, px (default 16 reference px; thins as it grows). */
  thickness?: number;
  /** Vertical squash for a ring lying on a tilted plane (0.35 on a highway's strikeline). */
  aspect?: number;
  intensity?: number;
  /** Echo rings, each `ringGap` frames later, smaller and dimmer. */
  rings?: number;
  /** Frames between echo rings (default 1/12 s). */
  ringGap?: number;
  easing?: EasingFn;
}

/**
 * An expanding ring of light from an impact: a bright core, a soft halo and a
 * faint pressure wash inside. Radial CSS gradients added with `plus-lighter`:
 * sharp, soft-edged and cheap.
 */
export const Shockwave: React.FC<ShockwaveProps> = ({
  at,
  x,
  y,
  radius,
  startRadius = 0,
  duration,
  color = palette.white,
  thickness,
  aspect = 1,
  intensity = 1,
  rings = 1,
  ringGap,
  easing = expoOut,
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const R0 = radius ?? 420 * unit;
  const T = thickness ?? 16 * unit;
  const dur = duration ?? 0.6 * fps;
  const gap = ringGap ?? fps / 12;
  const nodes = [];
  for (let k = 0; k < rings; k++) {
    const start = at + k * gap;
    const p = (f - start) / dur;
    if (p < 0 || p >= 1) continue;
    const e = easing(p);
    const R = R0 * (1 - 0.18 * k);
    const r = mix(startRadius, R, e);
    const w = Math.max(1.5 * unit, T * (1 - 0.75 * p) * (1 - 0.2 * k));
    const a = intensity * Math.pow(1 - p, 1.6) * (1 - 0.3 * k);
    const size = 2 * (R + T * 3);
    const inner = Math.max(0, r - w * 2.2);
    const bg = [
      `radial-gradient(circle closest-side, ${alpha(color, 0)} ${inner}px, ${alpha(color, a * 0.3)} ${Math.max(
        0,
        r - w * 0.9,
      )}px, ${alpha(color, a)} ${r}px, ${alpha(color, a * 0.25)} ${r + w * 0.9}px, ${alpha(color, 0)} ${r + w * 2.4}px)`,
      `radial-gradient(circle closest-side, ${alpha(color, a * 0.1 * (1 - p))} 0px, ${alpha(color, 0)} ${Math.max(1, r)}px)`,
    ].join(', ');
    nodes.push(
      <div
        key={k}
        style={{
          position: 'absolute',
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          background: bg,
          transform: aspect !== 1 ? `scaleY(${aspect})` : undefined,
          mixBlendMode: 'plus-lighter',
          pointerEvents: 'none',
        }}
      />,
    );
  }
  return nodes.length > 0 ? <>{nodes}</> : null;
};
