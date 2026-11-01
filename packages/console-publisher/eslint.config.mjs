import base from '@fmip/config/eslint';

export default [
  ...base,
  {
    // The publisher runs under plain Node on the maintainer's computer
    // (D-340): the runtime globals are real there.
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: { process: 'readonly', structuredClone: 'readonly' },
    },
  },
];
