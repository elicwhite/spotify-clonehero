import fs from 'node:fs';
import {defineConfig} from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import unusedImports from 'eslint-plugin-unused-imports';

// The block layer (everything in src/ except src/components) imports no UI.
const blockEntries = fs
  .readdirSync(new URL('./src', import.meta.url))
  .filter(name => name !== 'components')
  .map(name => `./src/${name}`);

const boundaryZones = [
  {
    target: './src',
    from: '../../apps',
    message:
      'Core is shared by every app and imports none of them. Move the shared code into core.',
  },
  {
    target: blockEntries,
    from: './src/components',
    message:
      'The blocks do not import UI. Move the shared code out of src/components.',
  },
];

export default defineConfig([
  {
    ignores: ['**/.next/**', 'node_modules/**'],
  },
  {
    extends: [...nextCoreWebVitals],
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      // Core has no pages directory, so the rule has nothing to check.
      '@next/next/no-html-link-for-pages': 'off',
      'import/no-restricted-paths': ['error', {zones: boundaryZones}],
      // `@/` points at the app that builds the code, so inside core it would
      // reach into whichever app imports core. Core uses relative imports.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*'],
              message:
                'Core does not use the app alias `@/`. Import with a relative path.',
            },
          ],
        },
      ],
      'unused-imports/no-unused-vars': [
        'error',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  // Must come last — turns off ESLint rules that conflict with Prettier.
  prettier,
]);
