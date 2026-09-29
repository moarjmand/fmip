import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The catalogues stay on the server (T-1040).
 *
 * `messages.ts` imports all eight catalogues. When a client component reached
 * it -- the error pages through `Translated`, the language picker through
 * `isShippable` -- every page's first load carried every language, and each
 * new string was paid for eight times on every route. Now a client component
 * is handed messages already resolved for the reader's locale, and this spec
 * holds that line: no module under a `'use client'` directive may reach
 * `messages.ts` or a catalogue file by static import.
 *
 * What counts: `import … from` and `export … from`, followed through `@/` and
 * relative paths. Not counted: `import type` (erased), and dynamic `import()`,
 * which the bundler splits into a chunk that is not first-load -- that is how
 * `global-error.tsx`, which has no layout to hand it words, loads them.
 */

const SRC = join(__dirname, '..');
const MESSAGES = join(SRC, 'i18n', 'messages.ts');
const CATALOGUES = join(SRC, 'i18n', 'catalogues');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

function resolveImport(from: string, specifier: string): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(from), specifier);
  else return undefined;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** The files a module imports as values, statically. */
function staticImports(file: string): string[] {
  if (!/\.tsx?$/.test(file)) return [];
  const text = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'/gms)) {
    const target = resolveImport(file, match[1] ?? '');
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** The import chain from `entry` to the first forbidden file, or `undefined`. */
function chainToCatalogues(entry: string): string[] | undefined {
  const previous = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (file === MESSAGES || file.startsWith(CATALOGUES)) {
      const chain: string[] = [];
      for (let at: string | null = file; at !== null; at = previous.get(at) ?? null) {
        chain.unshift(relative(SRC, at).replaceAll('\\', '/'));
      }
      return chain;
    }
    for (const next of staticImports(file)) {
      if (!previous.has(next)) {
        previous.set(next, file);
        queue.push(next);
      }
    }
  }
  return undefined;
}

const CLIENT_MODULES = sources(SRC).filter((file) =>
  /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')),
);

describe('the catalogues stay on the server', () => {
  it('finds the client modules it is guarding', () => {
    const names = CLIENT_MODULES.map((file) => relative(SRC, file).replaceAll('\\', '/'));
    expect(names).toContain('app/global-error.tsx');
    expect(names).toContain('components/language-picker.tsx');
  });

  it('follows imports far enough to catch a server module that reaches them', () => {
    // The walker's own check: `Translated` is a server tool and does reach them.
    expect(chainToCatalogues(join(SRC, 'components', 'translated.tsx'))).toEqual([
      'components/translated.tsx',
      'i18n/messages.ts',
    ]);
  });

  it('no client module reaches messages.ts or a catalogue by static import', () => {
    const leaks = CLIENT_MODULES.map(chainToCatalogues)
      .filter((chain): chain is string[] => chain !== undefined)
      .map((chain) => chain.join(' -> '));
    expect(leaks).toEqual([]);
  });
});
