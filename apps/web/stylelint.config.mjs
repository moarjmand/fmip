/**
 * Layout CSS must use logical properties (CLAUDE.md rule 7). `margin-left` is
 * correct in a left-to-right page and wrong in a right-to-left one, and the
 * mistake is invisible until someone reads the site in Arabic — which is why it
 * is a lint error rather than a review note.
 *
 * @type {import('stylelint').Config}
 */
export default {
  rules: {
    'property-disallowed-list': [
      [
        /^(margin|padding|scroll-margin|scroll-padding)-(left|right)$/,
        /^border-(left|right)(-|$)/,
        /^border-(top|bottom)-(left|right)-radius$/,
        /^(left|right)$/,
        /^overflow-(x|y)$/,
      ],
      {
        message: (property) =>
          `"${property}" is a physical property and breaks right-to-left layouts. ` +
          'Use the logical equivalent: margin-inline-start / -end, padding-inline-*, ' +
          'border-inline-*, inset-inline-*, overflow-inline / overflow-block.',
      },
    ],
    'declaration-property-value-disallowed-list': [
      {
        'text-align': ['left', 'right'],
        float: ['left', 'right'],
        clear: ['left', 'right'],
      },
      {
        message: (property, value) =>
          `"${property}: ${value}" is physical and breaks right-to-left layouts. ` +
          'Use "start" or "end" instead.',
      },
    ],
  },
};
