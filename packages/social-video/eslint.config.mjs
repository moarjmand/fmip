import base from '@fmip/config/eslint';

export default [
  { ignores: ['public/**', 'out/**'] },
  ...base,
  {
    // The compositions run in Remotion's browser, the scripts under plain
    // Node in the worker image: both sets of globals are real.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: { globals: { document: 'readonly', FontFace: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
];
