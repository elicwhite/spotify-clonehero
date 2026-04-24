const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin Turbopack workspace root to this directory (parent has its own yarn.lock)
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Externalize server-side bundling for browser-only packages. Next 16's
  // Client Component SSR otherwise tries to statically analyze their code:
  //   - onnxruntime-web uses browser-only APIs
  //   - @eshaz/web-worker contains dynamic `import(mod)` in its node.js shim
  //     (reached via audio-decode -> mpg123-decoder -> @wasm-audio-decoders)
  serverExternalPackages: ['onnxruntime-web', '@eshaz/web-worker'],
  images: {
    remotePatterns: [
      {
        // https://files.enchor.us/132c9a0eabbe4b87525962c6560d35fc.jpg
        protocol: 'https',
        hostname: 'files.enchor.us',
      },
    ],
  },
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async headers() {
    // https://nextjs.org/docs/13/app/building-your-application/routing/middleware#setting-headers
    // https://sqlocal.dev/guide/setup#cross-origin-isolation
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'credentialless',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
      // Specific headers for WASM files
      {
        source: '/_next/static/media/:path*',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Resource-Policy',
            value: 'cross-origin',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;

// Wrap with Sentry for production builds only. Sentry's Next 16 dev-time
// instrumentation regresses memory badly (>8GB RSS on first page compile).
if (process.env.NODE_ENV !== 'development') {
  const {withSentryConfig} = require('@sentry/nextjs');

  module.exports = withSentryConfig(module.exports, {
    // For all available options, see:
    // https://www.npmjs.com/package/@sentry/webpack-plugin#options

    org: 'clone-hero-chart-tools',
    project: 'frontend',

    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    tunnelRoute: '/monitoring',

    webpack: {
      // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
      // See the following for more information:
      // https://docs.sentry.io/product/crons/
      // https://vercel.com/docs/cron-jobs
      automaticVercelMonitors: true,

      // Tree-shaking options for reducing bundle size
      treeshake: {
        // Automatically tree-shake Sentry logger statements to reduce bundle size
        removeDebugLogging: true,
      },
    },
  });
}
