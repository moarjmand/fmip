import { expect, test } from '@playwright/test';

/**
 * The club page in the Stadiomind Club board (T-1499, T-1529, D-267), with
 * the seed behind it, in English, Persian and the RTL pseudo-locale, on a
 * 390px phone and a 1440px desktop.
 *
 * The seed holds no club colour, so the band is the theme's surface; the
 * coloured band and its contrast are `entity-band.spec.tsx`'s. Every card is
 * there or says why not, each with its coverage where the API declares one
 * (rule 3), the two columns mirror on an RTL page, and nothing scrolls
 * sideways.
 */

const MAN_UTD = '00000000-0000-4000-8000-000000000601';
const COVERAGE = /^(available|limited|not_supplied|delayed)$/;
const PERSIAN_DIGIT = /[۰-۹]/;

const LOCALES = [
  { locale: 'en', dir: 'ltr' },
  { locale: 'fa', dir: 'rtl' },
  { locale: 'x-rtl', dir: 'rtl' },
] as const;

for (const width of [390, 1440]) {
  test.describe(`the club page at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { locale, dir } of LOCALES) {
      test(`/${locale} opens on the Overview, every card there or said`, async ({ page }) => {
        await page.goto(`/${locale}/team/${MAN_UTD}`);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);

        const band = page.getByTestId('team-header');
        await expect(band.getByTestId('title')).toBeVisible();
        // No colour in the seed: the surface band, never a painted one.
        await expect(band.locator('[data-band]')).toHaveAttribute('data-band', 'surface');
        await expect(page.getByTestId('team-tab-overview')).toHaveAttribute('aria-current', 'page');

        // The next match, or the sentence in its place.
        await expect(
          page.getByTestId('next-match').or(page.getByTestId('next-match-none')),
        ).toBeVisible();
        for (const card of ['recent-results', 'record', 'coming-up', 'top-scorer', 'squad']) {
          await expect(page.getByTestId(card)).toBeVisible();
        }
        await expect(page.getByTestId('top-scorer')).toHaveAttribute('data-coverage', COVERAGE);
        await expect(
          page.getByTestId('squad').locator('[data-coverage-badge]').first(),
        ).toHaveAttribute('data-coverage-badge', COVERAGE);
        await expect(page.getByTestId('competitions')).toBeAttached();

        // Persian digits on /fa wherever the band gives a figure.
        if (locale === 'fa' && (await page.getByTestId('band-standing').count()) > 0) {
          await expect(page.getByTestId('band-standing')).toContainText(PERSIAN_DIGIT);
        }

        // The phone's record is tiles, the desktop's a table.
        if ((await page.getByTestId('record-empty').count()) === 0) {
          const tiles = page.getByTestId('record-tiles');
          const table = page.getByTestId('record').locator('table');
          if (width < 768) {
            await expect(tiles).toBeVisible();
            await expect(table).toBeHidden();
          } else {
            await expect(tiles).toBeHidden();
            await expect(table).toBeVisible();
          }
        }

        // The side column sits at the main one's inline end on a desktop, under it on a phone.
        const main = await page.getByTestId('recent-results').boundingBox();
        const side = await page.getByTestId('coming-up').boundingBox();
        expect(main).not.toBeNull();
        expect(side).not.toBeNull();
        if (width >= 1024) {
          if (dir === 'ltr') expect(side!.x).toBeGreaterThan(main!.x);
          else expect(side!.x).toBeLessThan(main!.x);
        } else {
          expect(Math.abs(side!.x - main!.x)).toBeLessThan(2);
        }

        // Nothing scrolls sideways.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe('the club page’s tabs on a 360px phone (T-1564)', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  for (const locale of ['en', 'fa'] as const) {
    test(`/${locale} opens the tab row scrolled to the open tab, the last one too`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/team/${MAN_UTD}?tab=stats`);
      const stats = page.getByTestId('team-tab-stats');
      await expect(stats).toHaveAttribute('aria-current', 'page');
      await expect(stats).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  }
});
