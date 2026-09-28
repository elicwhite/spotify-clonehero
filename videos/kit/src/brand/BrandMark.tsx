import type {CSSProperties} from 'react';
import {useFilterId} from '../fx/filterId';
import {useFormat} from '../format';
import {alpha, clamp01, mix} from '../motion';
import {textStyle} from '../text/style';
import {color, type} from './tokens';

/**
 * The product's lockup proportions (the app's components/BrandLink.tsx, nav
 * variant): a 28 px square with 6 px corners, a 16 px lucide Music glyph
 * (stroke 2 on a 24 grid), the wordmark at 20 px semibold, 8 px between them.
 */
export const BRAND = {
  markRadius: 6 / 28,
  iconScale: 16 / 28,
  wordmarkScale: 20 / 28,
  gapScale: 8 / 28,
} as const;

/** lucide `Music` (0.546), on its 24 x 24 grid. */
const MUSIC_PATHS = ['M9 18V5l12-2v13'] as const;
const MUSIC_CIRCLES = [
  {cx: 6, cy: 18, r: 3},
  {cx: 18, cy: 16, r: 3},
] as const;

export interface BrandMarkProps {
  /** Square size, px (default 96 reference px). */
  size?: number;
  /** 'flat' matches the product exactly; 'lit' adds a top light, an inner edge and depth for hero shots. */
  finish?: 'flat' | 'lit';
  /** Outer purple glow, 0..1 (default 0). */
  glow?: number;
  /** Glyph stroke draw-on, 0..1 (default 1 = drawn). */
  drawOn?: number;
  /** Light sweep position, 0..1 across the square (undefined = none). */
  sweep?: number;
  /**
   * 0..1 how much of the mark is still its outline, before it exists (default
   * 0, the filled mark): the square traced in light, `trace` 0..1 of the way
   * round, over a faint `tint` of the brand purple, with the glyph drawn by
   * `drawOn`. Between 0 and 1 the outline and the filled mark crossfade, the
   * outline under the filled mark.
   */
  outline?: number;
  trace?: number;
  tint?: number;
  style?: CSSProperties;
}

/**
 * The white Music glyph in the mark's 28 grid, its strokes drawn on to `d`
 * (0..1). A `drawing` glyph keeps its strokes dashed even once fully drawn,
 * so the draw-on never switches rasterisation on its last frame.
 */
const MarkGlyph: React.FC<{d: number; drawing?: boolean}> = ({
  d,
  drawing = false,
}) => {
  const icon = 28 * BRAND.iconScale;
  const off = (28 - icon) / 2;
  const dashed = drawing || d < 1;
  const dash = {
    pathLength: 1,
    strokeDasharray: dashed ? '1 1' : undefined,
    strokeDashoffset: dashed ? 1 - d : undefined,
  };
  return (
    <g
      transform={`translate(${off} ${off}) scale(${icon / 24})`}
      fill="none"
      stroke={color.white}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round">
      {MUSIC_PATHS.map(p => (
        <path key={p} d={p} {...dash} />
      ))}
      {MUSIC_CIRCLES.map(c => (
        <circle key={c.cx} cx={c.cx} cy={c.cy} r={c.r} {...dash} />
      ))}
    </g>
  );
};

type MarkLayerProps = Omit<BrandMarkProps, 'outline' | 'size'> & {
  size: number;
};

/** The mark before it exists: its square traced in light over a faint purple, its glyph drawing in. */
const OutlineMark: React.FC<MarkLayerProps> = ({
  size,
  glow = 0,
  drawOn = 1,
  trace = 1,
  tint = 0,
  style,
}) => {
  const r = 28 * BRAND.markRadius;
  const g = clamp01(glow);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      style={{
        overflow: 'visible',
        display: 'block',
        filter: `drop-shadow(0 0 ${size * 0.08}px ${alpha(color.purpleHot, 0.55 + 0.4 * g)}) drop-shadow(0 0 ${size * 0.28}px ${alpha(
          color.purple,
          0.35 + 0.4 * g,
        )})`,
        ...style,
      }}
      aria-hidden>
      <rect
        x="0"
        y="0"
        width="28"
        height="28"
        rx={r}
        fill={alpha(color.brand, tint)}
      />
      <rect
        x="0.6"
        y="0.6"
        width="26.8"
        height="26.8"
        rx={r - 0.6}
        fill="none"
        stroke={color.purplePale}
        strokeWidth={1.2}
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={1 - clamp01(trace)}
      />
      <MarkGlyph d={clamp01(drawOn)} drawing />
    </svg>
  );
};

const FilledMark: React.FC<MarkLayerProps> = ({
  size,
  finish = 'flat',
  glow = 0,
  drawOn = 1,
  sweep,
  style,
}) => {
  const id = useFilterId('bm');
  const r = 28 * BRAND.markRadius;
  const lit = finish === 'lit';
  const g = clamp01(glow);
  const sweepX = sweep === undefined ? null : mix(-14, 42, clamp01(sweep));
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      style={{
        overflow: 'visible',
        display: 'block',
        filter:
          g > 0
            ? `drop-shadow(0 0 ${size * 0.1}px ${alpha(color.purple, 0.75 * g)}) drop-shadow(0 0 ${size * 0.32}px ${alpha(
                color.purple,
                0.45 * g,
              )})`
            : undefined,
        ...style,
      }}
      aria-hidden>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0" stopColor={lit ? '#a64aa9' : color.brand} />
          <stop offset="1" stopColor={lit ? '#7c2f80' : color.brand} />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="0.45" stopColor="rgba(255,255,255,0.06)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="rgba(255,255,255,0)" />
          <stop offset="0.5" stopColor="rgba(255,255,255,0.55)" />
          <stop offset="1" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect x="0" y="0" width="28" height="28" rx={r} />
        </clipPath>
      </defs>
      <rect
        x="0"
        y="0"
        width="28"
        height="28"
        rx={r}
        fill={`url(#${id}-fill)`}
      />
      {lit ? (
        <rect
          x="0.4"
          y="0.4"
          width="27.2"
          height="27.2"
          rx={r - 0.4}
          fill="none"
          stroke={`url(#${id}-edge)`}
          strokeWidth="0.8"
        />
      ) : null}
      {sweepX !== null ? (
        <g clipPath={`url(#${id}-clip)`}>
          <rect
            x={sweepX}
            y="-8"
            width="12"
            height="44"
            fill={`url(#${id}-sweep)`}
            transform={`rotate(18 ${sweepX + 6} 14)`}
          />
        </g>
      ) : null}
      <MarkGlyph d={clamp01(drawOn)} />
    </svg>
  );
};

/**
 * The brand mark as vectors: the purple rounded square with the white Music
 * glyph, crisp at any scale. With `outline`, the mark before it exists. One
 * `size` x `size` box in every state, so a transform on it always pivots on
 * the mark's centre; `style` goes on the box.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({
  outline = 0,
  style,
  size,
  ...props
}) => {
  const {unit} = useFormat();
  const o = clamp01(outline);
  const px = size ?? 96 * unit;
  return (
    <div style={{position: 'relative', width: px, height: px, ...style}}>
      {/* The outline lies under the filled mark while one crossfades into the other. */}
      {o > 0 ? (
        <OutlineMark
          {...props}
          size={px}
          style={{position: 'absolute', inset: 0, opacity: o}}
        />
      ) : null}
      {o < 1 ? (
        <FilledMark
          {...props}
          size={px}
          style={o > 0 ? {opacity: 1 - o} : undefined}
        />
      ) : null}
    </div>
  );
};

export const WORDMARK_TEXT = 'Music Charts Tools';

export interface WordmarkProps {
  /** Font size, px (default the wordmark token's). */
  size?: number;
  color?: string;
  /** 0..1: revealed from the left behind a soft wipe (default 1). */
  reveal?: number;
  style?: CSSProperties;
}

/** "Music Charts Tools" as the product sets it: the wordmark type token, on one line. */
export const Wordmark: React.FC<WordmarkProps> = ({
  size,
  color: c = color.text,
  reveal = 1,
  style,
}) => {
  const {unit} = useFormat();
  const r = clamp01(reveal);
  // A soft wipe whose feathered edge starts fully off the left side at 0.
  const feather = 14;
  const edge = r * (100 + feather);
  const mask =
    r < 1
      ? `linear-gradient(90deg, #000 ${edge - feather}%, rgba(0,0,0,0) ${edge}%)`
      : undefined;
  if (r <= 0) return null;
  return (
    <span
      style={textStyle('wordmark', unit, {
        fontSize: size ?? type.wordmark.size * unit,
        whiteSpace: 'nowrap',
        color: c,
        display: 'inline-block',
        WebkitMaskImage: mask,
        maskImage: mask,
        ...style,
      })}>
      {WORDMARK_TEXT}
    </span>
  );
};
