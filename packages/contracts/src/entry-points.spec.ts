import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser gets ES modules, Node gets CommonJS (T-1730, D-356).
 *
 * The CommonJS build cannot be tree-shaken, so while the browser resolved it,
 * every client bundle that used one constant from `@fmip/contracts` carried the
 * whole barrel: about 11.7 kB gzip on the scores page and the match centre.
 * Each entry point's "browser" condition now names the ES-module twin that
 * `tsconfig.esm.json` writes, and `"sideEffects": false` lets the bundler drop
 * the modules nothing uses. These read the manifest, so a new entry point added
 * without its twin fails here rather than as a quiet regression of the page
 * budgets.
 */
const ROOT = join(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  sideEffects?: unknown;
  scripts: Record<string, string>;
  exports: Record<string, string | Record<string, string>>;
};

const entries = Object.entries(manifest.exports).filter(
  (entry): entry is [string, Record<string, string>] => typeof entry[1] === 'object',
);

describe('the contracts entry points', () => {
  it('has the entries the sweep below is about', () => {
    expect(entries.map(([path]) => path)).toEqual(
      expect.arrayContaining(['.', './console', './translation-checks']),
    );
  });

  it('declares no side effects, so the bundler may drop unused modules', () => {
    expect(manifest.sideEffects).toBe(false);
  });

  it.each(entries)('%s: the browser gets the ES-module twin of the CommonJS file', (_, target) => {
    const cjs = /^\.\/dist\/([\w-]+)\.js$/.exec(target['default'] ?? '');
    expect(cjs, 'a CommonJS default under dist/').not.toBeNull();
    const name = cjs![1]!;
    expect(target['browser']).toBe(`./dist/esm/${name}.js`);
    expect(existsSync(join(ROOT, 'src', `${name}.ts`))).toBe(true);
    // The "browser" condition must come before "default": the first match wins.
    const keys = Object.keys(target);
    expect(keys.indexOf('browser')).toBeLessThan(keys.indexOf('default'));
  });

  it('builds the ES-module twins with the package', () => {
    expect(manifest.scripts['build']).toContain('tsc -p tsconfig.esm.json');
    const esm = readFileSync(join(ROOT, 'tsconfig.esm.json'), 'utf8');
    expect(esm).toMatch(/"module":\s*"ES20\d\d"/);
    expect(esm).toMatch(/"outDir":\s*"dist\/esm"/);
  });
});
