import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No physical side in a class name (CLAUDE.md rule 7, T-1501). Stylelint
 * refuses `margin-left` and its kin in the CSS files; most of the layout is
 * Tailwind utilities in the components, which stylelint never reads, so this
 * refuses their physical forms there: `ml-*`, `pr-*`, `left-*`, `text-right`,
 * `border-l`, `rounded-tr-*` and the rest. The logical ones (`ms-*`, `pe-*`,
 * `start-*`, `text-end`, `border-s`, `rounded-se-*`) mirror on `/fa`.
 *
 * Comments are left out: they name the physical forms to say why not.
 * Specs are left out: they quote class strings to check them.
 */

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The source without its comments, line numbers kept. */
function code(source: string): string[] {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'));
}

/**
 * A Tailwind utility with a physical side, as a whole class token (after any
 * variants such as `md:` or `hover:`, and an optional `-` or `!`).
 */
const PHYSICAL =
  /(?<=^|[\s"'`:!-])(?:m[lr]|p[lr]|scroll-m[lr]|scroll-p[lr]|left|right|border-[lr]|rounded-[lr]|rounded-[tb][lr])-(?:\d|\[|px\b|auto\b|full\b|none\b|sm\b|md\b|lg\b|xl\b|control\b)|(?<=^|[\s"'`:])(?:text-(?:left|right)|float-(?:left|right)|clear-(?:left|right)|border-[lr])(?=$|[\s"'`])/;

describe('class names name logical sides, never physical ones', () => {
  const sources = files(SRC).map((path) => ({
    path: relative(SRC, path).split(sep).join('/'),
    lines: code(readFileSync(path, 'utf8')),
  }));

  it('finds the source it is guarding', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(sources.some((source) => source.path === 'components/voices.tsx')).toBe(true);
  });

  it('knows a physical utility when it sees one, and lets a logical one pass', () => {
    for (const physical of ['ml-2', 'md:pr-4', '-left-1', 'right-[3px]', 'text-left', 'border-l'])
      expect(PHYSICAL.test(` ${physical} `), physical).toBe(true);
    for (const logical of ['ms-2', 'md:pe-4', '-start-1', 'end-[3px]', 'text-start', 'border-s'])
      expect(PHYSICAL.test(` ${logical} `), logical).toBe(false);
    // Words, not classes.
    for (const word of ['right-to-left', 'left-aligned', 'copyright-2026']) {
      expect(PHYSICAL.test(` ${word} `), word).toBe(false);
    }
  });

  it('no component or page uses a physical side', () => {
    const found = sources.flatMap(({ path, lines }) =>
      lines.flatMap((line, index) =>
        PHYSICAL.test(line) ? [`${path}:${index + 1}: ${line.trim().slice(0, 100)}`] : [],
      ),
    );
    expect(
      found,
      'use the logical utility (ms/me, ps/pe, start/end, text-start/end, border-s/e)',
    ).toEqual([]);
  });
});
