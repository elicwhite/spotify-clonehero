import {color} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {ease} from '../brand/ease';
import {alpha} from '../motion';

export interface ClickRingProps {
  /** Where the click lands, px in the parent. */
  x: number;
  y: number;
  /** Film frame of the click. */
  at: number;
  color?: string;
  /** Starting radius, px: start wide to ring a label rather than cover it (default 10 reference px). */
  from?: number;
  /** Final radius, px (default 120 reference px). */
  to?: number;
  /** Frames the ring grows and fades over (default 0.6 s). */
  duration?: number;
  /** Ring stroke at the start, px (default 4 reference px; thins as it grows). */
  width?: number;
  /** Radius of the flash at the centre of the click, px (default 40 reference px; 0 = none). */
  core?: number;
}

/**
 * An expanding ring where a click lands, with a glow and a quick flash at its
 * centre (peaks 0.1 s in, gone by 0.33 s). Draws nothing outside its
 * `duration`.
 */
export const ClickRing: React.FC<ClickRingProps> = ({
  x,
  y,
  at,
  color: c = color.fuchsia,
  from,
  to,
  duration,
  width,
  core,
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const since = (f - at) / fps;
  const dur = (duration ?? 0.6 * fps) / fps;
  if (since < 0 || since >= dur) return null;
  const e = ease.enter(since / dur);
  const r0 = from ?? 10 * unit;
  const r1 = to ?? 120 * unit;
  const r = r0 + e * (r1 - r0);
  const stroke = (width ?? 4 * unit) * (1 - 0.5 * e);
  const a = 1 - e;
  const coreR = core ?? 40 * unit;
  const coreA =
    since < 0.1
      ? (0.9 * since) / 0.1
      : 0.9 * Math.max(0, 1 - (since - 0.1) / 0.233);
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x - r,
          top: y - r,
          width: 2 * r,
          height: 2 * r,
          borderRadius: '50%',
          border: `${stroke}px solid ${alpha(c, a)}`,
          boxShadow: `0 0 ${0.25 * r1}px ${alpha(c, a)}`,
          pointerEvents: 'none',
        }}
      />
      {coreR > 0 && coreA > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            left: x - coreR,
            top: y - coreR,
            width: 2 * coreR,
            height: 2 * coreR,
            borderRadius: '50%',
            background: `radial-gradient(circle, ${alpha(c, coreA)} 0%, ${alpha(c, 0)} 70%)`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
};
