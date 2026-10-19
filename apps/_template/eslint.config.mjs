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

// A route imports only its own files, the app shell, `lib/`, and
// `@musiccharts/core`. An app imports no other app: code that two apps share
// lives in packages/core. `except` is relative to `from`, so the app's own
// folder is the one folder of apps/ that stays allowed.
const boundaryZones = [
  {
    target: '.',
    from: '..',
    except: ['./__APP_NAME__'],
    message:
      'An app does not import another app. Move the shared code into packages/core.',
  },
  ...appRoutes.map(route => ({
    target: route,
    from: appRoutes.filter(other => other !== route),
    message:
      'A route does not import another route. Move the shared code into lib/ or packages/core.',
  })),
];

export default defineConfig([
  {
    ignores: ['public/**', '**/.next/**', 'next-env.d.ts', 'plans/**'],
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
