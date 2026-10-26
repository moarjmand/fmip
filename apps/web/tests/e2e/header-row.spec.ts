import { type Page, expect, test } from '@playwright/test';

/**
 * The desktop header is one row at every width, whatever the face (T-1534).
 *
 * On PageSpeed's cold desktop load (1350px) the header was drawn on one row
 * in the fallback face, then Sign in dropped to a second row once Archivo
 * arrived: the header grew and the whole page moved (CLS 0.80, docs/08,
 * "PageSpeed after the redesign"). Production's header also carries the
 * language picker (the globe, D-281), which this build without an API does
 * not draw (no holds can be read, so no second language is offered), so it
 * is put in the bar here exactly as `LanguagePicker` draws it; the journeys
 * project checks the real one (`journeys/header-row.spec.ts`). At 1024px
 * the row also carries six sections (D-281), the tightest it is.
 *
 * Each width is checked twice: with the web fonts refused, the face a cold
 * load paints first, and with them loaded. The row and its height must be
 * the same both ways.
 */

const WIDTHS = [1024, 1280, 1350];

/**
 * The language picker as `LanguagePicker` draws it in the bar (T-1610,
 * D-281: the globe and the page's language in short, a disclosure), placed
 * where the header puts it.
 */
async function drawLanguagePicker(page: Page, locale: 'en' | 'fa'): Promise<void> {
  if ((await page.getByTestId('language-picker').count()) > 0) return;
  const here =
    locale === 'en'
      ? { locale, short: 'EN', name: 'English', word: 'Language' }
      : { locale, short: 'فا', name: 'فارسی', word: 'زبان' };
  await page
    .getByTestId('theme-switch-compact')
    .evaluate((switcher, { locale, short, name, word }) => {
      const holder = switcher.parentElement!;
      const entry = (code: string, autonym: string) =>
        `<li><a href="/${code}/scores" lang="${code}" hreflang="${code}" class="lang-entry" data-testid="language-${code}">${autonym}</a></li>`;
      holder.insertAdjacentHTML(
        'beforebegin',
        `<details class="relative" data-testid="language-picker"><summary class="lang-toggle cursor-pointer list-none" data-testid="language-toggle"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" class="shrink-0"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18"></path></svg><span class="lg:sr-only">${word}</span><span aria-hidden="true" lang="${locale}">${short}</span><span class="sr-only" lang="${locale}">${name}</span><span aria-hidden="true" class="lg:max-xl:hidden">▾</span></summary><ul class="lang-panel">${entry('en', 'English')}${entry('fa', 'فارسی')}</ul></details>`,
      );
    }, here);
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
        'nav-highlights',
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
        test(`the header is one row with the language picker, in ${face}`, async ({ page }) => {
          if (face === 'the fallback face') {
            await page.route(/\.woff2(\?.*)?$/, (route) => route.abort());
          }
          await page.goto(`/${locale}/scores`);
          await page.evaluate(() => document.fonts.ready);
          await drawLanguagePicker(page, locale);
          await expect(page.getByTestId('language-picker')).toBeVisible();

          const { height, centres } = await row(page);
          // The language picker, the way in and search (a field from 1280px,
          // a link below) are all in the bar.
          expect(Object.keys(centres)).toEqual(
            expect.arrayContaining([
              'nav-home',
              'nav-matches',
              'nav-highlights',
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
