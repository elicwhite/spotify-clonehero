/**
 * Where a film serves the app's `public/assets` folder, relative to the
 * film's public dir: a committed link `public/product` -> the app's
 * `public/assets` (withProductApp keeps the film's own public dir by
 * default). The highway's loading manager and the brand marks read the
 * app's art from here. No imports, so anything can use it without pulling
 * in three.js.
 */
export const PRODUCT_ASSETS_PATH = 'product';
