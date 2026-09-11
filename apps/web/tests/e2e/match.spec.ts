import { expect, test } from '@playwright/test';

/**
 * The match centre page without an API behind it (CI's E2E job runs the web
 * app alone): a malformed id is a 404 page, an unreachable service is named,
 * and the stream proxy answers honestly.
 */
test.describe('match centre page', () => {
  test('a malformed id is not found', async ({ page }) => {
    const response = await page.goto('/en/match/not-a-fixture');
    expect(response?.status()).toBe(404);
  });

  test('names an unreachable service instead of an empty match', async ({ page }) => {
    await page.goto('/en/match/00000000-0000-4000-8000-000000000901?tz=Asia/Tehran');

    await expect(page.getByTestId('match-unreachable')).toBeVisible();
    await expect(page.getByTestId('timezone')).toContainText('Times in Asia/Tehran');
    await expect(page.getByTestId('match-header')).toHaveCount(0);

    const stream = await page.request.get(
      '/api/fixtures/00000000-0000-4000-8000-000000000901/stream',
    );
    expect(stream.status()).toBe(503);
    expect(await stream.json()).toMatchObject({ error: 'unavailable' });
    const bad = await page.request.get('/api/fixtures/nope/stream');
    expect(bad.status()).toBe(404);
  });
});
