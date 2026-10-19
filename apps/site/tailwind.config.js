/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('@musiccharts/core/styles/tailwind-preset.js')],
  content: [
    './pages/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../packages/core/src/**/*.{ts,tsx}',
  ],
};
