import { expect, test } from '@playwright/test';

/**
 * The page does not move when its fonts arrive (T-1536). PageSpeed's phone
 * found the home page shifting by 0.068 and the match centre by 0.021 when
 * Archivo replaced its fallback: an extrabold, semi-expanded heading drawn in
 * a synthetic bold of Arial was much narrower, and a row that only just fit
 * wrapped once the real face came. Here every web font is held back long
 * enough for the page to be drawn in its fallbacks first, then let through,
 * and the shifts of the swap are added up: under 0.05 (D-264's bar for /en,
 * T-1536's for both pages).
 */

const PLAYED_MATCH = '00000000-0000-4000-8000-000000000901';

test.use({ viewport: { width: 412, height: 823 } });

for (const path of ['/en', `/en/match/${PLAYED_MATCH}`]) {
  test(`${path} on a phone: the fonts' arrival shifts the page by under 0.05`, async ({ page }) => {
    let held = 0;
    await page.route('**/*.woff2', async (route) => {
      held += 1;
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.addInitScript(() => {
      const shifts: number[] = [];
      (window as unknown as { __shifts: number[] }).__shifts = shifts;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) shifts.push(entry.value);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    // Archivo, at least, was held and has arrived.
    expect(held).toBeGreaterThan(0);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.includes('Archivo') && face.status === 'loaded',
        ),
      ),
    ).toBe(true);
    // Two frames for the redraw to be laid out and its shifts reported.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const total = await page.evaluate(() =>
      (window as unknown as { __shifts: number[] }).__shifts.reduce((sum, value) => sum + value, 0),
    );
    expect(total).toBeLessThan(0.05);
  });
}
