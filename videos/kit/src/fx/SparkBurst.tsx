import {useMemo} from 'react';
import {color, LANE_COLORS} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha, ballistic, mixColor, rng} from '../motion';

export interface SparkBurstProps {
  /** Film frame of the burst. */
  at: number;
  /** Origin, px in the parent. Moving it only moves the burst: the particles are seeded by `seed` and `at`. */
  x: number;
  y: number;
  /** Particles (default 26). */
  count?: number;
  /** Palette the particles pick from (default: the five lane colours). */
  colors?: readonly string[];
  /** Initial speed range, px per second (default 380-1100 reference px). */
  speed?: readonly [number, number];
  /** Direction in degrees (0 right, -90 up) and spread (360 = all around). */
  angle?: number;
  spread?: number;
  /** Gravity, px/s^2 (default 1400 reference px, down). */
  gravity?: number;
  /** Linear drag, 1/s (default 3.2). */
  drag?: number;
  /** Lifetime range, seconds (default 0.35-0.8). */
  lifeSec?: readonly [number, number];
  /** Core stroke width, px (default 3 reference px). */
  size?: number;
  /** Streak length as seconds of travel (default 0.03, a built-in motion blur). */
  streakSec?: number;
  /** A wider glow stroke under each spark (default true). */
  glow?: boolean;
  seed?: string;
}

interface Particle {
  vx: number;
  vy: number;
  life: number;
  color: string;
  width: number;
  drag: number;
}

/**
 * Seeded particles with gravity and drag, drawn as hot streaks that cool from
 * white to their own colour. Positions are closed-form functions of time, so
 * any frame renders on its own.
 */
export const SparkBurst: React.FC<SparkBurstProps> = ({
  at,
  x,
  y,
  count = 26,
  colors = LANE_COLORS,
  speed,
  angle = -90,
  spread = 360,
  gravity,
  drag = 3.2,
  lifeSec = [0.35, 0.8],
  size,
  streakSec = 0.03,
  glow = true,
  seed = 'sparks',
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  // Array props are usually new objects every render; key the particles on
  // their values so they are built once per burst.
  const colorKey = colors.join('|');
  const [speedLo, speedHi] = speed ?? [380 * unit, 1100 * unit];
  const [lifeLo, lifeHi] = lifeSec;
  const width = size ?? 3 * unit;
  const fall = gravity ?? 1400 * unit;
  const particles = useMemo<Particle[]>(() => {
    const palette = colorKey.split('|');
    const r = rng(`${seed}|${at}`);
    return Array.from({length: count}, () => {
      const a = ((angle + (r.next() - 0.5) * spread) * Math.PI) / 180;
      const s = r.range(speedLo, speedHi) * (0.6 + 0.4 * r.next());
      return {
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: r.range(lifeLo, lifeHi),
        color: r.pick(palette),
        width: width * r.range(0.6, 1.25),
        drag: drag * r.range(0.8, 1.25),
      };
    });
  }, [
    seed,
    at,
    count,
    colorKey,
    speedLo,
    speedHi,
    angle,
    spread,
    lifeLo,
    lifeHi,
    width,
    drag,
  ]);

  const t = (f - at) / fps;
  if (t < 0 || t > lifeHi) return null;

  const lines = [];
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i] as Particle;
    if (t > p.life) continue;
    const s = ballistic(t, {vx: p.vx, vy: p.vy, gravity: fall, drag: p.drag});
    const px = s.x;
    const py = s.y;
    const u = t / p.life;
    const tailX = px - s.vx * streakSec;
    const tailY = py - s.vy * streakSec;
    const a = Math.pow(1 - u, 1.2);
    const w = p.width * (1 - 0.55 * u);
    const hot = mixColor(color.white, p.color, Math.min(1, u * 2.4 + 0.15));
    if (glow) {
      lines.push(
        <line
          key={`g${i}`}
          x1={tailX}
          y1={tailY}
          x2={px}
          y2={py}
          stroke={alpha(p.color, 0.35 * a)}
          strokeWidth={w * 3.2}
          strokeLinecap="round"
        />,
      );
    }
    lines.push(
      <line
        key={`c${i}`}
        x1={tailX}
        y1={tailY}
        x2={px}
        y2={py}
        stroke={alpha(hot, a)}
        strokeWidth={w}
        strokeLinecap="round"
      />,
    );
  }
  return (
    <svg
      style={{
        position: 'absolute',
        left: x,
        top: y,
        overflow: 'visible',
        mixBlendMode: 'plus-lighter',
        pointerEvents: 'none',
      }}
      width={1}
      height={1}
      aria-hidden>
      {lines}
    </svg>
  );
};
