/**
 * A unit's style delta from rest (what an enter or exit preset returns), how
 * two deltas combine, and the CSS that lays one over an element's own style.
 * Shared by KineticText (one unit per word or character) and Pop (the whole
 * element as one unit). Pure: no React at runtime.
 */
import type {CSSProperties} from 'react';

/** A unit's style delta from rest. Omitted fields mean "as at rest". */
export interface UnitStyle {
  /** px */
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  /** degrees */
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  opacity?: number;
  /** Isotropic blur, px. */
  blur?: number;
  /** Directional blur, px (drawn with an SVG filter). */
  blurX?: number;
  blurY?: number;
  /** Variable-font weight. */
  weight?: number;
  color?: string;
  /** Replacement text for this unit (scramble). */
  glyph?: string;
  /** CSS transform-origin. */
  origin?: string;
}

/**
 * Two deltas at once (an enter still running as an exit starts, a per-unit
 * pulse on top): offsets, rotations and blurs add; scales and opacity
 * multiply; the second's weight, colour, glyph and origin win.
 */
export const composeStyle = (a: UnitStyle, b: UnitStyle): UnitStyle => ({
  x: (a.x ?? 0) + (b.x ?? 0),
  y: (a.y ?? 0) + (b.y ?? 0),
  rotate: (a.rotate ?? 0) + (b.rotate ?? 0),
  rotateX: (a.rotateX ?? 0) + (b.rotateX ?? 0),
  rotateY: (a.rotateY ?? 0) + (b.rotateY ?? 0),
  scale: (a.scale ?? 1) * (b.scale ?? 1),
  scaleX: (a.scaleX ?? 1) * (b.scaleX ?? 1),
  scaleY: (a.scaleY ?? 1) * (b.scaleY ?? 1),
  opacity: (a.opacity ?? 1) * (b.opacity ?? 1),
  blur: (a.blur ?? 0) + (b.blur ?? 0),
  blurX: (a.blurX ?? 0) + (b.blurX ?? 0),
  blurY: (a.blurY ?? 0) + (b.blurY ?? 0),
  weight: b.weight ?? a.weight,
  color: b.color ?? a.color,
  glyph: b.glyph ?? a.glyph,
  origin: b.origin ?? a.origin,
});

/** The delta's CSS transform, or undefined at rest. `perspective` (px) applies to rotateX/Y. */
export const unitTransform = (
  s: UnitStyle,
  perspective: number,
): string | undefined => {
  const parts: string[] = [];
  const rx = s.rotateX ?? 0;
  const ry = s.rotateY ?? 0;
  if (rx !== 0 || ry !== 0) parts.push(`perspective(${perspective}px)`);
  if (s.x || s.y) parts.push(`translate(${s.x ?? 0}px, ${s.y ?? 0}px)`);
  if (rx) parts.push(`rotateX(${rx}deg)`);
  if (ry) parts.push(`rotateY(${ry}deg)`);
  if (s.rotate) parts.push(`rotate(${s.rotate}deg)`);
  const sc = s.scale ?? 1;
  const sx = (s.scaleX ?? 1) * sc;
  const sy = (s.scaleY ?? 1) * sc;
  if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
  return parts.length > 0 ? parts.join(' ') : undefined;
};

/** Directional blur deviations (px) when the delta asks for one, else null. */
export const directionalBlur = (
  s: UnitStyle,
): {x: number; y: number} | null => {
  if ((s.blurX ?? 0) <= 0.05 && (s.blurY ?? 0) <= 0.05) return null;
  const blur = s.blur ?? 0;
  return {x: (s.blurX ?? 0) + blur, y: (s.blurY ?? 0) + blur};
};

const joined = (...parts: (string | undefined)[]): string | undefined => {
  const out = parts.filter(Boolean).join(' ');
  return out === '' ? undefined : out;
};

/**
 * CSS for an element at delta `s`, over its own `base` style: the base
 * transform applies around the delta's, opacities multiply, and the base
 * filter chains before the delta's blur. A directional blur needs an SVG
 * filter: pass its `url(#id)` as `directionalFilter` (see `directionalBlur`).
 */
export const unitCss = (
  s: UnitStyle,
  {
    base,
    perspective,
    directionalFilter,
  }: {base?: CSSProperties; perspective: number; directionalFilter?: string},
): CSSProperties => {
  const blur = s.blur ?? 0;
  const own =
    directionalFilter ?? (blur > 0.05 ? `blur(${blur}px)` : undefined);
  const opacity =
    (typeof base?.opacity === 'number' ? base.opacity : 1) * (s.opacity ?? 1);
  return {
    ...base,
    transform: joined(
      typeof base?.transform === 'string' ? base.transform : undefined,
      unitTransform(s, perspective),
    ),
    transformOrigin: s.origin ?? base?.transformOrigin,
    opacity: opacity < 1 ? Math.max(0, opacity) : base?.opacity,
    filter: joined(
      typeof base?.filter === 'string' ? base.filter : undefined,
      own,
    ),
    fontWeight:
      s.weight !== undefined ? Math.round(s.weight) : base?.fontWeight,
    color: s.color ?? base?.color,
  };
};
