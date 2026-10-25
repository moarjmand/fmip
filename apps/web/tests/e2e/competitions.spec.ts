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

  test('is drawn on a wide screen only: on a phone the Leagues tab leads to every competition', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/scores');
    await expect(page.getByTestId('competitions-bar')).toBeHidden();
    await page.getByTestId('tab-leagues').click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
  });

  test('gives All competitions a 44px target and a ring inside it', async ({ page }) => {
    await page.goto('/en/scores');
    const all = page.getByTestId('competitions-bar-all');
    expect((await all.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await all.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(all).toBeFocused();
    expect(await all.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe('-2px');
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
    // The bar starts at the inline start: with nothing else in it, "All
    // competitions" is on the right (T-1513 puts it last, after the pills).
    const bar = await page.getByTestId('competitions-bar').boundingBox();
    const all = await page.getByTestId('competitions-bar-all').boundingBox();
    expect(all!.x + all!.width).toBeGreaterThan(bar!.x + bar!.width / 2);
  });
});
