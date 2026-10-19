const path = require('path');
const {
  crossOriginIsolationHeaders,
} = require('@musiccharts/core/next/headers.js');

const workspaceRoot = path.resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Core ships TypeScript source and no build step, so Next compiles it.
  transpilePackages: ['@musiccharts/core'],
  reactCompiler: true,
  // The pnpm workspace root holds node_modules and the lockfile, so Turbopack
  // and the output file tracer both start there.
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  // audio-decode reaches @eshaz/web-worker, whose Node shim has a dynamic
  // `import(mod)` that Client Component SSR cannot analyze. onnxruntime-web
  // uses browser-only APIs.
  serverExternalPackages: ['onnxruntime-web', '@eshaz/web-worker'],
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  async headers() {
    return crossOriginIsolationHeaders();
  },
};

module.exports = nextConfig;
