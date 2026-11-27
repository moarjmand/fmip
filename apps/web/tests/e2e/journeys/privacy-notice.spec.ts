import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The privacy notice as a reader meets it (T-1969, D-465), on a deployment
 * that names its controller: CI's journeys job sets `PRIVACY_CONTROLLER_NAME`
 * and `SITE_CONTACT_EMAIL` to test values (`.github/workflows/ci.yml`). A
 * journey because that job is where those variables are; the sign-up form
 * also needs the API for its countries. Where the server names nobody is
 * `../privacy.spec.ts`'s.
 *
 * At 375 px, in Persian, in the right-to-left pseudo-locale and in English:
 * the whole notice, its cards and the contact mailbox, with no sideways
 * scroll; never indexed; linked from the footer and from the sign-up form.
 */

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

const MAILBOX = process.env.SITE_CONTACT_EMAIL ?? '';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.use({ viewport: { width: 375, height: 812 } });

// In CI the job names one, so a missing value fails there rather than
// skipping; a local run of the journeys without them skips.
test.beforeAll(() => {
  test.skip(
    !process.env.CI && (MAILBOX === '' || (process.env.PRIVACY_CONTROLLER_NAME ?? '') === ''),
    'the web server names no privacy controller here',
  );
});

for (const [locale, dir, heading] of [
  ['fa', 'rtl', 'ما چه کسی هستیم'],
  ['x-rtl', 'rtl', 'Who we are'],
  ['en', 'ltr', 'Who we are'],
] as const) {
  test(`/${locale}/privacy shows the notice at 375 px without sideways scroll`, async ({
    page,
  }) => {
    const response = await page.goto(`/${locale}/privacy`);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByTestId('privacy-preparing')).toHaveCount(0);
    await expect(page.locator('#who-we-are-heading')).toContainText(heading);
    await expect(page.getByTestId('privacy-contact').getByRole('link')).toHaveAttribute(
      'href',
      `mailto:${MAILBOX}`,
    );
    // The widest things on the page: the cookie cards, and the index opened.
    await page.getByTestId('privacy-index').locator('summary').click();
    await expect(page.getByTestId('privacy-rows-cookies').locator('li')).toHaveCount(8);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

    // The footer leads here, in this language.
    await expect(page.getByTestId('footer-privacy')).toHaveAttribute('href', `/${locale}/privacy`);
    // The pseudo-locale's own `lang="x-rtl"` is not a language axe accepts:
    // the written languages are the ones checked.
    if (locale !== 'x-rtl') {
      const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    }
  });
}

test('the sign-up form leads to the notice beside what the address is for', async ({ page }) => {
  await page.goto('/fa/register');
  await expect(page.getByTestId('register-privacy-link')).toHaveAttribute('href', '/fa/privacy');
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  await page.goto('/en/register');
  await expect(page.getByTestId('register-privacy')).toHaveText(
    'What we keep about you, and why, is in the privacy notice.',
  );
});
