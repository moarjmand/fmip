import { type Page, expect, test } from '@playwright/test';

/**
 * The Stadiomind player page (T-1500, D-271) on the seed, in English, Persian
 * and the right-to-left pseudo-locale, on a 390px phone and a 1440px desktop:
 * the header with the photo's ring, the three facts with their figures in the
 * reader's digits, the season and the career saying their coverage (the seed
 * holds no line-ups, so both say "not supplied" rather than drawing noughts),
 * the last matches, the next match, and never a sideways scroll of the page.
 *
 * The career table's own scrolling box on a phone is asserted on its markup
 * in `components/player-page.spec.tsx`: the seed has no line-ups to fill it.
 */

const SALAH = '00000000-0000-4000-8000-000000000701';

const LOCALES = [
  { locale: 'en', dir: 'ltr', height: '175 cm', age: /^\d+$/ },
  { locale: 'fa', dir: 'rtl', height: '۱۷۵ سانتی‌متر', age: /^[۰-۹]+$/ },
  { locale: 'x-rtl', dir: 'rtl', height: '175 cm', age: /^\d+$/ },
] as const;

/** Whether the page itself can scroll sideways: it must not, at any width. */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const width of [390, 1440]) {
  test.describe(`the player page at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { locale, dir, height, age } of LOCALES) {
      test(`/${locale}: header, facts, coverage, last matches and next match`, async ({ page }) => {
        await page.goto(`/${locale}/player/${SALAH}`);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await expect(page.getByTestId('title')).toBeVisible();
        await expect(page.getByTestId('current-team')).toContainText('Liverpool');
        await expect(page.getByTestId('photo-ring')).toBeVisible();

        // The three facts the seed holds, each a figure, none a badge.
        for (const fact of ['age', 'height', 'foot']) {
          await expect(page.getByTestId(`fact-${fact}`)).toHaveAttribute(
            'data-coverage',
            'available',
          );
        }
        await expect(page.getByTestId('fact-height').locator('dd')).toHaveText(height);
        const ageText = await page.getByTestId('fact-age').locator('dd > span').first().innerText();
        expect(ageText.trim()).toMatch(age);
        await expect(page.getByTestId('facts').locator('[data-coverage-badge]')).toHaveCount(0);

        // No line-ups in the seed: the season says so, once; the Overview
        // draws no second, empty career table (T-1569).
        await expect(page.getByTestId('player-season-empty')).toBeVisible();
        await expect(
          page.getByTestId('player-season').locator('[data-coverage-badge="not_supplied"]'),
        ).toBeVisible();
        await expect(page.getByTestId('career-record')).toHaveCount(0);

        await expect(page.getByTestId('recent-matches')).toBeVisible();
        await expect(page.getByTestId('player-availability')).toBeVisible();
        await expect(page.getByTestId('player-updated')).toBeVisible();

        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      });
    }

    test('the side column sits beside the main one on a desktop and under it on a phone', async ({
      page,
    }) => {
      await page.goto(`/en/player/${SALAH}`);
      // The season's block heads the main column whatever the seed holds.
      const main = await page.getByTestId('player-season').boundingBox();
      const side = await page.getByTestId('recent-matches').boundingBox();
      if (main === null || side === null) throw new Error('a column has no box');
      if (width >= 1024) {
        expect(side.y).toBeLessThan(main.y + main.height);
        expect(side.x).toBeGreaterThan(main.x + main.width - 1);
      } else {
        expect(side.y).toBeGreaterThanOrEqual(main.y + main.height);
      }
    });
  });
}

test('/fa mirrors the header: the facts sit at the inline end on a desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/fa/player/${SALAH}`);
  const photo = await page.getByTestId('photo-ring').boundingBox();
  const facts = await page.getByTestId('facts').boundingBox();
  if (photo === null || facts === null) throw new Error('the header has no box');
  // Right to left: the photo starts on the right, the facts end on the left.
  expect(facts.x + facts.width).toBeLessThan(photo.x);
});
