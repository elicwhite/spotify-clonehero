// Cross-origin isolation headers for a Next app that uses SQLocal or
// SharedArrayBuffer. A `next.config.js` loads this with
// `require('@musiccharts/core/next/headers.js')`: the config is CommonJS and
// core has no build step, so this file stays plain CommonJS JavaScript.
//
// https://nextjs.org/docs/13/app/building-your-application/routing/middleware#setting-headers
// https://sqlocal.dev/guide/setup#cross-origin-isolation

/**
 * The `headers()` rules that isolate every route of an app.
 *
 * `routeRules` are extra rules for routes that must opt out. They go after the
 * site-wide rule, because the later, more specific rule wins.
 *
 * @param {Array<{source: string, headers: Array<{key: string, value: string}>}>} [routeRules]
 */
function crossOriginIsolationHeaders(routeRules = []) {
  return [
    {
      source: '/:path*',
      headers: [
        {key: 'Cross-Origin-Embedder-Policy', value: 'credentialless'},
        {key: 'Cross-Origin-Opener-Policy', value: 'same-origin'},
      ],
    },
    ...routeRules,
    // Specific headers for WASM files
    {
      source: '/_next/static/media/:path*',
      headers: [
        {key: 'Cross-Origin-Embedder-Policy', value: 'require-corp'},
        {key: 'Cross-Origin-Opener-Policy', value: 'same-origin'},
        {key: 'Cross-Origin-Resource-Policy', value: 'cross-origin'},
      ],
    },
  ];
}

module.exports = {crossOriginIsolationHeaders};
