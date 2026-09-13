import base from '@fmip/config/eslint';

export default [
  ...base,
  {
    // Operational scripts run under plain Node (T-073, T-113): the runtime
    // globals are real there, and a script whose whole output is a report has
    // nowhere but the console to put it.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // NestJS resolves constructor dependencies from `design:paramtypes`
      // metadata, which TypeScript only emits for value imports. Rewriting an
      // injected class to `import type` erases it and breaks dependency
      // injection at runtime, so the shared rule is off in this app.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
