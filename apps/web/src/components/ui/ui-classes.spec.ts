import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Buttons, fields, cards and notices come from `components/ui` (T-603).
 *
 * The class strings these components replaced were copied from file to file
 * until a button in one form pressed differently from the same button in the
 * next. This spec refuses them anywhere outside `components/ui`: a new form
 * reaches for `<Button>` (or `buttonClasses()` for the rare element that is
 * neither a button nor a link), not for the string.
 *
 * Specs are left out: they quote the strings in order to check them.
 */

const SRC = join(__dirname, '..', '..');
const UI = join(__dirname);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === UI ? [] : files(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const RETIRED: [name: string, pattern: RegExp][] = [
  // The secondary button, the most repeated string in the app before T-603.
  ['the secondary button', /rounded border border-strong px-3 py-1 text-sm/],
  ['the primary button', /rounded bg-accent px-/],
];

describe('the shared components are the only place their class strings live', () => {
  const sources = files(SRC).map((path) => ({
    path: relative(SRC, path).split(sep).join('/'),
    lines: readFileSync(path, 'utf8').split('\n'),
  }));

  it('finds the source it is guarding', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((source) => source.path === 'components/action-form.tsx')).toBe(true);
    expect(sources.some((source) => source.path.startsWith('components/ui/'))).toBe(false);
  });

  for (const [name, pattern] of RETIRED) {
    it(`no file outside components/ui writes ${name} out by hand`, () => {
      const found = sources.flatMap(({ path, lines }) =>
        lines.flatMap((line, index) => (pattern.test(line) ? [`${path}:${index + 1}`] : [])),
      );
      expect(found, `use <Button> from '@/components/ui' instead`).toEqual([]);
    });
  }

  it('still recognises the strings it refuses', () => {
    expect('self-start rounded border border-strong px-3 py-1 text-sm').toMatch(RETIRED[0]![1]);
    expect('rounded bg-accent px-4 py-2').toMatch(RETIRED[1]![1]);
  });
});
