/**
 * Marks drawn INSIDE a plane (a `PlaneView`), in the plane's own px, so they
 * tilt and scale with it: a ring that outlines a control, and a flash that
 * pulses out of one as it changes state.
 */
import {color, springs} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {alpha, progress, spring01, type Rect} from '../motion';

export interface PlaneRingProps {
  /** Film frame the ring springs on. */
  at: number;
  /** Film frame it starts fading out. */
  exitAt?: number;
  /** The control it outlines, plane px. */
  box: Rect;
  /** Gap between the control and the ring, plane px (default 5). */
  pad?: number;
  /** Corner radius, plane px (default 9). */
  radius?: number;
  color?: string;
  /** A fill inside the ring (default none). */
  fill?: string;
}

/** A glowing outline around a control that springs in from a little larger. */
export const PlaneRing: React.FC<PlaneRingProps> = ({
  at,
  exitAt,
  box,
  pad = 5,
  radius = 9,
  color: c = color.fuchsia,
  fill,
}) => {
  const f = useGlobalFrame();
  const {fps} = useFormat();
  if (f < at) return null;
  const p = spring01(f, at, springs.wobble, fps);
  const o = exitAt === undefined ? 0 : ease.enter(progress(f, exitAt, fps / 3));
  if (o >= 1) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - pad,
        top: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        borderRadius: radius,
        border: `2px solid ${c}`,
        background: fill,
        boxShadow: `0 0 18px ${alpha(c, 0.6)}, inset 0 0 12px ${alpha(c, 0.2)}`,
        opacity: Math.min(1, p * 1.5) * (1 - o),
        transform: `scale(${1.25 - 0.25 * p})`,
        pointerEvents: 'none',
      }}
    />
  );
};

export interface PlaneFlashProps {
  /** Film frame the control changes state. */
  at: number;
  /** The control, plane px. */
  box: Rect;
  color?: string;
  /** Frames the flash lasts (default 0.8 s). */
  duration?: number;
}

/** A ring that pulses out of a control as it changes state, then fades. */
export const PlaneFlash: React.FC<PlaneFlashProps> = ({
  at,
  box,
  color: c = color.emerald,
  duration,
}) => {
  const f = useGlobalFrame();
  const {fps} = useFormat();
  const dur = duration ?? 0.8 * fps;
  if (f < at || f > at + dur) return null;
  const t = ease.enter(progress(f, at, dur));
  const grow = 4 + t * 26;
  return (
    <div
      style={{
        position: 'absolute',
        left: box.x - grow,
        top: box.y - grow,
        width: box.width + grow * 2,
        height: box.height + grow * 2,
        borderRadius: 10 + grow,
        border: `2px solid ${c}`,
        opacity: (1 - t) * 0.9,
        boxShadow: `0 0 30px ${c}`,
        pointerEvents: 'none',
      }}
    />
  );
};
