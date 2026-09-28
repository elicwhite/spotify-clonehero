import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill} from 'remotion';
import {TimeShift} from '../clock';
import {useFormat} from '../format';
import {useFilterId} from './filterId';

/** An SVG Gaussian blur with separate x and y deviations, under a unique filter id. */
const AxisBlurFilter: React.FC<{
  id: string;
  x: number;
  y: number;
  /** Filter region margin, as a fraction of the element (default 0.5). */
  margin?: number;
}> = ({id, x, y, margin = 0.5}) => (
  <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
    <filter
      id={id}
      x={`${-margin * 100}%`}
      y={`${-margin * 100}%`}
      width={`${100 + 2 * margin * 100}%`}
      height={`${100 + 2 * margin * 100}%`}
      colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={`${x.toFixed(2)} ${y.toFixed(2)}`} />
    </filter>
  </svg>
);

export interface MotionBlurProps {
  /** Velocity in px per frame (`velocity(fn, frame)` from motion). */
  vx: number;
  vy: number;
  /**
   * Fraction of the frame the shutter is open (0.5 = 180 degrees). The streak
   * is |v| * shutter px long.
   */
  shutter?: number;
  /** Cap on the streak length, px (default 90 reference px). */
  max?: number;
  /** Below this streak length, px, nothing is applied (default 1.5 reference px). */
  threshold?: number;
  /**
   * 'filter' (default): one SVG Gaussian blur along the motion direction.
   * 'smear': N offset copies added together; a true box blur, costs N renders.
   */
  method?: 'filter' | 'smear';
  samples?: number;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Directional motion blur driven by velocity. Wrap the MOVING element tightly
 * (the filter cost scales with the wrapper's area) and put the motion itself
 * outside it:
 *
 * ```tsx
 * const x = (f: number) => kf(f, [[100, -900], [124, 0, ease.enter]]);
 * <div style={{position: 'absolute', transform: `translateX(${x(frame)}px)`}}>
 *   <MotionBlur vx={velocity(x, frame)} vy={0}><Chip label="4/4" /></MotionBlur>
 * </div>
 * ```
 */
export const MotionBlur: React.FC<MotionBlurProps> = ({
  vx,
  vy,
  shutter = 0.5,
  max,
  threshold,
  method = 'filter',
  samples = 6,
  style,
  children,
}) => {
  const {unit} = useFormat();
  const id = useFilterId('mb');
  const speed = Math.hypot(vx, vy);
  const len = Math.min(max ?? 90 * unit, speed * shutter);
  if (len < (threshold ?? 1.5 * unit))
    return <div style={style}>{children}</div>;
  const angle = (Math.atan2(vy, vx) * 180) / Math.PI;

  if (method === 'smear') {
    const n = Math.max(2, samples);
    const ux = vx / speed;
    const uy = vy / speed;
    return (
      <div style={{...style, position: 'relative', isolation: 'isolate'}}>
        <div style={{visibility: 'hidden'}}>{children}</div>
        {Array.from({length: n}, (_, i) => {
          const k = (i / (n - 1) - 0.5) * len;
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                inset: 0,
                transform: `translate(${-ux * k}px, ${-uy * k}px)`,
                opacity: 1 / n,
                mixBlendMode: 'plus-lighter',
              }}>
              {children}
            </div>
          );
        })}
      </div>
    );
  }

  // A Gaussian sigma of ~0.35 x the streak reads like a box streak of that length.
  const sigma = len * 0.35;
  // Within ~5 degrees of an axis: blur along it directly.
  const nearAxis = Math.abs(Math.sin((angle * Math.PI) / 90)) < 0.17;
  if (nearAxis) {
    const horizontal = Math.abs(vx) >= Math.abs(vy);
    return (
      <div style={{...style, filter: `url(#${id})`}}>
        <AxisBlurFilter
          id={id}
          x={horizontal ? sigma : 0}
          y={horizontal ? 0 : sigma}
        />
        {children}
      </div>
    );
  }
  // Any other angle: turn into the motion's frame, blur along x, turn back.
  return (
    <div style={{...style, transform: `rotate(${angle}deg)`}}>
      <div style={{filter: `url(#${id})`}}>
        <AxisBlurFilter id={id} x={sigma} y={0} margin={1} />
        <div style={{transform: `rotate(${-angle}deg)`}}>{children}</div>
      </div>
    </div>
  );
};

export interface WhipFilterProps {
  /** Horizontal blur, px (the Gaussian deviation). Near 0 the children render untouched. */
  amount: number;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Horizontal-only blur for whip pans: the velocity smear of a camera
 * panning across a hard cut. Every instance has its own filter id, so any
 * number can be on screen at once.
 */
export const WhipFilter: React.FC<WhipFilterProps> = ({
  amount,
  style,
  children,
}) => {
  const id = useFilterId('whip');
  if (amount < 0.3)
    return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{...style, filter: `url(#${id})`}}>
      <AxisBlurFilter id={id} x={amount} y={0} margin={0.2} />
      {children}
    </AbsoluteFill>
  );
};

export interface SampledMotionBlurProps {
  /** Sub-frame samples (4-8). Cost is this many renders of the children. */
  samples?: number;
  /** Shutter as a fraction of a frame (0.5 = 180 degrees). */
  shutter?: number;
  /** Skip sampling (render once) when false, e.g. outside the fast moment. */
  active?: boolean;
  children: ReactNode;
}

/**
 * True temporal motion blur for complex motion (rotation, scale, many parts
 * moving differently): renders the children at `samples` sub-frame times
 * within the shutter and averages them. Every kit component follows the
 * shifted film time. Expensive; enable it only for the frames that need it.
 * Never wrap WebGL or `<Audio>`.
 */
export const SampledMotionBlur: React.FC<SampledMotionBlurProps> = ({
  samples = 6,
  shutter = 0.5,
  active = true,
  children,
}) => {
  if (!active || samples <= 1) return <AbsoluteFill>{children}</AbsoluteFill>;
  return (
    <AbsoluteFill style={{isolation: 'isolate'}}>
      {Array.from({length: samples}, (_, i) => {
        const offset = -shutter * (i / (samples - 1) - 0.5);
        return (
          <AbsoluteFill
            key={i}
            style={{mixBlendMode: 'plus-lighter', opacity: 1 / samples}}>
            <TimeShift by={offset}>{children}</TimeShift>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
