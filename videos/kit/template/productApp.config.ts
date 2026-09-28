import type {ProductAppOptions} from '@musiccharts/video-kit/config';

/**
 * Where this film finds the product app and which folder it serves as
 * public/. remotion.config.ts and the kit's render tools both read it. The
 * defaults: the app next to the videos workspace, and the film's own
 * public/ (its generated material and the `product` link to the app's art).
 */
const productApp: ProductAppOptions = {};

export default productApp;
