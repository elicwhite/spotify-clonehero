import {LoadingManager} from 'three';
import {publicUrl} from '../load';
import {PRODUCT_ASSETS_PATH} from './assetsPath';

/**
 * The app's renderer requests its art at root-absolute URLs such as
 * `/assets/preview/assets2/drum-kick.webp`. A film serves the app's
 * `public/assets` folder somewhere under its own public dir instead. Each
 * `ProductHighway` stage gets its own loading manager (the app's
 * `StageConfig.loadingManager`), which points those requests there and keeps
 * the list of the ones that failed, so the app's code runs unchanged and
 * nothing global is patched.
 */
const APP_ASSETS = '/assets/';
const APP_PREVIEW_ASSETS = `${APP_ASSETS}preview/`;

export interface ProductAssets {
  /** Pass as the stage's `loadingManager`: every texture request goes through it. */
  manager: LoadingManager;
  /**
   * The requests that failed so far, as the URLs they were sent to. The app
   * draws a placeholder for a missing texture and only warns, so the
   * highway checks this after mounting and fails the render instead.
   */
  failures: () => readonly string[];
}

/**
 * A loading manager that serves the app's art from `publicPath`, the folder
 * under the film's public dir that holds the app's `public/assets` (default
 * `PRODUCT_ASSETS_PATH`). The app's animated-WebP decoder fetches through
 * the same manager (`resolveURL`), so both ways the app loads art are
 * covered; a failed fetch falls back to a texture load of the same URL,
 * which lands in `failures`.
 */
export const productAssets = (
  publicPath: string = PRODUCT_ASSETS_PATH,
): ProductAssets => {
  const root = publicPath.replace(/^\/+|\/+$/g, '');
  const failures: string[] = [];
  // three reports a failed load after the URL modifier ran, so the URL
  // recorded is the one the request went to.
  const manager = new LoadingManager(undefined, undefined, url => {
    failures.push(url);
  });
  manager.setURLModifier(url =>
    url.startsWith(APP_PREVIEW_ASSETS)
      ? publicUrl(`${root}/${url.slice(APP_ASSETS.length)}`)
      : url,
  );
  return {manager, failures: () => [...failures]};
};
