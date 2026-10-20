import { expect, test } from '@playwright/test';

/**
 * The Highlights page without an API behind it (T-1434). What must hold
 * regardless of data: the header's nav leads to it and marks it current, and
 * an unreachable service is said out loud rather than shown as an empty list
 * (rule 3); Persian, and mirrored under the rtl pseudo-locale.
 */
test.describe('Highlights page, no API', () => {
  test('the nav leads here, and an unreachable API is named', async ({ page }) => {
    await page.goto('/en/scores');
    const nav = page.getByTestId('primary-nav');
    await nav.getByRole('link', { name: 'Highlights' }).click();
    await expect(page).toHaveURL(/\/en\/highlights$/);
    await expect(page.getByTestId('title')).toHaveText('Highlights');
    await expect(page.getByTestId('nav-highlights')).toHaveAttribute('aria-current', 'page');

    await expect(page.getByTestId('highlights-unreachable')).toBeVisible();
    await expect(page.getByTestId('highlight-item')).toHaveCount(0);
    await expect(page.getByTestId('highlights-empty')).toHaveCount(0);
  });

  test('is in Persian on /fa, and mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/fa/highlights');
    await expect(page.getByTestId('title')).toHaveText('هایلایت‌ها');

    await page.goto('/x-rtl/highlights');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const title = page.getByTestId('title');
    await expect(title).toHaveCSS('border-right-width', '4px');
    await expect(title).toHaveCSS('border-left-width', '0px');
  });
});
