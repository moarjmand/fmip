import base from '@fmip/config/eslint';

export default [
  ...base,
  {
    // The operator's database tools (T-076) run under plain Node inside the
    // `migrate` image: the runtime globals are real there, and a command whose
    // whole purpose is to report has nowhere but the console to report to.
    // Same exception, same reason, as `apps/api/scripts`.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
