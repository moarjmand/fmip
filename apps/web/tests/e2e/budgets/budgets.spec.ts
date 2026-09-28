import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { firstLoadScripts, readBudgets } from '../../../scripts/lib/perf-budgets.mjs';

/**
 * Performance budgets, the server half (T-808).
 *
 * The first-load JavaScript half is `scripts/perf-budgets.mjs`, which reads the
 * build output and runs in CI's Verify job. This half needs what that one
 * cannot have: the production build **serving real pages**, with the API, the
 * migrated database and the seed behind it (CI's "E2E journeys" job). It
 * checks two things per budgeted route:
 *
 * 1. **The server response time.** The whole HTML document, timed from the
 *    request to the last byte, because a server-rendered page is not useful
 *    until the API calls behind it have answered. Two untimed requests warm
 *    the route first (the first request of a route pays for loading its
 *    code, which no member after the first one pays); then the median of
 *    `SAMPLES` sequential requests is held to `serverResponseMedianMs`. The
 *    median, not the maximum: one scheduling hiccup on a shared CI runner is
 *    not a regression, and a slower route moves every sample.
 * 2. **That the build reading is honest.** The scripts the served HTML names
 *    are exactly the scripts `firstLoadScripts` counts from the manifests. If
 *    a Next upgrade changes what the manifests mean, this fails rather than
 *    the JavaScript budget quietly measuring the wrong thing.
 *
 * Budgets live in `perf-budgets.json`; how to raise one is in
 * `docs/08-load-test.md`, "Page budgets".
 */

const SAMPLES = 9;
const WARM_UP = 2;
const WEB = join(__dirname, '..', '..', '..');
const NEXT_DIR = join(WEB, '.next');

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The scripts a document loads at once, as `.next`-relative paths; `noModule` ones are skipped. */
function scriptsIn(html: string): string[] {
  const scripts = new Set<string>();
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
    if (/\bnoModule\b/i.test(tag)) continue;
    const src = /\bsrc="\/_next\/([^"]+)"/.exec(tag)?.[1];
    if (src !== undefined) scripts.add(src);
  }
  return [...scripts].sort();
}

for (const budget of readBudgets(join(WEB, 'perf-budgets.json'))) {
  test(`${budget.name} (${budget.path}) answers within its server response budget`, async ({
    baseURL,
  }) => {
    const url = new URL(budget.path, baseURL).toString();
    const timed = async (): Promise<{ ms: number; status: number; html: string }> => {
      const started = performance.now();
      const response = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
      const html = await response.text();
      return { ms: performance.now() - started, status: response.status, html };
    };

    for (let i = 0; i < WARM_UP; i++) {
      const warm = await timed();
      expect(warm.status, `${budget.path} must render for its budget to mean anything`).toBe(200);
    }
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) samples.push((await timed()).ms);
    const measured = Math.round(median(samples));

    const summary =
      `${budget.name} (${budget.path}): server response median ${measured} ms over ${SAMPLES} requests ` +
      `(${samples.map((ms) => Math.round(ms)).join(', ')}), budget ${budget.serverResponseMedianMs} ms`;
    test.info().annotations.push({ type: 'budget', description: summary });
    console.log(summary);
    expect(
      measured,
      `${summary} -- OVER BUDGET. Make the page cheaper, or raise serverResponseMedianMs in ` +
        'apps/web/perf-budgets.json with the reason (docs/08-load-test.md, "Page budgets").',
    ).toBeLessThanOrEqual(budget.serverResponseMedianMs);
  });

  test(`${budget.name}: the served HTML loads exactly the scripts the JavaScript budget counts`, async ({
    request,
  }) => {
    const response = await request.get(budget.path);
    expect(response.status()).toBe(200);
    expect(
      scriptsIn(await response.text()),
      `the scripts ${budget.path} names, against firstLoadScripts(${budget.appRoute})`,
    ).toEqual(firstLoadScripts(NEXT_DIR, budget.appRoute));
  });
}
