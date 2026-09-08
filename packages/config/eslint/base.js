import js from '@eslint/js';
import prettierCompat from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint configuration for every TypeScript workspace in FMIP.
 *
 * App-specific configs (Next.js, NestJS) spread this array first and then add
 * their own layers. `prettierCompat` stays last so formatting rules never fight
 * Prettier.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Type-only imports must be explicit: NestJS and bundlers both rely on it.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Rule 3 in CLAUDE.md: missing data is an explicit coverage state, never a
      // silently swallowed value. `any` erases exactly that distinction.
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierCompat,
);
