// jsdom doesn't ship TextEncoder/TextDecoder; needed by midi-file (loaded
// via scan-chart) and other Node-shaped libraries that work in browsers.
const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// jsdom's global doesn't expose structuredClone, which chart-edit's deep
// doc clones use. v8's serialize/deserialize is the structured-clone
// algorithm, so this matches browser semantics for the values we clone.
if (typeof global.structuredClone !== 'function') {
  const v8 = require('v8');
  global.structuredClone = value => v8.deserialize(v8.serialize(value));
}
