import { type Page, expect, test } from '@playwright/test';

/**
 * The desktop header is one row at every width, whatever the face (T-1534).
 *
 * On PageSpeed's cold desktop load (1350px) the header was drawn on one row
 * in the fallback face, then Sign in dropped to a second row once Archivo
 * arrived: the header grew and the whole page moved (CLS 0.80, docs/08,
 * "PageSpeed after the redesign"). Production's header also carries the other
 * language's link, which this build without an API does not draw (no holds
 * can be read, so no second language is offered), so the link is put in the
 * bar here exactly as `LanguagePicker` draws it; the journeys project checks
 * the real one (`journeys/header-row.spec.ts`).
 *
 * Each width is checked twice: with the web fonts refused, the face a cold
 * load paints first, and with them loaded. The row and its height must be
 * the same both ways.
 */

const WIDTHS = [1024, 1280, 1350];

/** The other language as `LanguagePicker` draws it in the bar, placed where the header puts it. */
async function drawLanguageLink(page: Page, locale: 'en' | 'fa'): Promise<void> {
  if ((await page.getByTestId('language-picker').count()) > 0) return;
  const other =
    locale === 'en' ? { locale: 'fa', name: 'فارسی' } : { locale: 'en', name: 'English' };
  await page.getByTestId('theme-switch-compact').evaluate((switcher, { locale, name }) => {
    const holder = switcher.parentElement!;
    holder.insertAdjacentHTML(
      'beforebegin',
      `<nav aria-label="Language" data-testid="language-picker"><ul class="flex flex-wrap gap-x-3"><li><a href="/${locale}/scores" lang="${locale}" hreflang="${locale}" class="flex min-h-touch items-center px-3 font-semibold md:px-2.5 text-muted hover:text-accent" data-testid="language-${locale}">${name}</a></li></ul></nav>`,
    );
  }, other);
}

/** The bar's height and the vertical centre of every control in it. */
async function row(page: Page): Promise<{ height: number; centres: Record<string, number> }> {
  return page
    .locator('header nav')
    .first()
    .evaluate((bar) => {
      const ids = [
        'nav-home',
        'nav-matches',
        'nav-more',
        'nav-search',
        'nav-search-form',
        'language-picker',
        'theme-switch-compact',
        'nav-settings-guest',
        'nav-sign-in',
      ];
      const centres: Record<string, number> = {};
      for (const id of ids) {
        const box = bar.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        if (box !== undefined && box.width > 0) centres[id] = Math.round(box.top + box.height / 2);
      }
      return { height: bar.getBoundingClientRect().height, centres };
    });
}

for (const width of WIDTHS) {
  for (const locale of ['en', 'fa'] as const) {
    test.describe(`at ${width}px on /${locale}`, () => {
      test.use({ viewport: { width, height: 900 } });

      for (const face of ['the fallback face', 'Archivo'] as const) {
        test(`the header is one row with the language link, in ${face}`, async ({ page }) => {
          if (face === 'the fallback face') {
            await page.route(/\.woff2(\?.*)?$/, (route) => route.abort());
          }
          await page.goto(`/${locale}/scores`);
          await page.evaluate(() => document.fonts.ready);
          await drawLanguageLink(page, locale);
          await expect(page.getByTestId('language-picker')).toBeVisible();

          const { height, centres } = await row(page);
          // The language link, the way in and search (a field from 1280px,
          // a link below) are all in the bar.
          expect(Object.keys(centres)).toEqual(
            expect.arrayContaining([
              'nav-home',
              'nav-matches',
              'nav-more',
              width >= 1280 ? 'nav-search-form' : 'nav-search',
              'language-picker',
              'theme-switch-compact',
              'nav-sign-in',
            ]),
          );
          const first = centres['nav-home']!;
          for (const [id, centre] of Object.entries(centres)) {
            expect(Math.abs(centre - first), id).toBeLessThanOrEqual(2);
          }
          // A 64px bar, the same in either face, so a face arriving moves nothing.
          expect(height).toBe(64);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          ).toBeLessThanOrEqual(0);
        });
      }
    });
  }
}
