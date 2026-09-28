/**
 * A film's Remotion bundle, built once with the kit's product-app webpack
 * override, and a render session that shares one headless Chrome across
 * every still a tool renders.
 *
 * Every rendering tool takes the same flags (FILM_FLAGS): the film's entry
 * point and composition, and optionally the film root, input props and a
 * browser executable. Where the app is and which public folder to serve come
 * from the film's own productApp.config.ts (see src/config), the one source
 * its remotion.config.ts reads too.
 */
import fs from 'node:fs';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {
  getCompositions,
  openBrowser,
  renderStill,
  selectComposition,
  type HeadlessBrowser,
} from '@remotion/renderer';
import type {VideoConfig} from 'remotion';
import {
  loadProductAppOptions,
  productAppChromiumOptions,
  productAppPaths,
  productAppWebpack,
} from '../../src/config/index';
import {onInterrupt} from './cleanup';
import {UsageError, need} from './cli';
import {produceAtomic} from './files';

/** parseArgs specs for the flags every rendering tool shares. */
export const FILM_FLAGS = {
  /** The film's Remotion entry point (the file that calls registerRoot). */
  entry: {type: 'string'},
  composition: {type: 'string'},
  /** The film's root folder, where its productApp.config.ts is (default: the working directory). */
  film: {type: 'string'},
  /** Input props for the composition, as JSON. */
  props: {type: 'string'},
  /** A Chrome or Chrome headless shell to render with (default: Remotion's own). */
  browser: {type: 'string'},
} as const;

export const FILM_USAGE =
  '--entry <film/src/index.ts> --composition <id> [--film <dir>] [--props <json>] [--browser <chrome>]';

export interface FilmFlags {
  entry?: string;
  composition?: string;
  film?: string;
  props?: string;
  browser?: string;
}

/** The browser executable from --browser, or null for Remotion's own. */
export const browserOf = (flags: FilmFlags): string | null =>
  flags.browser ? path.resolve(flags.browser) : null;

/**
 * Bundles the film once (webpack), with the app aliased in, into a fresh
 * temporary folder (bundling twice into one folder fails when the public dir
 * holds symlinks). Returns the serve URL: that folder, which `disposeBundle`
 * deletes. The public dir is symlinked into it rather than copied.
 */
export async function bundleFilm(flags: FilmFlags): Promise<string> {
  const entry = path.resolve(need(flags.entry, 'entry'));
  const film = path.resolve(flags.film ?? process.cwd());
  const options = await loadProductAppOptions(film);
  const paths = productAppPaths(film, options);
  let last = -10;
  const serveUrl = await bundle({
    entryPoint: entry,
    rootDir: paths.filmRoot,
    publicDir: paths.publicDir,
    webpackOverride: productAppWebpack(film, options),
    symlinkPublicDir: true,
    onProgress: p => {
      if (p >= last + 25 || p === 100) {
        last = p;
        console.log(`bundle ${p}%`);
      }
    },
  });
  bundles.set(
    serveUrl,
    onInterrupt(() => fs.rmSync(serveUrl, {recursive: true, force: true})),
  );
  return serveUrl;
}

/** Each live bundle's release from the interrupt cleanup. */
const bundles = new Map<string, () => void>();

/** Deletes a bundle made by `bundleFilm`. */
export function disposeBundle(serveUrl: string): void {
  bundles.get(serveUrl)?.();
  bundles.delete(serveUrl);
  fs.rmSync(serveUrl, {recursive: true, force: true});
}

/** The composition's input props from --props (JSON), or none. */
export function inputPropsOf(flags: FilmFlags): Record<string, unknown> {
  if (!flags.props) return {};
  try {
    const v = JSON.parse(flags.props) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch (err) {
    throw new UsageError(
      `--props must be a JSON object: ${(err as Error).message}`,
    );
  }
}

/** A still to render: a frame of the composition and the PNG to write. */
export interface StillJob {
  frame: number;
  output: string;
}

export interface RenderSession {
  serveUrl: string;
  inputProps: Record<string, unknown>;
  /** Every composition the film registers. */
  compositions(): Promise<VideoConfig[]>;
  /** One composition, by id. */
  composition(id: string): Promise<VideoConfig>;
  /**
   * Renders frames of `composition` to PNGs with up to `concurrency` pages at
   * once; `scale` multiplies its size. After a failure no new still starts,
   * and the first error is thrown once the stills in flight have finished,
   * so the browser is never closed under a render.
   */
  stills(
    composition: VideoConfig,
    jobs: readonly StillJob[],
    options?: {scale?: number; concurrency?: number},
  ): Promise<void>;
  close(): Promise<void>;
}

/** Bundles the film and opens one browser for every still of the run. */
export async function openRenderSession(
  flags: FilmFlags,
): Promise<RenderSession> {
  const inputProps = inputPropsOf(flags);
  const serveUrl = await bundleFilm(flags);
  const browserExecutable = browserOf(flags);
  let browser: HeadlessBrowser;
  try {
    browser = await openBrowser('chrome', {
      browserExecutable,
      chromiumOptions: productAppChromiumOptions,
    });
  } catch (err) {
    disposeBundle(serveUrl);
    throw err;
  }
  const shared = {
    serveUrl,
    inputProps,
    puppeteerInstance: browser,
    browserExecutable,
    chromiumOptions: productAppChromiumOptions,
  };
  const still = async (
    composition: VideoConfig,
    {frame, output}: StillJob,
    scale: number,
  ) => {
    if (frame < 0 || frame >= composition.durationInFrames) {
      throw new Error(
        `Frame ${frame} is outside ${composition.id} (0-${composition.durationInFrames - 1})`,
      );
    }
    await produceAtomic(output, tmp =>
      renderStill({
        ...shared,
        composition,
        output: tmp,
        frame,
        scale,
        imageFormat: 'png',
        overwrite: true,
      }),
    );
  };
  return {
    serveUrl,
    inputProps,
    compositions: () => getCompositions(serveUrl, shared),
    composition: id => selectComposition({...shared, id}),
    async stills(composition, jobs, {scale = 1, concurrency = 2} = {}) {
      let next = 0;
      const errors: unknown[] = [];
      const worker = async () => {
        while (next < jobs.length && !errors.length) {
          try {
            await still(composition, jobs[next++]!, scale);
          } catch (error) {
            errors.push(error);
          }
        }
      };
      await Promise.all(Array.from({length: Math.max(1, concurrency)}, worker));
      if (errors.length) throw errors[0];
    },
    // After a failed render the browser may already be gone; closing it then
    // must not replace the render's own error.
    close: async () => {
      try {
        await browser.close({silent: true});
      } catch {
        // Nothing left to close.
      } finally {
        disposeBundle(serveUrl);
      }
    },
  };
}

/** A frame's file name in a folder of stills, zero-padded so names sort by frame. */
export const frameFile = (frame: number): string =>
  `${String(frame).padStart(6, '0')}.png`;

/** from, from + step, ... up to and including `to` when it lands on the step. */
export function strideFrames(from: number, to: number, step: number): number[] {
  if (step < 1) throw new UsageError('the step must be at least 1');
  if (to < from) throw new UsageError(`the range ${from}-${to} runs backwards`);
  const frames: number[] = [];
  for (let f = from; f <= to; f += step) frames.push(f);
  return frames;
}
