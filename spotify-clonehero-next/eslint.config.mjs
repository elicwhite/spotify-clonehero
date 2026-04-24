import {defineConfig} from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  {
    extends: [...nextCoreWebVitals],
  },
  // Must come last — turns off ESLint rules that conflict with Prettier.
  prettier,
]);
