const nextJest = require('next/jest');

// Providing the path to your Next.js app which will enable loading next.config.js and .env files
const createJestConfig = nextJest({dir: './'});

// Any custom config you want to pass to Jest
const customJestConfig = {
  // setupFilesAfterSetup: ['<rootDir>/jest.setup.js'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/?(*.)+(spec|test).ts',
    '**/?(*.)+(spec|test).tsx',
  ],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'lib/**/*.tsx',
    '!lib/**/*.d.ts',
    '!lib/**/__tests__/**',
  ],
  // ESM-only packages; transform through SWC like our own code.
  // Includes: webfft, @awasm/noble, p-limit + yocto-queue (used by local-songs-folder),
  // native-file-system-adapter + fetch-blob + formdata-polyfill (used by DB tests).
  transformIgnorePatterns: [
    '/node_modules/(?!(webfft|@awasm/noble|p-limit|yocto-queue|native-file-system-adapter|fetch-blob|formdata-polyfill)/)',
  ],
};

// createJestConfig is exported in this way to ensure that next/jest can load the Next.js configuration, which is async
// Wrap to override transformIgnorePatterns AFTER next/jest sets its defaults,
// since next/jest prepends its own node_modules pattern that would shadow ours.
const baseConfig = createJestConfig(customJestConfig);
module.exports = async () => {
  const config = await baseConfig();
  config.transformIgnorePatterns = [
    '/node_modules/(?!(webfft|@awasm/noble|p-limit|yocto-queue|native-file-system-adapter|fetch-blob|formdata-polyfill)/).+\\.js$',
    '^.+\\.module\\.(css|sass|scss)$',
  ];
  return config;
};
