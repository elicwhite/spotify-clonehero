import {defineConfig} from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';
import unusedImports from 'eslint-plugin-unused-imports';

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
