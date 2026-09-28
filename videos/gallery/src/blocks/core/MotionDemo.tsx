/**
 * Motion: the five spring presets released together, each with its settle
 * frame at this fps, and the brand easings drawn as curves with a dot riding
 * each one.
 */
import {AbsoluteFill} from 'remotion';
import {
  color,
  ease,
  fontFamily,
  LANE_COLORS,
  springs,
  stageBackground,
  type SpringName,
} from '@musiccharts/video-kit/brand';
import {useGlobalFrame} from '@musiccharts/video-kit/clock';
import {useFormat} from '@musiccharts/video-kit/format';
import {
  glide,
  mod,
  settle,
  spring01,
  type EasingFn,
} from '@musiccharts/video-kit/motion';

const SPRINGS = Object.keys(springs) as SpringName[];

const EASINGS: [string, EasingFn][] = [
  ['enter', ease.enter],
  ['exit', ease.exit],
  ['camera', ease.camera],
  ['drift', ease.drift],
  ['settle', ease.settle],
  ['glide', t => glide(t)],
];

/** Springs release half a second in; easings loop over a second and a half. */
const RELEASE_SEC = 0.5;
const EASE_LOOP_SEC = 1.5;

const Springs: React.FC = () => {
  const {fps, unit, width, safe} = useFormat();
  const frame = useGlobalFrame();
  const release = RELEASE_SEC * fps;
  const travel = width * 0.3;
  return (
    <>
      {SPRINGS.map((name, row) => {
        const x = spring01(frame, release, springs[name], fps) * travel;
        const settled = release + settle(springs[name], fps);
        return (
          <div
            key={name}
            style={{
              position: 'absolute',
              left: safe.x,
              top: (140 + row * 150) * unit,
              width: travel + 360 * unit,
              fontFamily: fontFamily.mono,
              fontSize: 24 * unit,
              color: frame >= settled ? color.emerald : color.muted,
            }}>
            {name} settles on frame {settled}
            <div
              style={{
                marginTop: 16 * unit,
                width: 36 * unit,
                height: 36 * unit,
                borderRadius: 999,
                background: LANE_COLORS[row % LANE_COLORS.length],
                transform: `translateX(${x}px)`,
              }}
            />
          </div>
        );
      })}
    </>
  );
};

const Easings: React.FC = () => {
  const {fps, unit, width} = useFormat();
  const frame = useGlobalFrame();
  const size = 180 * unit;
  const t = Math.min(1, mod(frame, EASE_LOOP_SEC * fps) / fps);
  return (
    <div
      style={{
        position: 'absolute',
        left: width * 0.52,
        top: 120 * unit,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, auto)',
        gap: 48 * unit,
      }}>
      {EASINGS.map(([name, fn]) => {
        const points = Array.from({length: 41}, (_, i) => {
          const u = i / 40;
          return `${u * size},${size - fn(u) * size}`;
        }).join(' ');
        return (
          <div
            key={name}
            style={{
              fontFamily: fontFamily.mono,
              fontSize: 22 * unit,
              color: color.muted,
            }}>
            <svg width={size} height={size} style={{overflow: 'visible'}}>
              <rect
                width={size}
                height={size}
                fill="none"
                stroke={color.hairline}
              />
              <polyline
                points={points}
                fill="none"
                stroke={color.purple}
                strokeWidth={3 * unit}
              />
              <circle
                cx={t * size}
                cy={size - fn(t) * size}
                r={9 * unit}
                fill={color.white}
              />
            </svg>
            <div style={{marginTop: 12 * unit}}>{name}</div>
          </div>
        );
      })}
    </div>
  );
};

export const MotionDemo: React.FC = () => (
  <AbsoluteFill style={{background: stageBackground}}>
    <Springs />
    <Easings />
  </AbsoluteFill>
);
