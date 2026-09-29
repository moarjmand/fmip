import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { type Member, member, registerAndVerify } from './members';

/**
 * The member's homepage (T-942, D-115), with the API and the seed behind it.
 *
 * A guest sees none of the member sections and is not told they are empty; a
 * new member with no friends and no groups is told once per section that there
 * is nothing, in both directions of text, with no accessibility violation.
 * What a friend's call may show under each visibility setting is proved at the
 * API (`friend-predictions.http.spec.ts`), where the rule lives.
 *
 * Runs only in the `journeys` project (E2E_API_URL set).
 */
const RUN = Date.now().toString(36).slice(-6);
const A: Member = member(RUN, 'h', 'Homa Tester');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MEMBER_SECTIONS = ['home-friend-predictions', 'home-group-discussions'];

test.describe.configure({ mode: 'serial' });

test.describe("the member's homepage", () => {
  test('a guest sees no member section, and is not told one is empty', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByTestId('title')).toHaveText('FMIP');
    for (const id of MEMBER_SECTIONS) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByTestId('home-viewing-ask')).toHaveCount(0);
  });

  test('a member with no friends and no groups is told so once per section', async ({ page }) => {
    await registerAndVerify(page, A);
    for (const path of ['/en', '/x-rtl']) {
      await page.goto(path);
      await expect(page.getByTestId('home-friend-predictions-empty')).toHaveCount(1);
      await expect(page.getByTestId('home-group-discussions-empty')).toHaveCount(1);
      // The pseudo-locale's `lang` is not a real language tag, so axe is run
      // on the real one; the pseudo-locale proves the direction.
      if (path === '/en') {
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(results.violations.map((v) => v.id)).toEqual([]);
      }
    }
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
