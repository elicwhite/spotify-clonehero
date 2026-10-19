const nextJest = require('next/jest');

// ESM-only deps that must be transformed by SWC. Scoped names use a forward
// slash here; the helper rewrites them for pnpm's mangled `.pnpm` directory.
const esmPackagesToTransform = ['webfft', '@awasm/noble', 'p-map'];

// transformIgnorePatterns that work under both pnpm's nested
// `.pnpm/<name+ver>/node_modules/<name>/` layout and a hoisted
// `node_modules/<name>/` layout.
function buildTransformIgnorePatterns() {
  const hoisted = esmPackagesToTransform.join('|');
  const pnpmMangled = esmPackagesToTransform
    .map(name => name.replace('/', '\\+'))
    .join('|');
  return [
    `/node_modules/(?!\\.pnpm)(?!(${hoisted})/)`,
    `/node_modules/\\.pnpm/(?!(${pnpmMangled})@)`,
    '^.+\\.module\\.(css|sass|scss)$',
  ];
}

const createJestConfig = nextJest({dir: './'});

const customJestConfig = {
  cacheDirectory: '<rootDir>/.next/cache/jest',
  setupFiles: ['<rootDir>/jest.setup.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup-after-env.js'],
  testMatch: ['**/?(*.)+(spec|test).ts', '**/?(*.)+(spec|test).tsx'],
  moduleNameMapper: {
    '^@musiccharts/core/(.*)$': '<rootDir>/../../packages/core/src/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.next/'],
};

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  // next/jest replaces transformIgnorePatterns with its own defaults, so set
  // them after the merge.
  config.transformIgnorePatterns = buildTransformIgnorePatterns();
  return config;
};
