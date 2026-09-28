/// <reference path="./assets.d.ts" />
/**
 * Loads the kit's two typefaces from the installed @fontsource-variable
 * packages and holds rendering until both are ready.
 *
 * - Inter Variable, the `opsz` build (optical size 14-32, weight 100-900).
 *   With `font-optical-sizing: auto` the browser picks the display cut for
 *   text at 32 px and up, which keeps large headlines tight and crisp.
 * - JetBrains Mono Variable (weight 100-800) for eyebrows and micro labels.
 *
 * Importing this module starts loading once and holds every frame until the
 * fonts are in and `document.fonts` has settled. `useFontsReady()` lets a
 * component that measures text wait for real metrics.
 */
import interLatinExt from '@fontsource-variable/inter/files/inter-latin-ext-opsz-normal.woff2';
import interLatin from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2';
import monoLatinExt from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2';
import monoLatin from '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2';
import {loadFont} from '@remotion/fonts';
import {continueRender, delayRender} from 'remotion';
import {fontFace} from '../brand/tokens';
import {useLoaded} from '../load';
import {markFontsLoaded} from './fontState';

// Unicode ranges from the packages' CSS, so each subset claims only its own
// code points (U+2011, the non-breaking hyphen, is in LATIN).
const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const FACES = [
  {family: fontFace.sans, url: interLatin, weight: '100 900', range: LATIN},
  {
    family: fontFace.sans,
    url: interLatinExt,
    weight: '100 900',
    range: LATIN_EXT,
  },
  {family: fontFace.mono, url: monoLatin, weight: '100 800', range: LATIN},
  {
    family: fontFace.mono,
    url: monoLatinExt,
    weight: '100 800',
    range: LATIN_EXT,
  },
];

const loadFonts = async (): Promise<true> => {
  await Promise.all(
    FACES.map(face =>
      loadFont({
        family: face.family,
        url: face.url,
        weight: face.weight,
        style: 'normal',
        unicodeRange: face.range,
        display: 'block',
      }),
    ),
  );
  await document.fonts.ready;
  markFontsLoaded();
  return true;
};

// Every frame waits for the fonts, including text that never measures itself.
const fontsLoading = (() => {
  const hold = delayRender(
    `Loading fonts (${fontFace.sans}, ${fontFace.mono})`,
  );
  return loadFonts().finally(() => continueRender(hold));
})();

/**
 * False until the fonts have loaded, then true (with a re-render). Text that
 * measures itself must not cache a measurement taken while this is false;
 * the frame is held until the re-render with real metrics.
 */
export const useFontsReady = (): boolean =>
  useLoaded(
    'fonts',
    () => fontsLoading,
    'Measuring text once fonts are loaded',
  ) !== null;

/**
 * A `line-height` that is the same at every render scale. `normal` is the
 * font's ascent plus descent, and Chrome rounds each to whole DEVICE pixels:
 * whole px at 1x but half px at 2x, so a column of text drifts between a
 * normal and a supersampled render. This pins Inter's 1x value (ascent
 * 0.96875em and descent 0.2421875em, each rounded to 1px).
 */
export const PIXEL_STABLE_LINE_HEIGHT =
  'calc(round(nearest, 0.96875em, 1px) + round(nearest, 0.2421875em, 1px))';

/**
 * A stylesheet rule giving `selector` and everything inside it the
 * pixel-stable line height; inline line heights still win.
 * `<style>{pixelStableLineHeightRule('.app')}</style>`.
 */
export const pixelStableLineHeightRule = (selector: string): string =>
  `${selector}, ${selector} * { line-height: ${PIXEL_STABLE_LINE_HEIGHT}; }`;
