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

    // Matches and predictions are one page (T-1496).
    await expect(page.getByTestId('title')).toHaveText('Matches');
    const days = page.getByTestId('day-strip').getByRole('link');
    await expect(days).toHaveCount(7);
    // The named day, then the day of the month.
    await expect(days.nth(0)).toHaveText(/^Yesterday\s*\d{1,2}$/);
    await expect(days.nth(1)).toHaveText(/^Today\s*\d{1,2}$/);
    await expect(days.nth(1)).toHaveAttribute('aria-current', 'date');
    await expect(page.getByTestId('filters').getByRole('link', { name: 'Live' })).toBeVisible();
    // A guest has no picks and no teams: those two views are a member's.
    await expect(page.getByTestId('view-unpicked')).toHaveCount(0);
    await expect(page.getByTestId('view-mine')).toHaveCount(0);
    await expect(page.getByTestId('filters').getByRole('link', { name: 'All' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // A guest on /en with no zone of their own reads UK time (T-1391, D-207).
    await expect(page.getByTestId('timezone')).toContainText(
      'Times: UK time (sign in for your own zone)',
    );

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

    await expect(page.getByTestId('timezone')).toContainText('Times: Tehran time');
    const live = page.getByTestId('filters').getByRole('link', { name: 'Live' });
    await expect(live).toHaveAttribute('href', /date=2087-01-07/);
    await expect(live).toHaveAttribute('href', /tz=Asia%2FTehran/);
    await expect(live).toHaveAttribute('href', /live=1/);
  });

  test('picks any date with a plain GET form and steps a day either way', async ({ page }) => {
    await page.goto('/en/scores?date=2087-01-07&tz=Asia/Tehran&live=1&country=intl&stage=knockout');

    const picker = page.getByTestId('date-picker');
    await expect(page.getByTestId('date-input')).toHaveValue('2087-01-07');
    await expect(picker.getByTestId('previous-day')).toHaveAttribute('href', /date=2087-01-06/);
    await expect(picker.getByTestId('next-day')).toHaveAttribute('href', /date=2087-01-08/);
    // Filters travel with every link, so a filtered view is an address to share.
    await expect(picker.getByTestId('next-day')).toHaveAttribute('href', /country=intl/);
    await expect(picker.getByTestId('next-day')).toHaveAttribute('href', /stage=knockout/);
    const live = page.getByTestId('filters').getByRole('link', { name: 'All' });
    await expect(live).toHaveAttribute('href', /country=intl&stage=knockout/);

    await page.getByTestId('date-input').fill('2087-03-14');
    await picker.getByRole('button', { name: 'Show day' }).click();
    await expect(page).toHaveURL(/date=2087-03-14/);
    await expect(page).toHaveURL(/tz=Asia%2FTehran/);
    await expect(page).toHaveURL(/live=1/);
    await expect(page).toHaveURL(/country=intl/);
    await expect(page.getByTestId('date-input')).toHaveValue('2087-03-14');

    // Without an API there is no day to derive countries or stages from,
    // so none is offered rather than an empty list that looks like a choice.
    await expect(page.getByTestId('more-filters')).toHaveCount(0);
  });

  test('mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/x-rtl/scores');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    // The title and the day strip start at the inline start: the right.
    const width = page.viewportSize()?.width ?? 1280;
    for (const id of ['title', 'day-strip']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box).not.toBeNull();
      if (box !== null) expect(box.x + box.width).toBeGreaterThan(width * 0.5);
    }
    const days = page.getByTestId('day-strip').getByRole('link');
    const first = await days.nth(0).boundingBox();
    const second = await days.nth(1).boundingBox();
    if (first !== null && second !== null) expect(first.x).toBeGreaterThan(second.x);
  });
});
