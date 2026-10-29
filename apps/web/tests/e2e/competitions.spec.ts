import { expect, test } from '@playwright/test';

/**
 * The All competitions page without an API behind it (T-1433). The page says
 * the list could not be read rather than showing an empty one (rule 3). The
 * competitions bar that led to it (the matchday rail, T-1624) gave way to
 * the moments rail (T-1642, D-300), which draws nothing without an answer
 * (`moments-rail.spec.ts`); the header's Competitions and the phone's
 * Leagues tab lead here.
 */
test.describe('the All competitions page, no API', () => {
  test('says the list could not be read, and draws no rail with nothing to show', async ({
    page,
  }) => {
    await page.goto('/en/competitions');
    await expect(page.getByTestId('title')).toHaveText('All competitions');
    await expect(page.getByTestId('competitions-unreachable')).toBeVisible();
    await expect(page.getByTestId('competitions-item')).toHaveCount(0);
    await expect(page.getByTestId('moments-rail')).toHaveCount(0);
  });

  test('is reached from the Leagues tab on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/scores');
    await page.getByTestId('tab-leagues').click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
  });

  test('is in Persian on /fa, and mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/fa/competitions');
    await expect(page.getByTestId('title')).toHaveText('همه رقابت‌ها');

    await page.goto('/x-rtl/competitions');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const title = page.getByTestId('title');
    await expect(title).toHaveCSS('border-right-width', '4px');
    await expect(title).toHaveCSS('border-left-width', '0px');
  });
});

/**
 * A competition's page without an API (T-1498): its name in the page's
 * words and the sentence that it cannot be shown, never an empty table, in
 * English, Persian and the right-to-left pseudo-locale, on a phone and a
 * desktop, with nothing scrolling the page sideways.
 */
test.describe('a competition page, no API', () => {
  const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
  for (const width of [390, 1440]) {
    for (const [locale, dir] of [
      ['en', 'ltr'],
      ['fa', 'rtl'],
      ['x-rtl', 'rtl'],
    ] as const) {
      test(`${locale} at ${width}px says it cannot be shown`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}/competition/${PREMIER_LEAGUE}`);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await expect(page.getByTestId('competition-unreachable')).toBeVisible();
        await expect(page.locator('table')).toHaveCount(0);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
