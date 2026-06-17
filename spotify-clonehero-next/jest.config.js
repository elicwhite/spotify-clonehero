const nextJest = require('next/jest');

// ESM-only deps that must be transformed by SWC. Scoped names use a forward
// slash here; the helper rewrites them for pnpm's mangled `.pnpm` directory.
const esmPackagesToTransform = ['webfft', '@awasm/noble', 'p-map'];

// Build transformIgnorePatterns that work under both pnpm's nested
// `.pnpm/<name+ver>/node_modules/<name>/` layout and a hoisted
// `node_modules/<name>/` layout.
function buildTransformIgnorePatterns() {
  const hoisted = esmPackagesToTransform.join('|');
  // pnpm mangles scoped names in the `.pnpm` dir: `@scope/name` -> `@scope+name`,
  // and the entry is suffixed with `@<version>`.
  const pnpmMangled = esmPackagesToTransform
    .map(name => name.replace('/', '\\+'))
    .join('|');
  return [
    // Non-.pnpm (hoisted) packages.
    `/node_modules/(?!\\.pnpm)(?!(${hoisted})/)`,
    // pnpm `.pnpm` store entries, matched on the mangled `<name>@` prefix.
    `/node_modules/\\.pnpm/(?!(${pnpmMangled})@)`,
    '^.+\\.module\\.(css|sass|scss)$',
  ];
}

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
  // ESM-only deps must be transformed through SWC like our own code.
  transformIgnorePatterns: buildTransformIgnorePatterns(),
};

// createJestConfig is exported in this way to ensure that next/jest can load the Next.js configuration, which is async
// Wrap to override transformIgnorePatterns AFTER next/jest sets its defaults,
// since next/jest prepends its own node_modules pattern that would shadow ours.
const baseConfig = createJestConfig(customJestConfig);
module.exports = async () => {
  const config = await baseConfig();
  config.transformIgnorePatterns = buildTransformIgnorePatterns();
  return config;
};
