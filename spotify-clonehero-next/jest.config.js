const nextJest = require('next/jest');

// Providing the path to your Next.js app which will enable loading next.config.js and .env files
const createJestConfig = nextJest({dir: './'});

// Any custom config you want to pass to Jest
const customJestConfig = {
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
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
  // webfft and @awasm/noble are ESM-only; transform through SWC like our own code
  transformIgnorePatterns: ['/node_modules/(?!(webfft|@awasm/noble)/)'],
};

// createJestConfig is exported in this way to ensure that next/jest can load the Next.js configuration, which is async
// Wrap to override transformIgnorePatterns AFTER next/jest sets its defaults,
// since next/jest prepends its own node_modules pattern that would shadow ours.
const baseConfig = createJestConfig(customJestConfig);
module.exports = async () => {
  const config = await baseConfig();
  config.transformIgnorePatterns = [
    '/node_modules/(?!(webfft|@awasm/noble)/).+\\.js$',
    '^.+\\.module\\.(css|sass|scss)$',
  ];
  return config;
};
