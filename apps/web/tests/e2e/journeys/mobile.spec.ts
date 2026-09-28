import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Scores and the match centre on a phone, with real matches (T-605): the
 * seed's played day and its two matches behind the web app, at 360 x 800, in
 * light and dark, at the default text size and the largest (T-621), left to
 * right and right to left. The page never scrolls sideways, axe finds
 * nothing, a match row is one thumb-sized line whose details open in place,
 * and the match centre's section nav reaches each section by anchor.
 *
 * `../mobile.spec.ts` checks the same pages without an API.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PLAYED_DAY = '2025-01-05';
const PLAYED_MATCH = '00000000-0000-4000-8000-000000000901';
const OPEN_MATCH = '00000000-0000-4000-8000-000000000902';
const PATHS = [
  `/en/scores?date=${PLAYED_DAY}`,
  `/en/match/${PLAYED_MATCH}`,
  `/en/match/${OPEN_MATCH}`,
  `/x-rtl/scores?date=${PLAYED_DAY}`,
  `/x-rtl/match/${PLAYED_MATCH}`,
];

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.use({ viewport: { width: 360, height: 800 } });

for (const theme of ['light', 'dark'] as const) {
  for (const size of ['default', 'larger'] as const) {
    test.describe(`with data at 360px, ${theme}, text size ${size}`, () => {
      test.beforeEach(async ({ page, baseURL }) => {
        await page.context().addCookies([
          { name: 'fmip_theme', value: theme, url: baseURL ?? '' },
          { name: 'fmip_text_size', value: size, url: baseURL ?? '' },
        ]);
      });

      for (const path of PATHS) {
        test(`${path} does not scroll sideways and passes axe`, async ({ page }) => {
          await page.goto(path);
          // The key players (T-841) are on every match page, so they are measured with the rest.
          if (path.includes('/match/')) await expect(page.getByTestId('key-players')).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
          await expect(
            page.getByTestId('score-card').first().or(page.getByTestId('match-header')),
          ).toBeVisible();
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

test('a match row is one thumb-sized line, and its details open in place', async ({ page }) => {
  await page.goto(`/en/scores?date=${PLAYED_DAY}`);
  const row = page.getByTestId('score-card').first();
  const link = row.getByTestId('match-link');
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // One line: status, the two names and the score share a baseline.
  const top = async (id: string) => (await row.getByTestId(id).boundingBox())?.y ?? -1;
  const status = await top('score-status');
  expect(Math.abs((await top('home-team')) - status)).toBeLessThan(12);
  expect(Math.abs((await top('away-team')) - status)).toBeLessThan(12);

  // The labels for what the page does not hold are there, one press away.
  await expect(row.getByTestId('card-labels')).toBeHidden();
  const toggle = row.locator('summary');
  expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await toggle.click();
  await expect(row.getByTestId('card-labels')).toBeVisible();
  await expect(row.getByTestId('card-labels')).toContainText('Forecast: not on this page yet');
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // Each competition says once when its matches last changed.
  await expect(
    page.getByTestId('competition-group').first().getByTestId('block-updated'),
  ).toContainText('Updated');
});

test('the match centre reaches each section through its nav, without script', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 800 },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(`/en/match/${PLAYED_MATCH}`);
  const nav = page.getByTestId('section-nav');
  await expect(nav).toBeVisible();
  for (const name of ['Timeline', 'Stats', 'Line-ups', 'Model forecast', 'Community', 'Watch']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // The key players (T-841), their own section beside the line-ups.
  await expect(nav.getByRole('link', { name: 'Key players', exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Line-ups', exact: true }).click();
  await expect(page).toHaveURL(/#lineups$/);
  await expect(page.getByTestId('lineups')).toBeInViewport();
  // The model, the founder and the community stay three sections (rule 6).
  for (const id of ['forecast', 'analysis', 'community']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await context.close();
});
