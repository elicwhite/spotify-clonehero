// jsdom doesn't ship TextEncoder/TextDecoder; needed by midi-file (loaded
// via scan-chart) and other Node-shaped libraries that work in browsers.
const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
