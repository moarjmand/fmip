import { expect, test } from '@playwright/test';

/**
 * The news page through the real web app and API (T-143, blueprint 3.1 and
 * 3.2). The seed carries no publisher feed, which is exactly the state worth
 * checking: every section says what it holds and why, rather than showing an
 * empty list that looks like a quiet day (rule 3); the page says the feeds
 * have never been read rather than posing as current (rule 4); a guest's
 * following section says it needs a session, not a 401 page; and a filter
 * that matches nothing says so.
 *
 * Runs only in the `journeys` project (E2E_API_URL set).
 */
test.describe('news sections', () => {
  test('the four sections, each saying what it holds', async ({ page }) => {
    await page.goto('/en/news');
    await expect(page.getByTestId('title')).toHaveText('News');
    const nav = page.getByTestId('news-sections');
    for (const section of ['latest', 'trending', 'debate', 'following']) {
      await expect(nav.getByTestId(`section-${section}`)).toBeVisible();
    }
    await expect(page.getByTestId('section-latest')).toHaveAttribute('aria-current', 'page');
    // Freshness is always stated; with nothing ever read, it says so.
    await expect(page.getByTestId('news-freshness')).toBeVisible();
    // Either stories or the reason there are none -- never a blank.
    await expect(page.getByTestId('stories').or(page.getByTestId('news-reason'))).toBeVisible();

    await page.getByTestId('section-trending').click();
    await expect(page).toHaveURL(/section=trending/);
    await expect(page.getByTestId('section-trending')).toHaveAttribute('aria-current', 'page');
    // Trending is computed from discussion only, and the page says so either way.
    await expect(page.getByTestId('news-reason')).toBeVisible();

    await page.getByTestId('section-debate').click();
    await expect(page.getByTestId('section-debate')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('stories').or(page.getByTestId('news-reason'))).toBeVisible();
  });

  test("a guest's following section asks for a session rather than failing", async ({ page }) => {
    await page.goto('/en/news?section=following');
    await expect(page.getByTestId('news-reason')).toContainText(
      'Sign in to see stories about what you follow.',
    );
    await expect(
      page.getByTestId('news-reason').getByRole('link', { name: 'Sign in' }),
    ).toHaveAttribute('href', '/en/login');
    await expect(page.getByTestId('stories')).toHaveCount(0);
  });

  test('a filter that matches nothing says so, and clears', async ({ page }) => {
    await page.goto('/en/news');
    const form = page.getByTestId('news-filters');
    const team = form.locator('select[name="team"]');
    await expect(team).toBeVisible();
    await team.selectOption({ index: 1 });
    await form.locator('select[name="language"]').selectOption('tr');
    await form.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/team=[0-9a-f-]{36}/);
    await expect(page).toHaveURL(/language=tr/);
    await expect(page.getByTestId('news-reason')).toHaveText('No story matches these filters.');
    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/en\/news$/);
  });
});
