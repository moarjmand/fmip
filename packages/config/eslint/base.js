import js from '@eslint/js';
import prettierCompat from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const TYPESCRIPT_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

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
  {
    // TypeScript rules must not reach .js/.mjs config files. An app that brings
    // its own parser (Next does) applies it to every file it matches, and a
    // TypeScript rule then fails on a plain JavaScript file rather than being
    // skipped.
    files: TYPESCRIPT_FILES,
    extends: [tseslint.configs.recommended],
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
    },
  },
  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts', '**/tests/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierCompat,
);
