import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Scores and the match centre on a phone (T-605): at 360 x 800, in light and
 * dark, at the default text size and the largest (T-621), in both writing
 * directions, the page itself never scrolls sideways (a wide table may, in
 * its own box) and axe finds nothing. CI's E2E job runs without an API, so
 * these are the pages' honest unreachable states; `journeys/mobile.spec.ts`
 * runs the same checks with a day of real matches behind them.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const MATCH = '00000000-0000-4000-8000-000000000901';
const PATHS = ['/en/scores', `/en/match/${MATCH}`, '/x-rtl/scores', `/x-rtl/match/${MATCH}`];

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.use({ viewport: { width: 360, height: 800 } });

for (const theme of ['light', 'dark'] as const) {
  for (const size of ['default', 'larger'] as const) {
    test.describe(`at 360px, ${theme}, text size ${size}`, () => {
      test.beforeEach(async ({ page, baseURL }) => {
        await page.context().addCookies([
          { name: 'fmip_theme', value: theme, url: baseURL ?? '' },
          { name: 'fmip_text_size', value: size, url: baseURL ?? '' },
        ]);
      });

      for (const path of PATHS) {
        test(`${path} does not scroll sideways and passes axe`, async ({ page }) => {
          await page.goto(path);
          await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
          expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

          const builder = new AxeBuilder({ page }).withTags(TAGS);
          if (path.startsWith('/x-rtl')) builder.disableRules(['html-lang-valid']);
          const results = await builder.analyze();
          expect(
            results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
          ).toEqual([]);
        });
      }
    });
  }
}

test('the scores controls are thumb-sized and the day strip scrolls inside itself', async ({
  page,
}) => {
  await page.goto('/en/scores');
  // The picker folds behind "Choose a date" on a phone (T-1482); the control itself is a target.
  const fold = page.getByTestId('date-fold').locator('summary');
  await fold.click();
  const targets = [
    fold,
    ...(await page.getByTestId('day-strip').getByRole('link').all()),
    page.getByTestId('previous-day'),
    page.getByTestId('next-day'),
    page.getByRole('button', { name: 'Show day' }),
    ...(await page.getByTestId('filters').getByRole('link').all()),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  // The steps still say where they go, to a screen reader, when the words are hidden.
  await expect(page.getByTestId('previous-day')).toHaveAccessibleName('Previous day');
  const strip = await page
    .getByTestId('day-strip')
    .evaluate((el) => getComputedStyle(el).overflowX);
  expect(strip).toBe('auto');
});

test('the header is one row on a phone: the wordmark, search and the Menu, with the tab bar below', async ({
  page,
}) => {
  await page.goto('/en/scores');
  const header = page.locator('header').first();
  // The wordmark, search and the Menu (D-263, D-267): one row of 44px targets.
  expect((await header.boundingBox())?.height ?? 0).toBeLessThan(68);
  await expect(page.getByTestId('nav-search')).toBeVisible();
  await expect(page.getByTestId('nav-search-form')).toBeHidden();
  await expect(page.getByTestId('nav-matches')).toBeHidden();
  await expect(page.getByTestId('nav-sign-in')).toBeHidden();
  // The wordmark at the inline start, search and the Menu at the end.
  const x = async (id: string) => (await page.getByTestId(id).boundingBox())?.x ?? -1;
  expect(await x('nav-home')).toBeLessThan(await x('nav-search'));
  expect(await x('nav-search')).toBeLessThan(await x('nav-menu'));

  // The five sections are in the bottom tab bar, fixed, each at least 56px.
  const bar = page.getByTestId('tab-bar');
  await expect(bar).toBeVisible();
  for (const id of ['tab-matches', 'tab-predict', 'tab-leagues', 'tab-news', 'tab-you']) {
    expect((await page.getByTestId(id).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(56);
  }
  await expect(page.getByTestId('tab-matches')).toHaveAttribute('aria-current', 'page');
  const box = await bar.boundingBox();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(800, 0);

  const menu = page.getByTestId('nav-menu');
  await menu.locator(':scope > summary').click();
  // The nav and More's links are listed together, then the reader's controls.
  for (const id of ['nav-matches', 'nav-model', 'nav-watch', 'nav-settings-guest', 'nav-sign-in']) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('nav-more').locator('summary')).toBeHidden();
  await expect(menu.getByRole('button', { name: 'Night' })).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);

  // The Menu closes when the reader moves on.
  await page.getByTestId('nav-model').click();
  await expect(page).toHaveURL(/\/en\/model-accuracy$/);
  await expect(page.getByTestId('nav-matches')).toBeHidden();
});

test('on a tablet the header keeps its Menu, since the nav does not fit one row (T-1390)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.goto('/fa/scores');
  await expect(page.getByTestId('nav-menu').locator(':scope > summary')).toBeVisible();
  await expect(page.getByTestId('tab-bar')).toBeHidden();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  const bar = await page.locator('header').first().boundingBox();
  expect(bar?.height ?? 999).toBeLessThan(100);
});

for (const width of [1280, 1440]) {
  test(`at ${width}px the header is one row, with no Menu and no tab bar`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/en/scores');
    await expect(page.getByTestId('nav-menu').locator(':scope > summary')).toBeHidden();
    await expect(page.getByTestId('tab-bar')).toBeHidden();
    await expect(page.getByTestId('nav-search')).toBeHidden();
    for (const id of ['nav-matches', 'nav-model', 'nav-more', 'nav-search-form', 'nav-sign-in']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // One row (D-267): the wordmark, the nav in its order, More, then search,
    // the theme and the way in.
    const seq = [
      'nav-home',
      'nav-matches',
      'nav-predictions',
      'nav-competitions',
      'nav-model',
      'nav-news',
      'nav-more',
      'nav-search-form',
      'theme-switch-compact',
      'nav-sign-in',
    ];
    const boxes = await Promise.all(seq.map((id) => page.getByTestId(id).boundingBox()));
    const xs = boxes.map((b) => b?.x ?? -1);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const tops = boxes.map((b) => Math.round((b?.y ?? 0) + (b?.height ?? 0) / 2));
    for (const top of tops) expect(Math.abs(top - tops[0]!)).toBeLessThanOrEqual(2);
    await expect(page.getByTestId('nav-matches')).toHaveAttribute('aria-current', 'page');
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });
}

test('at 1024px the header is still one row: the mark, the nav, then search as a link (T-1534)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto('/en/scores');
  const box = async (id: string) => (await page.getByTestId(id).boundingBox())!;
  const home = await box('nav-home');
  const matches = await box('nav-matches');
  const more = await box('nav-more');
  const search = await box('nav-search');
  const signIn = await box('nav-sign-in');
  for (const b of [matches, more, search, signIn]) {
    expect(Math.abs(b.y + b.height / 2 - (home.y + home.height / 2))).toBeLessThanOrEqual(2);
  }
  expect(home.x).toBeLessThan(matches.x);
  expect(more.x).toBeLessThan(search.x);
  expect(search.x).toBeLessThan(signIn.x);
  await expect(page.getByTestId('nav-search-form')).toBeHidden();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
});
