// Node loads this area directly (from a film's remotion.config.ts), so its
// relative imports carry their .ts extension.
export {
  loadProductAppOptions,
  PRODUCT_APP_CONFIG,
  productAppChromiumOptions,
  productAppPaths,
  productAppWebpack,
  withProductApp,
  type ProductAppOptions,
  type ProductAppPaths,
} from './productApp.ts';
