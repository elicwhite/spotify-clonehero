import type {ProductAppOptions} from '@musiccharts/video-kit/config';

/**
 * Where the gallery finds the product app and which folder it serves as
 * public/: the defaults (the app next to the videos workspace, and the
 * gallery's own public/). remotion.config.ts and the kit's render tools both
 * read it.
 */
const productApp: ProductAppOptions = {};

export default productApp;
