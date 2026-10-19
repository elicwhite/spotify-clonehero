// jsdom doesn't ship TextEncoder/TextDecoder; needed by midi-file (loaded
// via scan-chart) and other Node-shaped libraries that work in browsers.
const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// jsdom ships no canvas implementation, so every getContext call routes
// through its virtual console as a multi-line "Not implemented" error. The
// components that ask for one already treat a missing context as "cannot
// draw" and bail, so hand them null and let that happen quietly. Suites that
// need a context to assert against still override this with their own stub.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = () => null;
}

// jsdom's global doesn't expose structuredClone, which chart-edit's deep
// doc clones use. v8's serialize/deserialize is the structured-clone
// algorithm, so this matches browser semantics for the values we clone.
if (typeof global.structuredClone !== 'function') {
  const v8 = require('v8');
  global.structuredClone = value => v8.deserialize(v8.serialize(value));
}

// jsdom has no WebGPU. Every model-backed control now probes for an adapter
// with the `shader-f16` feature before it offers itself
// (lib/onnx/webgpu-capability.ts), so without one the Chart Assist cards,
// the stems mixer and both tool pages correctly refuse to run — which is not
// what most suites are testing. Give them a capable adapter by default. A
// suite that exercises the blocked path overrides `navigator.gpu` itself.
if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
  Object.defineProperty(navigator, 'gpu', {
    value: {
      requestAdapter: async () => ({features: new Set(['shader-f16'])}),
    },
    configurable: true,
    writable: true,
  });
}
