import {defineConfig} from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  {
    extends: [...nextCoreWebVitals],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/component-hook-factories': 'off',
    },
  },
]);
