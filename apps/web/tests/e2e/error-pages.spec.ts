import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Error pages carry `lang` and `dir` (T-809). A page's own `notFound()` (a
 * malformed competition id, which needs no API) and an unknown path under a
 * locale both render the locale's not-found inside the locale layout, with a
 * 404 status, and pass axe like every other page -- `html-has-lang` included.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const CASES = [
  { path: '/en/competition/not-a-season', lang: 'en', dir: 'ltr' },
  { path: '/en/no-such-page', lang: 'en', dir: 'ltr' },
  { path: '/en/no/such/page', lang: 'en', dir: 'ltr' },
  { path: '/ar/no-such-page', lang: 'ar', dir: 'rtl' },
  { path: '/x-rtl/no-such-page', lang: 'x-rtl', dir: 'rtl' },
];

test.describe('error pages', () => {
  for (const { path, lang, dir } of CASES) {
    test(`${path} is a 404 in its locale's document and passes axe`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);

      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await expect(page.getByTestId('error-not-found')).toBeVisible();
      await expect(page.getByTestId('error-scores')).toHaveAttribute('href', `/${lang}/scores`);

      const builder = new AxeBuilder({ page }).withTags(TAGS);
      // `x-rtl` is a private-use tag axe does not know (D-003), as in a11y.spec.ts.
      if (lang === 'x-rtl') builder.disableRules(['html-lang-valid']);
      const results = await builder.analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual(
        [],
      );
    });
  }
});
