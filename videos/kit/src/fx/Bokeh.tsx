import {AbsoluteFill} from 'remotion';
import {color as palette} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {alpha, rand} from '../motion';
import {particleField} from './particles';

export interface BokehProps {
  seed: string;
  /** Discs (default 7). */
  count?: number;
  /** `[left, top, right, bottom]` px the discs live in and wrap around (default the frame). Keep it clear of type. */
  area?: readonly [number, number, number, number];
  color?: string;
  /** Colour of the brighter third of the discs (default the pale purple). */
  highlight?: string;
  /** Drift, px per second (default 18 right and 9 up, reference px); each disc moves at 0.5-1.5 times it. */
  drift?: readonly [number, number];
}

/**
 * Out-of-focus lights in front of the plane: soft discs with a brighter rim,
 * like a fast lens wide open, drifting slowly and wrapping around their area
 * so the field never empties. Screen-blended, seeded.
 */
export const Bokeh: React.FC<BokehProps> = ({
  seed,
  count = 7,
  area,
  color = palette.fuchsia,
  highlight = palette.purplePale,
  drift,
}) => {
  const frame = useGlobalFrame();
  const {fps, unit, width, height} = useFormat();
  const discs = particleField(frame, fps, {
    seed,
    count,
    area: area ?? [0, 0, width, height],
    drift: drift ?? [18 * unit, -9 * unit],
    speed: [0.5, 1.5],
    size: [40 * unit, 150 * unit],
    colors: [color, color, highlight],
  });
  return (
    <AbsoluteFill style={{pointerEvents: 'none', mixBlendMode: 'screen'}}>
      {discs.map((d, i) => {
        const a = 0.1 + d.r * 0.16;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: d.x - d.size / 2,
              top: d.y - d.size / 2,
              width: d.size,
              height: d.size,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${alpha(d.color, a * 0.35)} 0%, ${alpha(d.color, a * 0.5)} 58%, ${alpha(
                d.color,
                a,
              )} 66%, ${alpha(d.color, 0)} 71%)`,
              filter: `blur(${(3 + rand(seed, 'blur', i) * 4) * unit}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
