import type {CSSProperties, ReactNode} from 'react';
import {color as palette} from '../brand/tokens';
import {useGlobalFrame} from '../clock';
import {useFormat} from '../format';
import {mix, parseColor, progress, sineInOut, type EasingFn} from '../motion';
import {useFilterId} from './filterId';

export interface LightSweepProps {
  /** Film frame the sweep starts. */
  at: number;
  /** Frames to cross (default 0.7 s). */
  duration?: number;
  /** Band angle in degrees (default 105: leaning like light from the top left). */
  angle?: number;
  /** Band half-width as % of the element (default 14). */
  width?: number;
  /** Peak brightness 0..1 (default 0.85). Use about 0.2 on panels. */
  intensity?: number;
  /**
   * Bloom radius, px (default 10 reference px; 0 = none). The glow around the
   * lit band is what makes a sweep visible on WHITE text, where brightening
   * alone does nothing.
   */
  bloom?: number;
  /** Tint of the light (default white). */
  color?: string;
  easing?: EasingFn;
  /** Lay out as a full-frame layer instead of an inline box. */
  fill?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * A gloss pass that follows the exact shape of its children (text, SVG,
 * images): a light-coloured silhouette of the children plus a bloom, masked to
 * a moving soft band and added on top. Works on anything with alpha, and
 * renders the children a second time only while the band is crossing.
 */
export const LightSweep: React.FC<LightSweepProps> = ({
  at,
  duration,
  angle = 105,
  width = 14,
  intensity = 0.85,
  bloom,
  color = palette.white,
  easing = sineInOut,
  fill = false,
  style,
  children,
}) => {
  const f = useGlobalFrame();
  const {fps, unit} = useFormat();
  const id = useFilterId('ls');
  const p = progress(f, at, duration ?? 0.7 * fps);
  const box: CSSProperties = fill
    ? {position: 'absolute', inset: 0}
    : {position: 'relative', display: 'inline-block'};
  if (p <= 0 || p >= 1) return <div style={{...box, ...style}}>{children}</div>;
  const glow = bloom ?? 10 * unit;
  const c = mix(-width * 1.5, 100 + width * 1.5, easing(p));
  const band = `linear-gradient(${angle}deg, rgba(0,0,0,0) ${c - width}%, rgba(0,0,0,0.35) ${c - width * 0.5}%, rgba(0,0,0,1) ${c}%, rgba(0,0,0,0.35) ${
    c + width * 0.5
  }%, rgba(0,0,0,0) ${c + width}%)`;
  // Fade the sweep in and out at the ends so it never pops.
  const edge = Math.min(1, p / 0.12, (1 - p) / 0.12);
  const [r, g, b] = parseColor(color);
  const matrix = `0 0 0 0 ${r / 255}  0 0 0 0 ${g / 255}  0 0 0 0 ${b / 255}  0 0 0 1 0`;
  return (
    <div style={{...box, ...style}}>
      {children}
      <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden>
        <filter
          id={id}
          x="-20%"
          y="-40%"
          width="140%"
          height="180%"
          colorInterpolationFilters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values={matrix}
            result="lit"
          />
          {glow > 0 ? (
            <feGaussianBlur in="lit" stdDeviation={glow} result="glow" />
          ) : null}
          <feMerge>
            {glow > 0 ? <feMergeNode in="glow" /> : null}
            {glow > 0 ? <feMergeNode in="glow" /> : null}
            <feMergeNode in="lit" />
          </feMerge>
        </filter>
      </svg>
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          filter: `url(#${id})`,
          WebkitMaskImage: band,
          maskImage: band,
          opacity: intensity * edge,
          mixBlendMode: 'plus-lighter',
          pointerEvents: 'none',
        }}>
        {children}
      </div>
    </div>
  );
};
