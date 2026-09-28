/**
 * The one cursor: a macOS-style arrow on scripted or recorded paths. A path
 * is a list of keys in any plane's px; `project` maps them to the screen
 * (through a plane camera, say), so the arrow keeps its size while the plane
 * turns. `recordedCursorPath` (recorder) turns a recording's real pointer
 * into a `CursorScript`.
 */
import {color} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {MotionBlur} from '../fx/MotionBlur';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {
  add,
  bezier,
  dist,
  keyed,
  lerp2,
  norm,
  perp,
  progress,
  scale,
  sub,
  type EasingFn,
  type Vec2,
} from '../motion';
import {ClickRing} from './ClickRing';

export interface CursorKey {
  /** Film frame the cursor arrives here. */
  at: number;
  x: number;
  y: number;
  /** Easing of the move ARRIVING at this key (default `CURSOR_EASE`). */
  ease?: EasingFn;
  /** Sideways bulge as a fraction of the move length (default 0.06; negative bends the other way). */
  arc?: number;
}

/** A window the cursor is shown in: it fades in from `appearAt` and out from `hideAt`. */
export interface CursorWindow {
  appearAt: number;
  /** Omit to stay shown. */
  hideAt?: number;
}

/** Everything a cursor does over time. Recorded or scripted, it is the same shape. */
export interface CursorScript {
  /** Waypoints in film frames: before the first key the cursor waits there; after the last it rests. */
  path: readonly CursorKey[];
  /** Film frames of clicks: a press dip and a ripple at the tip. */
  clicks?: readonly number[];
  /** Held presses [down, up] for drags: a ripple on down, pressed until up. */
  drags?: readonly (readonly [down: number, up: number])[];
  /** When the cursor is shown (default always). */
  visible?: readonly CursorWindow[];
}

/** A natural pointer move: quick to leave, soft to land. */
export const CURSOR_EASE: EasingFn = bezier(0.42, 0, 0.12, 1);

interface CursorPoint extends Vec2 {
  arc?: number;
}

/** A move between two keys: eased along the line, bulging sideways by the arriving key's arc. */
const mixCursor = (a: CursorPoint, b: CursorPoint, e: number): CursorPoint => {
  const p = lerp2(a, b, e);
  const d = dist(a, b);
  if (d < 1) return p;
  const bulge = (b.arc ?? 0.06) * d * 4 * e * (1 - e);
  return add(p, scale(perp(norm(sub(b, a))), bulge));
};

/** Where a path puts the cursor at a (fractional) film frame, in the path's own px. */
export const cursorAt = (path: readonly CursorKey[], frame: number): Vec2 => {
  if (path.length === 0) return {x: 0, y: 0};
  const p = keyed(
    frame,
    path.map(k => ({
      at: k.at,
      value: {x: k.x, y: k.y, arc: k.arc},
      ease: k.ease,
    })),
    mixCursor,
    CURSOR_EASE,
  );
  return {x: p.x, y: p.y};
};

/** The cursor's opacity at a film frame: the strongest of its windows (1 without any). */
export const cursorVisibility = (
  visible: readonly CursorWindow[] | undefined,
  frame: number,
  fps: number,
): number => {
  if (!visible) return 1;
  let v = 0;
  for (const w of visible) {
    const inP = ease.enter(progress(frame, w.appearAt, 0.2 * fps));
    const outP =
      w.hideAt === undefined
        ? 0
        : ease.exit(progress(frame, w.hideAt, (1 / 6) * fps));
    v = Math.max(v, inP * (1 - outP));
  }
  return v;
};

/** 0..1 how pressed the button is: a dip around clicks, held through drags. */
const pressAt = (
  frame: number,
  fps: number,
  clicks: readonly number[],
  drags: readonly (readonly [number, number])[],
): number => {
  const before = 0.05 * fps;
  const after = 0.13 * fps;
  const release = 0.1 * fps;
  let press = 0;
  for (const c of clicks) {
    const d = frame - c;
    if (d >= -before && d < 0) press = Math.max(press, (d + before) / before);
    else if (d >= 0 && d < after) press = Math.max(press, 1 - d / after);
  }
  for (const [down, up] of drags) {
    if (frame >= down - before && frame < down)
      press = Math.max(press, (frame - down + before) / before);
    else if (frame >= down && frame <= up) press = 1;
    else if (frame > up && frame < up + release)
      press = Math.max(press, 1 - (frame - up) / release);
  }
  return ease.settle(press);
};

const ARROW =
  'M2 2 L2 23.5 L7.1 18.6 L10.3 26.3 L13.9 24.8 L10.8 17.3 L17.7 17.3 Z';
const VIEW_W = 20;
const VIEW_H = 29;
const TIP = 2;

export interface CursorProps extends CursorScript {
  /** Maps path points to screen px (e.g. `p => project(pose, lens, p)`). Default: the path is screen px. */
  project?: (p: Vec2) => Vec2;
  /** Arrow height, px (default 40 reference px). */
  size?: number;
  /** 'dark': a black arrow with a white rim (default). 'light': a white arrow with a black rim. */
  look?: 'dark' | 'light';
  /** Ripple colour (default white). Use an accent for a highlight click. */
  rippleColor?: string;
  /** Directional blur when moving fast (default true). */
  motionBlur?: boolean;
  /** Extra opacity multiplier, 0..1. */
  opacity?: number;
}

/**
 * A macOS-style arrow that follows eased, slightly arced paths, dips when
 * pressed, rings a ripple on clicks, and smears when it moves fast.
 *
 * ```tsx
 * <Cursor
 *   path={[{at: f0, x: 1500, y: 900}, {at: f0 + 24, x: 980, y: 540}]}
 *   drags={[[f0 + 28, f0 + 40]]}
 *   visible={[{appearAt: f0 - 10, hideAt: f0 + 90}]}
 * />
 * <Cursor {...recordedCursorPath(manifest)} project={p => project(pose, lens, p)} />
 * ```
 */
export const Cursor: React.FC<CursorProps> = ({
  path,
  clicks = [],
  drags = [],
  visible,
  project = p => p,
  size,
  look = 'dark',
  rippleColor = color.white,
  motionBlur = true,
  opacity = 1,
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const vis = cursorVisibility(visible, f, fps) * opacity;
  const pos = project(cursorAt(path, f));
  const h = size ?? 40 * unit;
  const k = h / VIEW_H;
  const press = pressAt(f, fps, clicks, drags);
  const before = project(cursorAt(path, f - 0.5));
  const after = project(cursorAt(path, f + 0.5));
  // The arrow grows in from 70% as its window opens.
  const grow = visible
    ? visible.reduce(
        (m, w) => Math.max(m, ease.enter(progress(f, w.appearAt, 0.2 * fps))),
        0,
      )
    : 1;

  const ripples = [...clicks, ...drags.map(([d]) => d)].map((c, i) => {
    const at = project(cursorAt(path, c));
    return (
      <ClickRing
        key={`r${i}`}
        x={at.x}
        y={at.y}
        at={c}
        color={rippleColor}
        from={6 * unit}
        to={36 * unit}
        duration={0.4 * fps}
        width={2.6 * unit}
        core={9 * unit}
      />
    );
  });

  if (vis <= 0.001) return <>{ripples}</>;
  const fill = look === 'dark' ? '#0e0e10' : color.white;
  const rim = look === 'dark' ? color.white : '#0e0e10';
  const arrow = (
    <svg
      width={VIEW_W * k}
      height={VIEW_H * k}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={{
        overflow: 'visible',
        display: 'block',
        filter: `drop-shadow(0 ${(2 + press) * unit}px ${(3 - press) * unit}px rgba(0,0,0,0.5))`,
      }}
      aria-hidden>
      <path
        d={ARROW}
        fill={fill}
        stroke={rim}
        strokeWidth={2.4}
        strokeLinejoin="round"
        paintOrder="stroke"
      />
    </svg>
  );
  return (
    <>
      {ripples}
      <div
        style={{
          position: 'absolute',
          left: pos.x - TIP * k,
          top: pos.y - TIP * k,
          opacity: vis,
          transform: `scale(${(0.7 + 0.3 * grow) * (1 - 0.12 * press)})`,
          transformOrigin: `${TIP * k}px ${TIP * k}px`,
          pointerEvents: 'none',
        }}>
        {motionBlur ? (
          <MotionBlur
            vx={after.x - before.x}
            vy={after.y - before.y}
            shutter={0.45}
            threshold={2.5 * unit}
            max={60 * unit}>
            {arrow}
          </MotionBlur>
        ) : (
          arrow
        )}
      </div>
    </>
  );
};
