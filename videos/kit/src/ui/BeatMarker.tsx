import type {CSSProperties} from 'react';
import {color, springs} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha, clamp01, mixColor, spring01, springAt} from '../motion';
import {textStyle} from '../text/style';

export interface BeatMarkerProps {
  /** x of the line, px in the parent. */
  x: number;
  /** y of the line's bottom end (it grows upward from here), px. */
  baseline: number;
  /** Line length, px (a downbeat draws this tall; a beat 62% of it). */
  height: number;
  downbeat?: boolean;
  /** Mono label under the line, e.g. "1.1". */
  label?: string;
  /** Film frame the marker lands on: it squashes there and pops its label. Omit for a resting marker. */
  landAt?: number;
  /** Line colour (default white for downbeats, dim white for beats). */
  color?: string;
  /** 0..1 highlight in `highlightColor` (the snapped or selected state). */
  highlight?: number;
  highlightColor?: string;
  /** 0..1 extra glow (e.g. as the marker is revealed). */
  glow?: number;
  style?: CSSProperties;
}

/**
 * A beat line with a mono label: lands on its frame with a squash and a
 * single rebound, and pops its label. Downbeats are taller and brighter.
 */
export const BeatMarker: React.FC<BeatMarkerProps> = ({
  x,
  baseline,
  height,
  downbeat = false,
  label,
  landAt,
  color: c,
  highlight = 0,
  highlightColor = color.text,
  glow = 0,
  style,
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const since = landAt === undefined ? Infinity : (f - landAt) / fps;
  const hi = clamp01(highlight);
  const base =
    c ?? (downbeat ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)');
  const lineColor = hi > 0 ? mixColor(base, highlightColor, hi) : base;
  const len = downbeat ? height : height * 0.62;

  let sx = 1;
  let sy = 1;
  if (since >= 0 && since < 2 / 3) {
    // Landed: squash, one rebound, settle (a spring on the squash amount).
    const amt = springAt(since, springs.pop, {from: 0.32, to: 0});
    sy = 1 - amt;
    sx = 1 + amt * 0.6;
  }
  // The label pops a sixtieth of a second after the line lands.
  const labelP =
    landAt === undefined ? 1 : spring01(f, landAt + fps / 60, springs.pop, fps);
  const g = clamp01(glow) + hi * 0.6;
  const w = (downbeat ? 3 : 2) * unit;
  const dot = 8 * unit;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: baseline,
        width: 0,
        height: 0,
        ...style,
      }}>
      <div
        style={{
          position: 'absolute',
          left: -w / 2,
          top: -len,
          width: w,
          height: len,
          borderRadius: w,
          background: `linear-gradient(0deg, ${lineColor} 0%, ${lineColor} 55%, ${alpha(lineColor, 0.25)} 100%)`,
          boxShadow:
            g > 0
              ? `0 0 ${(8 + 14 * g) * unit}px ${alpha(hi > 0 ? highlightColor : color.white, 0.35 + 0.4 * g)}`
              : undefined,
          transform: `scale(${sx}, ${sy})`,
          transformOrigin: '50% 100%',
        }}>
        {downbeat ? (
          <div
            style={{
              position: 'absolute',
              left: w / 2 - dot / 2,
              top: -dot / 2,
              width: dot,
              height: dot,
              borderRadius: '50%',
              background: lineColor,
              boxShadow: `0 0 ${(10 + 12 * g) * unit}px ${alpha(lineColor, 0.7)}`,
            }}
          />
        ) : null}
      </div>
      {label ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 14 * unit,
            transform: `translate(-50%, ${(1 - labelP) * 8 * unit}px) scale(${0.7 + 0.3 * labelP})`,
            transformOrigin: '50% 0%',
            opacity: clamp01(labelP * 1.4),
            ...textStyle(downbeat ? 'micro' : 'microSmall', unit, {
              fontWeight: downbeat ? 600 : 500,
            }),
            color:
              hi > 0
                ? mixColor(
                    downbeat ? color.white : 'rgba(255,255,255,0.6)',
                    highlightColor,
                    hi,
                  )
                : downbeat
                  ? color.text
                  : color.subtle,
            whiteSpace: 'nowrap',
          }}>
          {label}
        </div>
      ) : null}
    </div>
  );
};
