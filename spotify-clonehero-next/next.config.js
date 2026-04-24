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

// MEMORY DEBUG: Sentry wrap disabled to isolate Next 16 memory regression.
// Restore `withSentryConfig(...)` after diagnosis.
module.exports = nextConfig;
