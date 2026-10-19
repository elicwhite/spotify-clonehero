import fs from 'node:fs';
import {defineConfig} from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import unusedImports from 'eslint-plugin-unused-imports';

// Each top-level directory of app/ is one route. `__tests__` tests the app
// shell (the files at the root of app/), so it is not a route.
const appRoutes = fs
  .readdirSync(new URL('./app', import.meta.url), {withFileTypes: true})
  .filter(entry => entry.isDirectory() && entry.name !== '__tests__')
  .map(entry => `./app/${entry.name}`);

// lib/ is the block layer that other apps reuse, so it imports neither the
// site's routes nor its UI. components/ imports no route. A route imports only
// its own files, the app shell, components/ and lib/: code that two routes
// share lives in lib/ or components/.
const boundaryZones = [
  {
    target: './lib',
    from: ['./app', './components'],
    message: 'lib/ is the block layer. Move the shared code into lib/.',
  },
  {
    target: './components',
    from: appRoutes,
    message:
      'components/ is shared UI and does not import a route. Move the shared code into lib/ or components/.',
  },
  ...appRoutes.map(route => ({
    target: route,
    from: appRoutes.filter(other => other !== route),
    message:
      'A route does not import another route. Move the shared code into lib/ or components/.',
  })),
];

export default defineConfig([
  {
    ignores: [
      'public/**',
      '**/.next/**',
      'next-env.d.ts',
      // Agent git worktrees are full repo checkouts (with their own build
      // output); linting them duplicates every finding. Matches .prettierignore.
      '.claude/worktrees/**',
    ],
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
      'import/no-restricted-paths': ['error', {zones: boundaryZones}],
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
