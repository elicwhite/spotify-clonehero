/**
 * CSS for the type scale. `textStyle('h1', unit)` returns everything a text
 * node needs (family, size, weight, tracking, line height, rendering flags),
 * so a scene never assembles font CSS by hand.
 */
import type {CSSProperties} from 'react';
import {
  color,
  fontFamily,
  type as typeScale,
  type TypeName,
  type TypeToken,
} from '../brand/tokens';
import './fonts';

/**
 * Crisp, stable text for animation:
 * - antialiased: grayscale AA, no subpixel colour fringes on a dark stage.
 * - geometricPrecision: no hinting snaps, so text that moves or scales by
 *   fractions of a pixel glides instead of shimmering.
 * - kerning and contextual alternates on; optical sizing auto (Inter's
 *   Display cut above 32 px).
 */
export const crispText: CSSProperties = {
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
  textRendering: 'geometricPrecision',
  fontKerning: 'normal',
  fontOpticalSizing: 'auto',
  fontFeatureSettings: '"kern" 1, "liga" 1, "calt" 1',
};

/** Mono labels also get tabular figures, so "1.1" -> "12.4" never jitters. */
export const monoFeatures: CSSProperties = {
  fontFeatureSettings: '"kern" 1, "tnum" 1, "zero" 0',
  fontVariantNumeric: 'tabular-nums',
};

/** A type token by name, or the token itself. */
export type TypeInput = TypeName | TypeToken;

export const resolveType = (t: TypeInput): TypeToken =>
  typeof t === 'string' ? typeScale[t] : t;

/**
 * CSS for a type token at the format's size `unit` (px per reference px),
 * with optional overrides.
 */
export const textStyle = (
  t: TypeInput,
  unit: number,
  overrides?: CSSProperties,
): CSSProperties => {
  const token = resolveType(t);
  return {
    ...crispText,
    ...(token.family === 'mono' ? monoFeatures : null),
    fontFamily: fontFamily[token.family],
    fontSize: token.size * unit,
    fontWeight: token.weight,
    letterSpacing: `${token.tracking}em`,
    lineHeight: token.lineHeight,
    textTransform: token.uppercase ? 'uppercase' : undefined,
    color: token.color ?? color.text,
    ...overrides,
  };
};
