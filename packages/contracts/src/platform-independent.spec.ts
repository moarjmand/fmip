import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The contracts package belongs to no platform (T-321).
 *
 * Phase 4 plans a second client (`04-tasks-phase-4.md`, E32) on the claim that
 * "the same API and shared types" make one cheap. That claim rests entirely on
 * this package being free of platform assumptions, and until now nobody had
 * checked — so this is the check, written before the framework decision rather
 * than after it, because a failure here is much cheaper to learn about now.
 *
 * It is also a guard for the present. Today `apps/api` (Node) and `apps/web`
 * (Node and a browser) both consume this package; a `node:` import or a
 * `document` reference that slipped in would break one of the two in a way that
 * only shows up at runtime, on whichever side happened to load it.
 *
 * **What is not checked, and why not.** The built `dist/` would be the strongest
 * evidence, but it does not exist on a clean checkout before `build` runs, and a
 * guard that skips itself when its subject is missing is a guard that reports
 * success for doing nothing (the `REDIS_URL` lesson in `03-project-map.md`).
 * These read the source, which always exists.
 */
const SRC = __dirname;
const ROOT = join(SRC, '..');

/** Every file this package actually ships: its own sources, not its tests. */
const SHIPPED = readdirSync(SRC)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
  .map((name) => ({ name, body: readFileSync(join(SRC, name), 'utf8') }));

describe('the contracts package imports nothing', () => {
  it('ships more than a handful of modules, so the sweep below means something', () => {
    // If a refactor ever moved the contracts elsewhere, every test under this
    // heading would pass over an empty list and say so cheerfully.
    expect(SHIPPED.length).toBeGreaterThanOrEqual(15);
  });

  it('imports only from itself', () => {
    // A relative import is this package. Anything else — `node:fs`, `react`,
    // `next/headers`, a polyfill — is a platform this package would then
    // belong to.
    for (const file of SHIPPED) {
      const specifiers = [
        ...file.body.matchAll(/(?:^|\n)\s*(?:import|export)[^;]*?from\s+'([^']+)'/g),
      ]
        .map((found) => found[1] ?? '')
        .filter((specifier) => !specifier.startsWith('.'));
      expect(specifiers, `${file.name} imports outside the package`).toEqual([]);
    }
  });

  it('has no runtime dependencies at all', () => {
    // Not "no web dependencies": none. A dependency here is a dependency every
    // consumer inherits, including a client that has not been written yet.
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });
});

describe('the contracts package assumes no host', () => {
  it('names no browser or Node global', () => {
    // Referencing one would compile — `lib` is checked below and would catch a
    // typed use, but a `typeof window !== 'undefined'` guard is untyped and
    // would not. Either way the package would be deciding where it is running,
    // which is the assumption this file exists to prevent.
    const forbidden = [
      'window',
      'document',
      'navigator',
      'localStorage',
      'sessionStorage',
      'process',
      'Buffer',
      '__dirname',
      'globalThis',
    ];
    for (const file of SHIPPED) {
      // Comments carry prose — "the document a member reads" — so only code is
      // searched.
      const code = file.body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/.*/g, '$1');
      for (const name of forbidden) {
        expect(code, `${file.name} refers to ${name}`).not.toMatch(
          new RegExp(`(^|[^.\\w'"\`])${name}\\b`),
        );
      }
    }
  });

  it('compiles against the language and nothing else', () => {
    // No `DOM`, so a browser type cannot be used even by accident; no `types`
    // entry, so `@types/node` does not leak its globals into the build. The two
    // together are what make the guard above a belt rather than the whole
    // trousers.
    const base = JSON.parse(
      readFileSync(join(ROOT, '..', 'config', 'tsconfig', 'base.json'), 'utf8'),
    ) as {
      compilerOptions?: { lib?: string[]; types?: string[] };
    };
    const lib = base.compilerOptions?.lib ?? [];
    expect(lib.length).toBeGreaterThan(0);
    expect(
      lib.some((entry) => /dom/i.test(entry)),
      `lib is ${lib.join(', ')}`,
    ).toBe(false);
    expect(base.compilerOptions?.types).toBeUndefined();
  });

  it('excludes its own tests from what it ships', () => {
    // The tests do import `node:fs` and `vitest`, legitimately. That is only
    // legitimate while they are excluded from the build.
    const build = JSON.parse(readFileSync(join(ROOT, 'tsconfig.build.json'), 'utf8')) as {
      exclude?: string[];
    };
    expect(build.exclude ?? []).toContain('**/*.spec.ts');
  });
});
