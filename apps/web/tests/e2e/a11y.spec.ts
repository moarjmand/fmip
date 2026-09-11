import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The accessibility pass (T-081, D-041): WCAG 2.2 AA as axe-core checks it,
 * on every kind of page the platform has, plus the two things a rule engine
 * cannot judge — the keyboard path into the content and the live region
 * that puts score changes into words. CI runs without an API, so the pages
 * show their honest "unreachable" state; that state has to pass too.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const PAGES = [
  '/en',
  '/en/scores',
  '/en/leaderboard',
  '/en/search',
  '/en/search?q=real',
  '/en/login',
  '/en/register',
  '/en/match/00000000-0000-4000-8000-000000000901',
  '/en/competition/00000000-0000-4000-8000-000000000201',
  '/en/team/00000000-0000-4000-8000-000000000601',
  '/en/player/00000000-0000-4000-8000-000000000701',
  '/x-rtl/scores',
];

test.describe('accessibility', () => {
  for (const path of PAGES) {
    test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
      await page.goto(path);
      const builder = new AxeBuilder({ page }).withTags(TAGS);
      // `x-rtl` is a BCP 47 private-use tag for a QA surface, not a language
      // (D-003); axe's lang check knows only registered languages.
      if (path.startsWith('/x-rtl')) builder.disableRules(['html-lang-valid']);
      const results = await builder.analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual(
        [],
      );
    });
  }

  test('the keyboard reaches the content in one step and focus is visible', async ({ page }) => {
    await page.goto('/en/scores');
    await page.keyboard.press('Tab');
    const skip = page.getByTestId('skip-link');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');

    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
    // The next Tab lands inside the content, not back in the navigation.
    await page.keyboard.press('Tab');
    const inContent = await page.evaluate(
      () => document.activeElement?.closest('#content') !== null,
    );
    expect(inContent).toBe(true);
  });

  test('live pages carry a polite live region for score announcements', async ({ page }) => {
    await page.goto('/en/scores');
    // Without an API (CI's E2E job) the page shows its honest alert and no
    // live list; the region belongs to the list, so there is nothing to
    // check here. With the API up (locally) the region must be there.
    if ((await page.getByTestId('live-state').count()) === 0) {
      await expect(page.getByTestId('scores-unreachable')).toBeVisible();
      test.skip(true, 'the live list needs the API');
    }
    const region = page.getByTestId('live-announcements');
    await expect(region).toHaveAttribute('aria-live', 'polite');
    await expect(region).toHaveAttribute('aria-atomic', 'true');
  });
});
