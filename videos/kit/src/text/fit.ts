/**
 * Type that fits: the font spec KineticText measures a token with, the
 * largest size (up to the one asked for) at which a line sets within a
 * width, so a long product name shrinks instead of running off the frame,
 * and how many lines a block of copy takes, for layouts stacked around it.
 */
import {useMemo} from 'react';
import {fontFamily} from '../brand/tokens';
import {useFontsReady} from './fonts';
import {breakLines, measureWidth, type FontSpec} from './measure';
import {crispText, monoFeatures, resolveType, type TypeInput} from './style';
import {tokenize, type KineticWord} from './timing';

/** Overrides of a token's font, as KineticText takes them. */
export interface FontOverrides {
  font?: 'sans' | 'mono';
  weight?: number;
  /** em */
  tracking?: number;
  uppercase?: boolean;
}

/**
 * The spec a type token's text is measured with at `size` px: exactly what
 * KineticText renders, font features included (`textStyle`'s).
 */
export const tokenFontSpec = (
  variant: TypeInput,
  size: number,
  o: FontOverrides = {},
): FontSpec => {
  const token = resolveType(variant);
  const family = o.font ?? token.family;
  return {
    family: fontFamily[family],
    size,
    weight: o.weight ?? token.weight,
    tracking: o.tracking ?? token.tracking,
    uppercase: o.uppercase ?? token.uppercase ?? false,
    features: (family === 'mono' ? monoFeatures : crispText)
      .fontFeatureSettings,
  };
};

/**
 * The largest size, at most `spec.size`, at which `text` sets on one line no
 * wider than `maxWidth` px. Widths scale with the size above Inter's
 * optical-size range; below it a second pass corrects the first.
 */
export const fitLineSize = (
  text: string,
  spec: FontSpec,
  maxWidth: number,
): number => {
  let size = spec.size;
  for (let pass = 0; pass < 3; pass++) {
    const w = measureWidth(text, {...spec, size});
    if (w <= maxWidth) return size;
    size *= maxWidth / w;
  }
  return size;
};

/**
 * How many lines KineticText sets `text` in at `maxWidth` px: each
 * paragraph broken the way its layout breaks it (0 for no words).
 */
export const lineCount = (
  text: string | readonly KineticWord[],
  spec: FontSpec,
  maxWidth: number,
): number => {
  const space = measureWidth(' ', spec);
  return tokenize(text).reduce(
    (n, words) =>
      n +
      breakLines(
        words.map(w => measureWidth(w.text, spec)),
        space,
        maxWidth,
      ).length,
    0,
  );
};

/** `fitLineSize` for a type token in a component: `size` until the fonts are in, then the fitted size. */
export const useFitLineSize = (
  text: string,
  variant: TypeInput,
  size: number,
  maxWidth: number,
  o: FontOverrides = {},
): number => {
  const ready = useFontsReady();
  const {font, weight, tracking, uppercase} = o;
  return useMemo(
    () =>
      ready
        ? fitLineSize(
            text,
            tokenFontSpec(variant, size, {font, weight, tracking, uppercase}),
            maxWidth,
          )
        : size,
    [ready, text, variant, size, maxWidth, font, weight, tracking, uppercase],
  );
};

/** `lineCount` for a type token in a component: one line until the fonts are in. */
export const useLineCount = (
  text: string,
  variant: TypeInput,
  size: number,
  maxWidth: number,
  o: FontOverrides = {},
): number => {
  const ready = useFontsReady();
  const {font, weight, tracking, uppercase} = o;
  return useMemo(
    () =>
      ready
        ? lineCount(
            text,
            tokenFontSpec(variant, size, {font, weight, tracking, uppercase}),
            maxWidth,
          )
        : Math.min(1, tokenize(text).length),
    [ready, text, variant, size, maxWidth, font, weight, tracking, uppercase],
  );
};
