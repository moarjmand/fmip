import base from '@fmip/config/eslint';
import next from 'eslint-config-next/core-web-vitals';

// Tailwind class prefixes that hardcode a physical side. The CSS equivalent is
// caught by stylelint, but in a Tailwind codebase nearly all layout lives in
// class names, so the same rule has to reach here or it barely applies.
const PHYSICAL_UTILITY = String.raw`(?:^|[\s:])(?:-?(?:ml|mr|pl|pr|left|right|inset-l|inset-r|border-l|border-r|rounded-l|rounded-r|rounded-t[lr]|rounded-b[lr]|scroll-ml|scroll-mr|scroll-pl|scroll-pr|float-left|float-right|text-left|text-right)-)`;

export default [
  // Next's config comes first so the shared base's TypeScript layer wins the
  // parser for .ts/.tsx: `eslint-config-next/parser` does not expose the parser
  // services typescript-eslint rules ask for, and a rule that needs them fails
  // the whole run rather than being skipped. Next's own rules are AST-based and
  // work fine under @typescript-eslint/parser.
  ...next,
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name='className'] Literal[value=/${PHYSICAL_UTILITY}/]`,
          message:
            'Physical Tailwind utility in a className. Use the logical variant instead: ' +
            'ms-/me- for ml-/mr-, ps-/pe- for pl-/pr-, start-/end- for left-/right-, ' +
            'border-s/border-e, rounded-s/rounded-e, text-start/text-end (CLAUDE.md rule 7).',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    // A config file's default export is the config. Naming it first adds a line
    // and no meaning.
    files: ['*.config.mjs', '*.config.ts', '*.config.mts'],
    rules: {
      'import/no-anonymous-default-export': 'off',
    },
  },
];
