import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  compareFirstLoadJs,
  firstLoadScripts,
  measureFirstLoadJs,
  readBudgets,
} from '../../scripts/lib/perf-budgets.mjs';

/**
 * The first-load JavaScript budget's reading of the build (T-808), against a
 * miniature `.next` laid out the way Next 16 writes one. The Playwright budget
 * spec checks the same reading against a real build and its served HTML; this
 * one pins the rules: root main files plus every entry chunk, each counted
 * once, the `noModule` polyfill never.
 */

const WEB = join(__dirname, '..', '..');
let nextDir = '';

beforeAll(() => {
  nextDir = mkdtempSync(join(tmpdir(), 'fmip-perf-'));
  mkdirSync(join(nextDir, 'static', 'chunks'), { recursive: true });
  mkdirSync(join(nextDir, 'server', 'app', '[locale]', 'scores'), { recursive: true });
  writeFileSync(
    join(nextDir, 'build-manifest.json'),
    JSON.stringify({
      polyfillFiles: ['static/chunks/polyfill.js'],
      rootMainFiles: ['static/chunks/runtime.js', 'static/chunks/shared.js'],
    }),
  );
  const manifest = {
    entryJSFiles: {
      '[project]/apps/web/src/app/[locale]/layout': ['static/chunks/layout.js'],
      '[project]/apps/web/src/app/[locale]/scores/page': [
        'static/chunks/layout.js',
        'static/chunks/scores.js',
        'static/chunks/shared.js',
      ],
    },
  };
  writeFileSync(
    join(nextDir, 'server', 'app', '[locale]', 'scores', 'page_client-reference-manifest.js'),
    `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\n` +
      `globalThis.__RSC_MANIFEST["/[locale]/scores/page"] = ${JSON.stringify(manifest)};\n`,
  );
  for (const [name, bytes] of [
    ['polyfill.js', 5000],
    ['runtime.js', 3000],
    ['shared.js', 2000],
    ['layout.js', 1000],
    ['scores.js', 500],
  ] as const) {
    writeFileSync(join(nextDir, 'static', 'chunks', name), 'x'.repeat(bytes));
  }
});

afterAll(() => rmSync(nextDir, { recursive: true, force: true }));

describe('first-load JavaScript from the build output', () => {
  it('is the root main files and the entry chunks, each once, without the polyfill', () => {
    expect(firstLoadScripts(nextDir, '/[locale]/scores')).toEqual([
      'static/chunks/layout.js',
      'static/chunks/runtime.js',
      'static/chunks/scores.js',
      'static/chunks/shared.js',
    ]);
  });

  it('adds up raw bytes and gzip bytes', () => {
    const measured = measureFirstLoadJs(nextDir, '/[locale]/scores');
    expect(measured.raw).toBe(6500);
    expect(measured.gzip).toBeGreaterThan(0);
    expect(measured.gzip).toBeLessThan(measured.raw);
  });

  it('says to build first when a route has no build output', () => {
    expect(() => firstLoadScripts(nextDir, '/[locale]/nowhere')).toThrow(/next build/);
  });

  it('names the route, the number and the budget when one is over', () => {
    const budget = {
      name: 'scores',
      appRoute: '/[locale]/scores',
      path: '/en/scores',
      serverResponseMedianMs: 100,
    };
    const measure = () => ({ scripts: ['a', 'b'], raw: 9000, gzip: 2500 });

    const over = compareFirstLoadJs([{ ...budget, firstLoadJsGzipKB: 2 }], measure);
    expect(over.failures).toEqual([
      'scores (/[locale]/scores): first-load JS 2.5 kB gzip (9.0 kB raw, 2 scripts), budget 2 kB -- OVER BUDGET',
    ]);

    const within = compareFirstLoadJs([{ ...budget, firstLoadJsGzipKB: 2.5 }], measure);
    expect(within.failures).toEqual([]);
    expect(within.lines[0]).toMatch(/-- ok$/);
  });
});

describe('perf-budgets.json', () => {
  it('budgets the scores page, the match centre, the competition page and home', () => {
    const budgets = readBudgets(join(WEB, 'perf-budgets.json'));
    expect(budgets.map((b) => b.appRoute).sort()).toEqual([
      '/[locale]',
      '/[locale]/competition/[id]',
      '/[locale]/match/[id]',
      '/[locale]/scores',
    ]);
  });

  it('refuses a budget that is not a positive number', () => {
    const file = join(nextDir, 'bad-budgets.json');
    writeFileSync(
      file,
      JSON.stringify({
        routes: [
          {
            name: 'x',
            appRoute: '/x',
            path: '/x',
            firstLoadJsGzipKB: 0,
            serverResponseMedianMs: 1,
          },
        ],
      }),
    );
    expect(() => readBudgets(file)).toThrow(/firstLoadJsGzipKB must be a positive number/);
  });
});
