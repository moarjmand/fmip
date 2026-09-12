import base from '@fmip/config/eslint';

export default [
  ...base,
  {
    // Operational scripts run under plain Node (T-073): the runtime globals are real there.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
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
