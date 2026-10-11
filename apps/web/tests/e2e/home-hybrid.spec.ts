import { expect, test } from '@playwright/test';

/**
 * The Hybrid front page (T-1382, D-200), on the production build, with or
 * without the API behind it: the page is editorial, so it stays on paper in
 * Night as well as Day, and its side column sits on the inline end -- on the
 * right in English, on the left under `dir="rtl"`.
 */

const PAPER = 'rgb(250, 250, 247)';

test.describe('the Hybrid homepage', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`is on paper in the ${theme} theme`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'fmip_theme', value: theme, url: baseURL! }]);
      await page.goto('/en');
      const main = page.locator('main[data-mode="editorial"]');
      await expect(main).toHaveCount(1);
      expect(await main.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(PAPER);
    });
  }

  test('keeps its side column on the inline end in both directions', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const [path, rtl] of [
      ['/en', false],
      ['/x-rtl', true],
    ] as const) {
      await page.goto(path);
      // The key matches, or the sentence saying they could not be loaded.
      const main = await page.locator('[aria-labelledby="home-key"]').boundingBox();
      const side = await page.getByTestId('home-accuracy').boundingBox();
      expect(main).not.toBeNull();
      expect(side).not.toBeNull();
      if (rtl) expect(side!.x + side!.width).toBeLessThanOrEqual(main!.x);
      else expect(main!.x + main!.width).toBeLessThanOrEqual(side!.x);
    }
  });

  test('stacks the side column under the main one on a phone, with no sideways scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fa');
    const main = await page.locator('[aria-labelledby="home-key"]').boundingBox();
    const side = await page.getByTestId('home-accuracy').boundingBox();
    expect(side!.y).toBeGreaterThan(main!.y);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  });
});
