import { expect, test } from '@playwright/test';

/**
 * The competitions bar and the All competitions page without an API behind
 * them (T-1433). What must hold regardless of data: the bar is on every page
 * under the header and always offers "All competitions"; with no list to
 * read it names nothing else, and the page says the list could not be read
 * rather than showing an empty one (rule 3).
 */
test.describe('competitions bar and page, no API', () => {
  test('the bar sits under the header and leads to All competitions', async ({ page }) => {
    await page.goto('/en/scores');

    const bar = page.getByRole('navigation', { name: 'Competitions' });
    await expect(bar).toBeVisible();
    // Under the header, above the page.
    const header = await page.locator('header').first().boundingBox();
    const box = await bar.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    // Nothing guessed: "All competitions" alone.
    await expect(bar.getByRole('link')).toHaveCount(1);

    await bar.getByRole('link', { name: 'All competitions' }).click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
    await expect(page.getByTestId('title')).toHaveText('All competitions');
    await expect(bar.getByRole('link', { name: 'All competitions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('competitions-unreachable')).toBeVisible();
    await expect(page.getByTestId('competitions-item')).toHaveCount(0);
  });

  test('is in Persian on /fa, and mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/fa/competitions');
    await expect(page.getByTestId('title')).toHaveText('همه رقابت‌ها');
    await expect(page.getByRole('navigation', { name: 'رقابت‌ها' })).toBeVisible();

    await page.goto('/x-rtl/competitions');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const title = page.getByTestId('title');
    await expect(title).toHaveCSS('border-right-width', '4px');
    await expect(title).toHaveCSS('border-left-width', '0px');
    // The bar starts at the inline start: "All competitions" is on the right.
    const bar = await page.getByTestId('competitions-bar').boundingBox();
    const all = await page.getByTestId('competitions-bar-all').boundingBox();
    expect(all!.x + all!.width).toBeGreaterThan(bar!.x + bar!.width / 2);
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
