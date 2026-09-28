/**
 * Callouts: a leader line from a label in negative space to an exact point
 * of the UI (project the point through the camera to land on it), drawn on
 * from a film frame, with a target mark where it lands.
 */
import type {CSSProperties, ReactNode} from 'react';
import {color, springs} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {alpha, clamp01, progress, spring01, type Point} from '../motion';
import {textStyle} from '../text/style';

export interface LeaderProps {
  /** Film frame the line starts drawing. */
  at: number;
  /** Film frame it starts fading out. */
  exitAt?: number;
  /** The point being called out, px in the full-frame layer the leader is drawn in. The target mark sits here. */
  anchor: Point;
  /** The label's end of the line, px in the same layer. */
  label: Point;
  /** Corners between the label end and the anchor, in order from the label. */
  via?: readonly Point[];
  /** The end the line draws from (default 'label': it travels to the anchor and lands on it). */
  from?: 'label' | 'anchor';
  color?: string;
  /** Line width, px (default 2.5 reference px). */
  width?: number;
  /** Target ring radius at the anchor, px (default 18 reference px; 0 = a dot only). */
  ring?: number;
  /** A ring pulsing out of the target once a second while it holds (default true). */
  pulse?: boolean;
  /** A dark under-stroke that keeps the line legible over busy UI (default true). */
  halo?: boolean;
  /** Frames the line takes to draw (default 0.47 s). */
  duration?: number;
}

const polylineLength = (pts: readonly Point[]): number => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as Point;
    const b = pts[i] as Point;
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
};

/** 0..1 visibility after `exitAt` (1 before it). */
const exitFade = (f: number, exitAt: number | undefined, fps: number) =>
  exitAt === undefined ? 1 : 1 - ease.enter(progress(f, exitAt, fps / 3));

/**
 * A leader line with a target mark at the anchor: a ring that springs open
 * when the line arrives, a dot, and a slow pulse while it holds.
 */
export const Leader: React.FC<LeaderProps> = ({
  at,
  exitAt,
  anchor,
  label,
  via = [],
  from = 'label',
  color: c = color.fuchsia,
  width,
  ring,
  pulse = true,
  halo = true,
  duration,
}) => {
  const f = useGlobalFrame();
  const {fps, unit, width: frameW, height: frameH} = useFormat();
  if (f < at) return null;
  const vis = exitFade(f, exitAt, fps);
  if (vis <= 0.001) return null;
  const dur = duration ?? 0.47 * fps;
  const draw = ease.enter(progress(f, at, dur));
  const pts =
    from === 'label'
      ? [label, ...via, anchor]
      : [anchor, ...[...via].reverse(), label];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  const len = polylineLength(pts);
  const w = width ?? 2.5 * unit;
  const R = ring ?? 18 * unit;
  // The target lands when the line reaches the anchor.
  const landAt = from === 'label' ? at + 0.7 * dur : at;
  const land = spring01(f, landAt, springs.wobble, fps);
  const pulseP = ((f - landAt) / fps) % 1;
  const dash = {
    strokeDasharray: len,
    strokeDashoffset: len * (1 - draw),
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const startDot = from === 'label' ? label : anchor;
  return (
    <svg
      width={frameW}
      height={frameH}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        opacity: vis,
        pointerEvents: 'none',
        filter: `drop-shadow(0 0 ${6 * unit}px ${alpha(c, 0.55)})`,
      }}
      aria-hidden>
      {halo ? (
        <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={w * 2.4} {...dash} />
      ) : null}
      <path d={d} stroke={c} strokeWidth={w} {...dash} />
      <circle
        cx={startDot.x}
        cy={startDot.y}
        r={4 * unit * Math.min(1, draw * 3)}
        fill={c}
      />
      {f >= landAt ? (
        <>
          {R > 0 ? (
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r={Math.max(0, R * land)}
              fill="none"
              stroke={c}
              strokeWidth={w}
            />
          ) : null}
          {R > 0 && pulse ? (
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r={R * (1 + pulseP * 1.2)}
              fill="none"
              stroke={c}
              strokeWidth={w * 0.8}
              opacity={(1 - pulseP) * 0.5 * clamp01(land)}
            />
          ) : null}
          <circle
            cx={anchor.x}
            cy={anchor.y}
            r={Math.max(0, 6 * unit * land)}
            fill={c}
          />
        </>
      ) : null}
    </svg>
  );
};

export interface CalloutProps extends LeaderProps {
  /** The label. */
  children: ReactNode;
  /**
   * 'left': the label's left edge sits just right of the label point;
   * 'right': its right edge sits just left of it. Default: away from the anchor.
   */
  align?: 'left' | 'right';
  /** 'box': a dark card with an accent rim (default). 'plain': mono, uppercase, like an eyebrow. */
  look?: 'box' | 'plain';
  labelStyle?: CSSProperties;
}

/**
 * A leader line and its label. The label sits beside the label point,
 * vertically centred on it, and arrives with the line.
 *
 * ```tsx
 * const cell = project(pose, lens, {x: 820, y: 182});
 * <Callout at={f} exitAt={f + 150} anchor={cell} label={{x: 1290 * unit, y: cell.y}}>
 *   Every score shows its work.
 * </Callout>
 * ```
 */
export const Callout: React.FC<CalloutProps> = ({
  children,
  align,
  look = 'box',
  labelStyle,
  ...leader
}) => {
  const f = useGlobalFrame();
  const {fps, unit, width: frameW} = useFormat();
  const {at, exitAt, anchor, label} = leader;
  const c = leader.color ?? color.fuchsia;
  const side = align ?? (anchor.x > label.x ? 'right' : 'left');
  const dur = leader.duration ?? 0.47 * fps;
  // Drawn from the label, the label is there first; drawn from the anchor, it arrives with the line.
  const shownAt = (leader.from ?? 'label') === 'label' ? at : at + 0.4 * dur;
  const p = ease.enter(progress(f, shownAt, 0.3 * fps));
  const vis = p * exitFade(f, exitAt, fps);
  const gap = 18 * unit;
  const slide = (1 - p) * 16 * unit * (side === 'left' ? -1 : 1);
  const labelLook: CSSProperties =
    look === 'box'
      ? textStyle('callout', unit, {
          color: color.white,
          padding: `${12 * unit}px ${22 * unit}px`,
          borderRadius: 16 * unit,
          background: alpha(color.stage, 0.95),
          border: `${unit}px solid ${alpha(c, 0.45)}`,
          boxShadow: `0 ${20 * unit}px ${50 * unit}px rgba(0,0,0,0.55), 0 0 ${30 * unit}px ${alpha(c, 0.18)}`,
        })
      : textStyle('eyebrow', unit, {fontSize: 20 * unit, color: c});
  return (
    <>
      <Leader {...leader} />
      {vis > 0.001 ? (
        <div
          style={{
            position: 'absolute',
            top: label.y,
            ...(side === 'right'
              ? {right: frameW - label.x + gap}
              : {left: label.x + gap}),
            transform: `translate(${slide}px, -50%)`,
            opacity: vis,
            whiteSpace: 'nowrap',
            ...labelLook,
            ...labelStyle,
          }}>
          {children}
        </div>
      ) : null}
    </>
  );
};
