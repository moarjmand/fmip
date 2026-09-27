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
  const targets = [
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
