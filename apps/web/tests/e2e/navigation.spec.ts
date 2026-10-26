import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';

/**
 * The Stadiomind navigation (T-1494, D-267; T-1610, D-281) in a real
 * browser, without an API behind it: every route keeps a working nav on a
 * 390px phone and a 1440px screen, the phone's five tabs lead where they say
 * and are 44px targets, keyboard focus is visible on the tabs and in the
 * header, on /fa and the rtl pseudo-locale the tab bar and the header are
 * mirrored, and the site footer ends every page above the tab bar. (Without
 * an API no second language is offered, so the language picker is checked
 * in the journeys project: `journeys/persian.spec.ts`.)
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MATCH = '00000000-0000-4000-8000-000000000901';

/** Every kind of page the shell wraps, a missing one included. */
const ROUTES = [
  '',
  '/scores',
  `/match/${MATCH}`,
  '/leaderboard',
  '/competitions',
  '/model-accuracy',
  '/news',
  '/watch',
  '/highlights',
  '/search?q=arsenal',
  '/login',
  '/about',
  '/no-such-page',
];

/**
 * Each tab, where it leads, and the tab current there. Predict leads to the
 * matches still to pick (T-1519, D-269), a view of the matches page that is
 * Predict's own (D-281), so Predict is the current tab there.
 */
const TABS = [
  ['tab-matches', /\/scores$/, 'tab-matches'],
  ['tab-predict', /\/scores\?unpicked=1$/, 'tab-predict'],
  ['tab-leagues', /\/competitions$/, 'tab-leagues'],
  ['tab-news', /\/news$/, 'tab-news'],
  ['tab-you', /\/login$/, 'tab-you'],
] as const;

/** The outline a keyboard-focused element draws. */
async function focusRing(locator: Locator): Promise<{ style: string; width: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
}

/** Moves focus onto `locator` by the keyboard, so `:focus-visible` applies as it would for a reader. */
async function keyboardFocus(page: Page, locator: Locator): Promise<void> {
  await locator.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(locator).toBeFocused();
}

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ROUTES) {
    test(`/en${route} keeps the header and the five tabs`, async ({ page }) => {
      await page.goto(`/en${route}`);
      await expect(page.getByTestId('nav-home')).toBeVisible();
      await expect(page.getByTestId('nav-search')).toBeVisible();
      await expect(page.getByTestId('nav-menu').locator(':scope > summary')).toBeVisible();
      await expect(page.getByTestId('tab-bar').getByRole('link')).toHaveCount(5);
      await expect(page.getByTestId('tab-bar')).toBeInViewport();
    });
  }

  test('clicks through all five tabs, each marked current where it leads', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByTestId('tab-matches')).toHaveAttribute('aria-current', 'page');
    for (const [id, url, current] of TABS) {
      await page.getByTestId(id).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId(current)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-testid="tab-bar"] [aria-current="page"]')).toHaveCount(1);
    }
  });

  test('gives every tab a target of at least 44px each way, and shows keyboard focus', async ({
    page,
  }) => {
    await page.goto('/en/scores');
    for (const [id] of TABS) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect(box.height, id).toBeGreaterThanOrEqual(44);
      expect(box.width, id).toBeGreaterThanOrEqual(44);
    }
    const news = page.getByTestId('tab-news');
    await keyboardFocus(page, news);
    expect(await focusRing(news)).toEqual({ style: 'solid', width: '2px' });
    // Drawn inside the tab, so the edge of the screen cannot cut it.
    expect(await news.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe('-2px');

    const search = page.getByTestId('nav-search');
    await keyboardFocus(page, search);
    expect(await focusRing(search)).toEqual({ style: 'solid', width: '2px' });
  });

  test('says the tabs in Persian on /fa, mirrored: Matches at the right', async ({ page }) => {
    await page.goto('/fa/scores');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const bar = page.getByTestId('tab-bar');
    for (const word of ['بازی‌ها', 'پیش‌بینی', 'لیگ‌ها', 'اخبار', 'شما']) {
      await expect(bar).toContainText(word);
    }
    const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x;
    expect(await x('tab-matches')).toBeGreaterThan(await x('tab-predict'));
    expect(await x('tab-news')).toBeGreaterThan(await x('tab-you'));
    // The wordmark at the inline start (the right), search and the Menu at the left.
    expect(await x('nav-home')).toBeGreaterThan(await x('nav-search'));
    expect(await x('nav-search')).toBeGreaterThan(await x('nav-menu'));
    await page.getByTestId('tab-leagues').click();
    await expect(page).toHaveURL(/\/fa\/competitions$/);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('mirrors the tab bar under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/x-rtl/scores');
    const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x;
    expect(await x('tab-matches')).toBeGreaterThan(await x('tab-you'));
  });

  test('ends the page with the site footer, above the tab bar and never under it (D-281)', async ({
    page,
  }) => {
    for (const locale of ['en', 'fa']) {
      await page.goto(`/${locale}/scores`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const box = (await page.getByTestId('footer-copyright').boundingBox())!;
      const bar = (await page.getByTestId('tab-bar').boundingBox())!;
      expect(box.y + box.height, locale).toBeLessThanOrEqual(bar.y + 1);
      // Each of its links is a 44px target on a phone.
      for (const id of ['footer-matches', 'footer-league', 'footer-rules']) {
        expect((await page.getByTestId(id).boundingBox())!.height, id).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    }
    await expect(page.getByTestId('footer-football')).toContainText('فوتبال');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

test.describe('on a 1440px screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const route of ROUTES) {
    test(`/en${route} keeps the header nav`, async ({ page }) => {
      await page.goto(`/en${route}`);
      for (const id of [
        'nav-home',
        'nav-matches',
        'nav-competitions',
        'nav-predictions',
        'nav-model',
        'nav-news',
        'nav-highlights',
        'nav-more',
        'nav-search-form',
        'nav-sign-in',
      ]) {
        await expect(page.getByTestId(id), id).toBeVisible();
      }
      await expect(page.getByTestId('tab-bar')).toBeHidden();
      await expect(page.getByTestId('site-footer')).toBeAttached();
    });
  }

  test('the header nav leads to its six places, each current where it leads, and More to its two', async ({
    page,
  }) => {
    await page.goto('/en');
    // Predictions is the prediction league (D-281), no longer a second way
    // to the matches page.
    for (const [id, url] of [
      ['nav-matches', /\/en\/scores$/],
      ['nav-competitions', /\/en\/competitions$/],
      ['nav-predictions', /\/en\/leaderboard$/],
      ['nav-model', /\/en\/model-accuracy$/],
      ['nav-news', /\/en\/news$/],
      ['nav-highlights', /\/en\/highlights$/],
    ] as const) {
      await page.getByTestId(id).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByTestId(id)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[data-testid="primary-nav"] [aria-current="page"]')).toHaveCount(
        1,
      );
    }
    // The picks to make are Predictions' view of the matches page.
    await page.goto('/en/scores?unpicked=1');
    await expect(page.getByTestId('nav-predictions')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('nav-matches')).not.toHaveAttribute('aria-current', 'page');
    const more = page.getByTestId('nav-more');
    await more.locator('summary').click();
    await expect(more.getByRole('link')).toHaveCount(2);
    await expect(page.getByTestId('nav-analysis')).toHaveText('Founder’s analysis');
    await page.getByTestId('nav-watch').click();
    await expect(page).toHaveURL(/\/en\/watch$/);
    await expect(page.getByTestId('nav-watch')).toHaveAttribute('aria-current', 'page');
    // More closes on the way, and nothing in the six is current.
    await expect(page.getByTestId('nav-watch')).toBeHidden();
    await expect(page.locator('[data-testid="primary-nav"] [aria-current="page"]')).toHaveCount(1);
  });

  test('the prediction league leads to the picks to make (D-281)', async ({ page }) => {
    await page.goto('/en/leaderboard');
    const cta = page.getByTestId('leaderboard-picks-cta');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveText('Make your picks');
    await cta.click();
    await expect(page).toHaveURL(/\/en\/scores\?unpicked=1$/);
    await expect(page.getByTestId('nav-predictions')).toHaveAttribute('aria-current', 'page');
  });

  test('the footer leads to what Stadiomind is, its rules and every section (D-281)', async ({
    page,
  }) => {
    for (const [id, url] of [
      ['footer-about', /\/en\/about$/],
      ['footer-rules', /\/en\/rules$/],
      ['footer-league', /\/en\/leaderboard$/],
      ['footer-highlights', /\/en\/highlights$/],
    ] as const) {
      await page.goto('/en/scores');
      await page.getByTestId(id).click();
      await expect(page).toHaveURL(url);
    }
    const footer = page.getByTestId('site-footer');
    await expect(footer.getByRole('link')).toHaveCount(11);
    await expect(footer).toContainText('© 2');
  });

  test('searches from the field in the bar', async ({ page }) => {
    await page.goto('/en/scores');
    const field = page.getByTestId('nav-search-input');
    await expect(field).toHaveAttribute('placeholder', 'Teams, players, competitions');
    await field.fill('arsenal');
    await field.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=arsenal$/);
  });

  test('shows keyboard focus on the nav, More, the search field and Sign in', async ({ page }) => {
    await page.goto('/en/scores');
    for (const id of ['nav-predictions', 'nav-sign-in']) {
      const link = page.getByTestId(id);
      await keyboardFocus(page, link);
      expect(await focusRing(link), id).toEqual({ style: 'solid', width: '2px' });
    }
    const summary = page.getByTestId('nav-more').locator('summary');
    await keyboardFocus(page, summary);
    expect(await focusRing(summary)).toEqual({ style: 'solid', width: '2px' });
    // The field rings its whole box, not the bare input inside it.
    await keyboardFocus(page, page.getByTestId('nav-search-input'));
    const label = page.getByTestId('nav-search-form').locator('label');
    expect(await focusRing(label)).toEqual({ style: 'solid', width: '2px' });
  });

  test('is mirrored on /fa: the wordmark at the right, Sign in at the left', async ({ page }) => {
    await page.goto('/fa/scores');
    const x = async (id: string) => (await page.getByTestId(id).boundingBox())!.x;
    expect(await x('nav-home')).toBeGreaterThan(await x('nav-matches'));
    expect(await x('nav-matches')).toBeGreaterThan(await x('nav-news'));
    expect(await x('nav-news')).toBeGreaterThan(await x('nav-sign-in'));
    await expect(page.getByTestId('nav-matches')).toHaveText('بازی‌ها');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
