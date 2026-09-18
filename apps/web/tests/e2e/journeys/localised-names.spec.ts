import { expect, test } from '@playwright/test';

/**
 * A localised entity name is a row against the canonical id, shown in the
 * reader's language beside the name it is a name for (T-303, blueprint 13.1).
 *
 * The seed carries an Arabic name for Real Madrid and none for Turkish, which
 * gives both states on one team: `/ar` shows the Arabic heading with the
 * canonical name beneath it, `/tr` shows the canonical name alone, and neither
 * page invents anything (rule 3). One team, one id, two languages.
 *
 * Runs only in the `journeys` project (E2E_API_URL set), because the name is
 * read through the real API from the real seed.
 */
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';

test.describe('localised names', () => {
  test('shows the Arabic name on /ar, with the canonical name beneath it', async ({ page }) => {
    await page.goto(`/ar/team/${REAL_MADRID}`);
    await expect(page.getByTestId('title')).toHaveText('ريال مدريد');
    await expect(page.getByTestId('canonical-name')).toHaveText('Real Madrid');
    await expect(page).toHaveTitle(/ريال مدريد/);
  });

  test('shows the canonical name alone where nobody has written one', async ({ page }) => {
    await page.goto(`/tr/team/${REAL_MADRID}`);
    await expect(page.getByTestId('title')).toHaveText('Real Madrid');
    // Nothing is shown twice, and nothing is invented for Turkish.
    await expect(page.getByTestId('canonical-name')).toHaveCount(0);
  });

  test('is the same team under both names', async ({ page }) => {
    // The id in the URL is the entity; the name is what the reader is shown.
    // Both pages carry the same canonical name somewhere, because a page that
    // showed only the localised one would have lost what it is a name for.
    await page.goto(`/ar/team/${REAL_MADRID}`);
    await expect(page.getByText('Real Madrid', { exact: true })).toBeVisible();
    await page.goto(`/en/team/${REAL_MADRID}`);
    await expect(page.getByTestId('title')).toHaveText('Real Madrid');
  });
});
