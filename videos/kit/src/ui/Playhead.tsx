import type {CSSProperties, ReactNode} from 'react';
import {color} from '../brand/tokens';
import {useFormat} from '../format';
import {alpha} from '../motion';

export interface PlayheadProps {
  /** x of the line's centre, px. */
  x: number;
  top: number;
  height: number;
  color?: string;
  /** The glow's colour (default the brand purple). */
  glowColor?: string;
  /** Line width, px (default 2 reference px). */
  width?: number;
  /** 0..1 glow (default 0.6). */
  glow?: number;
  /** Handle at the top: a downward triangle, a pill, or none. */
  handle?: 'triangle' | 'pill' | 'none';
  /** Optional label above the handle (e.g. a timestamp chip). */
  label?: ReactNode;
  style?: CSSProperties;
}

/**
 * The playhead: a thin line with a soft glow and a handle. Playheads (and
 * scrolling time) are the only things that should move linearly.
 */
export const Playhead: React.FC<PlayheadProps> = ({
  x,
  top,
  height,
  color: c = color.text,
  glowColor = color.purple,
  width,
  glow = 0.6,
  handle = 'triangle',
  label,
  style,
}) => {
  const {unit} = useFormat();
  const w = width ?? 2 * unit;
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top,
        width: 0,
        height,
        pointerEvents: 'none',
        ...style,
      }}>
      <div
        style={{
          position: 'absolute',
          left: -w / 2,
          top: 0,
          width: w,
          height,
          background: `linear-gradient(180deg, ${c} 0%, ${c} 82%, ${alpha(c, 0)} 100%)`,
          boxShadow:
            glow > 0
              ? `0 0 ${10 * glow * unit}px ${alpha(glowColor, 0.9 * glow)}, 0 0 ${26 * glow * unit}px ${alpha(glowColor, 0.5 * glow)}`
              : undefined,
          borderRadius: w,
        }}
      />
      {handle === 'triangle' ? (
        <svg
          width={18 * unit}
          height={12 * unit}
          viewBox="0 0 18 12"
          style={{
            position: 'absolute',
            left: -9 * unit,
            top: -11 * unit,
            overflow: 'visible',
          }}
          aria-hidden>
          <path
            d="M2 1.5 H16 L9 10.5 Z"
            fill={c}
            stroke={c}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        </svg>
      ) : handle === 'pill' ? (
        <div
          style={{
            position: 'absolute',
            left: -6 * unit,
            top: -14 * unit,
            width: 12 * unit,
            height: 14 * unit,
            borderRadius: 4 * unit,
            background: c,
          }}
        />
      ) : null}
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: -20 * unit,
            transform: 'translate(-50%, -100%)',
          }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};
