/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@musiccharts/core/styles/tailwind-preset.js')],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    '../../packages/core/src/**/*.{ts,tsx}',
  ],
};
