/**
 * Whether the kit's fonts have loaded. Its own module so the measurer can
 * read it without importing the font files (Node cannot load .woff2).
 */

let loaded = false;

/** Synchronous check, for code that caches measurements. */
export const areFontsLoaded = (): boolean => loaded;

/** Called once by `fonts.ts` when every face has loaded. */
export const markFontsLoaded = (): void => {
  loaded = true;
};
