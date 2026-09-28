/**
 * Ways to set the product highway into a shot from outside: crop it into a
 * box and cut the lane out of the canvas's black, light the stage behind it,
 * rim a glass panel, open onto it through an iris, and the full-frame plate
 * that combines them. Nothing here is drawn over the highway's own pixels:
 * light sits behind the lane, rims sit outside it, and fades only take
 * alpha away.
 *
 * Where the lane sits in the canvas comes from the app's own geometry
 * (`floorQuad`), so a crop's horizon and the cutout mask follow the app.
 */
import type {CSSProperties, ReactNode} from 'react';
import {AbsoluteFill, useVideoConfig} from 'remotion';
import {color, lane, stageBackground} from '../brand/tokens';
import {alpha, lighten} from '../motion';
import {EXPERT_DRUMS, type TrackRef} from './editing';
import {highwayInstrumentOf, type HighwayInstrument} from './floor';
import {floorQuad} from './highwayGeometry';
import {ProductHighway, type ProductHighwayProps} from './ProductHighway';

/**
 * The narrowest render box a crop draws the highway in, as width over
 * height: wide enough that the app's camera fit changes nothing for either
 * instrument, so the highway's size follows the render height alone.
 */
const RENDER_MIN_ASPECT = 1.05;

/**
 * An alpha mask (CSS `mask-image`) shaped like the floor of a highway drawn
 * in a `width` x `height` box: the app's floor quad, a little wider and
 * taller than the floor and feathered, so gems and flames at its edges stay
 * whole. It only cuts the renderer's black surround away so the stage shows
 * beside the lane; the lane's own pixels are untouched. The karaoke line,
 * drawn above the floor, is cut away with the black.
 */
export const laneMask = (
  width: number,
  height: number,
  instrument: HighwayInstrument,
): string => {
  const [farLeft, farRight, nearRight, nearLeft] = floorQuad(
    {width, height},
    instrument,
  );
  const margin = 0.012 * height;
  const top = Math.min(farLeft.y, farRight.y) - margin;
  const bottom = Math.max(height, nearLeft.y, nearRight.y);
  const points = [
    [farLeft.x - margin, top],
    [farRight.x + margin, top],
    [nearRight.x + margin, bottom],
    [nearLeft.x - margin, bottom],
  ]
    .map(([x, y]) => `${(x as number).toFixed(1)},${(y as number).toFixed(1)}`)
    .join(' ');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}'><filter id='f'><feGaussianBlur stdDeviation='${(height * 0.003).toFixed(1)}'/></filter><polygon points='${points}' fill='white' filter='url(#f)'/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
};

/** The ProductHighway props a reframed highway passes through: what is drawn and when, on one pane. */
export type CroppedHighwayProps = Omit<
  ProductHighwayProps,
  | 'panes'
  | 'width'
  | 'height'
  | 'style'
  | 'className'
  | 'children'
  | 'laneLabels'
> & {
  /** The track drawn (one pane). Default: Expert drums. */
  track?: TrackRef;
};

export interface HighwayCropProps extends CroppedHighwayProps {
  /** The crop box, CSS px. */
  width: number;
  height: number;
  /** How tall the highway is drawn: the camera is fixed, so the highway scales with it. */
  renderHeight: number;
  /** Where the floor's far end (the fog line) sits, in px from the crop's top. */
  horizonAt: number;
  /**
   * How far down the floor the fade out of the fog reaches, as a fraction of
   * the render box below the far end. A plain alpha fade. Default 0.28.
   */
  fadeTop?: number;
  /** Cut the lane out of the canvas's black (`laneMask`) so the stage shows beside it. */
  cutout?: boolean;
  style?: CSSProperties;
}

/**
 * The highway cropped into a box: drawn `renderHeight` tall and slid so the
 * far end of its floor sits `horizonAt` px from the box top. The far end
 * fades out into the fog. Without `cutout` the box is the canvas's black.
 */
export const HighwayCrop: React.FC<HighwayCropProps> = ({
  width,
  height,
  renderHeight,
  horizonAt,
  fadeTop = 0.28,
  cutout = false,
  style,
  track = EXPERT_DRUMS,
  showLyrics = false,
  ...highway
}) => {
  const renderWidth = Math.max(width, renderHeight * RENDER_MIN_ASPECT);
  const instrument = highwayInstrumentOf(track);
  const [farLeft] = floorQuad(
    {width: renderWidth, height: renderHeight},
    instrument,
  );
  const horizon = farLeft.y / renderHeight;
  const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`;
  const fade = `linear-gradient(180deg, transparent ${percent(horizon - 0.02)}, rgba(0,0,0,0.3) ${percent(horizon + fadeTop * 0.55 * (1 - horizon))}, #000 ${percent(horizon + fadeTop * (1 - horizon))})`;
  const lane: CSSProperties = cutout
    ? {
        maskImage: laneMask(renderWidth, renderHeight, instrument),
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
      }
    : {};
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background: cutout ? 'transparent' : '#000',
        ...style,
      }}>
      <div
        style={{
          position: 'absolute',
          left: (width - renderWidth) / 2,
          top: horizonAt - horizon * renderHeight,
          width: renderWidth,
          height: renderHeight,
          ...lane,
        }}>
        <div style={{maskImage: fade}}>
          <ProductHighway
            {...highway}
            panes={[{track}]}
            width={renderWidth}
            height={renderHeight}
            showLyrics={showLyrics}
          />
        </div>
      </div>
    </div>
  );
};

export interface LaneBleedProps {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Overall strength (1 = the default look); pulse it on hits. */
  intensity?: number;
  /** Strength of the purple wash over the lane colours. */
  purple?: number;
  /** The lane colours, left to right. Default: the drum pads' (red, yellow, blue, green). */
  colors?: readonly string[];
}

/** Lane-coloured light that bleeds out from behind a highway: place it under the highway. */
export const LaneBleed: React.FC<LaneBleedProps> = ({
  x,
  y,
  width,
  height,
  intensity = 1,
  purple = 0.8,
  colors = [lane.red, lane.yellow, lane.blue, lane.green],
}) => (
  <div
    style={{
      position: 'absolute',
      left: x,
      top: y,
      width,
      height,
      pointerEvents: 'none',
      filter: 'blur(70px)',
      opacity: 0.55 * intensity,
    }}>
    {colors.map((c, i) => (
      <div
        key={`${c}-${i}`}
        style={{
          position: 'absolute',
          left: `${8 + (i * 88) / Math.max(1, colors.length)}%`,
          bottom: '-6%',
          width: '26%',
          height: '46%',
          borderRadius: '50%',
          background: c,
        }}
      />
    ))}
    <div
      style={{
        position: 'absolute',
        left: '10%',
        right: '10%',
        top: '4%',
        height: '70%',
        borderRadius: '50%',
        background: color.purple,
        opacity: purple,
      }}
    />
  </div>
);

export interface GlassRimProps {
  /** Corner radius of the panel it rims, px. */
  radius?: number;
  /** The coloured ring and the outer glow. Defaults: brand fuchsia and purple. */
  ring?: string;
  glow?: string;
}

/**
 * The rim of a glass panel around a highway: a light edge and an outer glow,
 * plus a black inner falloff at the panel edges. Place it as the last child
 * of the panel box. Nothing coloured or blended reaches the lane: the falloff
 * stays at the panel's edges.
 */
export const GlassRim: React.FC<GlassRimProps> = ({
  radius = 28,
  ring = alpha(color.fuchsia, 0.25),
  glow = alpha(color.purple, 0.35),
}) => (
  <div
    style={{
      position: 'absolute',
      inset: -2,
      borderRadius: radius + 2,
      pointerEvents: 'none',
      border: '2px solid rgba(255,255,255,0.22)',
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.4), inset 0 0 40px rgba(0,0,0,0.6), 0 0 0 1px ${ring}, 0 0 60px ${glow}`,
    }}
  />
);

export interface IrisProps {
  /** Centre of the opening, px. */
  cx: number;
  cy: number;
  /** Radius of the opening, px. Nothing renders at or below half a pixel. */
  radius: number;
  /**
   * The rim just outside the circle; it glows outward only, so no colour
   * lands inside. Fade `opacity` out as the iris finishes opening. null: no rim.
   */
  rim?: {
    width?: number;
    color?: string;
    glow?: string;
    opacity?: number;
  } | null;
  /** What the iris opens onto (a `HighwayPlate`, say). */
  children: ReactNode;
}

/** Whatever `children` draws, seen through a circle centred on (cx, cy). */
export const Iris: React.FC<IrisProps> = ({
  cx,
  cy,
  radius,
  rim = {},
  children,
}) => {
  if (radius <= 0.5) return null;
  const rimWidth = rim?.width ?? 5;
  const rimOpacity = rim?.opacity ?? 1;
  const glow = rim?.glow ?? color.emerald;
  return (
    <>
      <AbsoluteFill
        style={{clipPath: `circle(${radius}px at ${cx}px ${cy}px)`}}>
        {children}
      </AbsoluteFill>
      {rim && rimOpacity > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: cx - radius - rimWidth,
            top: cy - radius - rimWidth,
            width: (radius + rimWidth) * 2,
            height: (radius + rimWidth) * 2,
            borderRadius: '50%',
            border: `${rimWidth}px solid ${rim.color ?? alpha(lighten(color.emerald, 0.3), 0.95)}`,
            boxShadow: `0 0 50px 14px ${alpha(glow, 0.55)}, 0 0 140px 40px ${alpha(glow, 0.25)}`,
            opacity: rimOpacity,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </>
  );
};

export interface HighwayPlateProps extends CroppedHighwayProps {
  /** The plate's move about the bottom centre of its crop: x in px, scale, rotation in degrees. */
  move?: {x?: number; scale?: number; rotate?: number};
  /** The lane light behind the highway (`LaneBleed` strengths); null for none. */
  bleed?: {intensity?: number; purple?: number} | null;
  /** Painted behind everything. Default: the brand stage background. */
  background?: string;
  /** Drawn over the background and under the lane light (a glow, say). */
  behind?: ReactNode;
  /** How far down the floor the fade out of the fog reaches (see `HighwayCrop`). Default 0.26. */
  fadeTop?: number;
  style?: CSSProperties;
}

/**
 * The full-frame highway shot: the stage background, lane light behind, and
 * the lane itself cut out of the renderer's black so the stage shows beside
 * it. The lane rises from below the frame, its far end high on the right of
 * centre; `move` drifts, scales and turns it (the lane light follows `x`).
 * Sized from the composition, so it frames the same at any format.
 */
export const HighwayPlate: React.FC<HighwayPlateProps> = ({
  move = {},
  bleed = {},
  background = stageBackground,
  behind,
  fadeTop = 0.26,
  style,
  ...highway
}) => {
  const {width: W, height: H} = useVideoConfig();
  const x = move.x ?? 0;
  return (
    <AbsoluteFill style={{background, overflow: 'hidden', ...style}}>
      {behind}
      {bleed ? (
        <LaneBleed
          x={0.318 * W + x}
          y={0.481 * H}
          width={0.781 * W}
          height={0.648 * H}
          intensity={bleed.intensity ?? 1.1}
          purple={bleed.purple ?? 0.35}
        />
      ) : null}
      <div
        style={{
          position: 'absolute',
          left: 0.234 * W,
          top: -0.12 * H,
          transformOrigin: '50% 100%',
          transform: `translateX(${x}px) scale(${move.scale ?? 1}) rotate(${move.rotate ?? 0}deg)`,
        }}>
        <HighwayCrop
          {...highway}
          width={0.99 * W}
          height={1.2 * H}
          renderHeight={1.713 * H}
          horizonAt={0.139 * H}
          fadeTop={fadeTop}
          cutout
        />
      </div>
    </AbsoluteFill>
  );
};
