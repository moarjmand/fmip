import { expect, test } from '@playwright/test';

/**
 * The scores page without an API behind it (CI's E2E job runs the web app
 * alone). What must hold regardless of data: the day strip covers yesterday
 * to five days ahead, the filters render, and an unreachable service is said
 * out loud rather than shown as an empty day (rule 3).
 */
test.describe('scores page', () => {
  test('renders the day strip and filters, and names an unreachable service', async ({ page }) => {
    await page.goto('/en/scores');

    await expect(page.getByTestId('title')).toHaveText('Scores');
    const days = page.getByTestId('day-strip').getByRole('link');
    await expect(days).toHaveCount(7);
    await expect(days.nth(0)).toHaveText('Yesterday');
    await expect(days.nth(1)).toHaveText('Today');
    await expect(days.nth(1)).toHaveAttribute('aria-current', 'date');
    await expect(page.getByTestId('filters').getByRole('link', { name: 'Live' })).toBeVisible();
    await expect(page.getByTestId('timezone')).toContainText('Times in UTC');

    await expect(page.getByTestId('scores-unreachable')).toBeVisible();
    await expect(page.getByTestId('score-card')).toHaveCount(0);
    // No live indicator either: nothing is being kept current.
    await expect(page.getByTestId('live-state')).toHaveCount(0);

    // The stream proxy answers honestly for an unreachable API.
    const stream = await page.request.get(
      '/api/scores/stream?from=2087-01-05&to=2087-01-05&tz=UTC',
    );
    expect(stream.status()).toBe(503);
    expect(await stream.json()).toMatchObject({ error: 'unavailable' });
  });

  test('keeps the chosen day and zone in the strip links', async ({ page }) => {
    await page.goto('/en/scores?date=2087-01-07&tz=Asia/Tehran');

    await expect(page.getByTestId('timezone')).toContainText('Times in Asia/Tehran');
    const live = page.getByTestId('filters').getByRole('link', { name: 'Live' });
    await expect(live).toHaveAttribute('href', /date=2087-01-07/);
    await expect(live).toHaveAttribute('href', /tz=Asia%2FTehran/);
    await expect(live).toHaveAttribute('href', /live=1/);
  });

  test('mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/x-rtl/scores');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const title = page.getByTestId('title');
    await expect(title).toHaveCSS('border-right-width', '4px');
    await expect(title).toHaveCSS('border-left-width', '0px');
  });
});
