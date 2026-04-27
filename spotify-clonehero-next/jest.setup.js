// Vercel runs the project's build script with NODE_ENV=production, and Jest
// inherits that. React's production build strips `act`, which @testing-library
// /react@16 needs — so force `test` before any React module is loaded.
process.env.NODE_ENV = 'test';

// jsdom doesn't ship TextEncoder/TextDecoder; needed by midi-file (loaded
// via scan-chart) and other Node-shaped libraries that work in browsers.
const {TextEncoder, TextDecoder} = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
