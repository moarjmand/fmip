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
          await expect(page.locator('html')).toHaveAttribute('data-text-size', size);
          await expect(
            page.getByTestId('score-card').first().or(page.getByTestId('match-header')),
          ).toBeVisible();
          if (path.includes('/match/')) {
            // On a phone the match centre is tabs (T-1384): each tab is
            // opened and measured, so nothing hidden behind one escapes the
            // check. The key players (T-841) are in Line-ups, the competition
            // context (T-840) in Summary, on every match page.
            const nav = page.getByTestId('section-nav');
            for (const link of await nav.getByRole('link').all()) {
              await link.click();
              expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
            }
            await nav.locator('[data-tab-link="lineups"]').click();
            await expect(page.getByTestId('key-players')).toBeVisible();
            await nav.locator('[data-tab-link="summary"]').click();
            await expect(page.getByTestId('competition-context')).toBeVisible();
          }
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

test('a match row is one thumb-sized row, and its details open in the preview', async ({
  page,
}) => {
  await page.goto(`/en/scores?date=${PLAYED_DAY}`);
  const row = page.getByTestId('score-card').first();
  const link = row.getByTestId('match-link');
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  // T-1496: the teams are stacked, home above away, each beside its own
  // goals; the status sits between their two lines.
  const middle = async (id: string) => {
    const b = await row.getByTestId(id).boundingBox();
    return b === null ? -1 : b.y + b.height / 2;
  };
  const status = await middle('score-status');
  expect(await middle('home-team')).toBeLessThan(status);
  expect(await middle('away-team')).toBeGreaterThan(status);
  expect(Math.abs((await middle('home-score')) - (await middle('home-team')))).toBeLessThan(6);

  // The labels, the model's and the community's lines are one press away:
  // the row's own Pick (or View) opens the preview above the list on a phone.
  await expect(page.getByTestId('match-preview')).toBeHidden();
  const pick = row.getByTestId('row-pick');
  expect((await pick.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await pick.click();
  await expect(page).toHaveURL(/pick=/);
  const preview = page.getByTestId('match-preview');
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId('card-labels')).toBeVisible();
  // T-940: the model's bar is there too, with its receipt or the reason it has none.
  await expect(preview.getByTestId('forecast-bar')).toBeVisible();
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

  // Each competition says once when its matches last changed.
  await expect(
    page.getByTestId('competition-group').first().getByTestId('block-updated'),
  ).toContainText('Updated');
});

test('the match centre reaches each section through its tabs, without script', async ({
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
  // The phone's tabs (T-1384), plain anchors: no script decides what shows.
  for (const name of ['Summary', 'Line-ups', 'Stats', 'Predictions', 'Watch', 'Discussion']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // Summary first: the key events and the competition (T-840) are on show,
  // the line-ups are behind their tab.
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(page.getByTestId('competition-context')).toBeVisible();
  await expect(page.getByTestId('lineups')).toBeHidden();
  await nav.getByRole('link', { name: 'Line-ups', exact: true }).click();
  await expect(page).toHaveURL(/#lineups$/);
  await expect(page.getByTestId('lineups')).toBeInViewport();
  // The key players (T-841), their own section beside the line-ups.
  await expect(page.getByTestId('key-players')).toBeVisible();
  await expect(page.getByTestId('timeline')).toBeHidden();
  // A deep link opens its own tab: a story's "#forecast" shows the model.
  await page.goto(`/en/match/${PLAYED_MATCH}#forecast`);
  await expect(page.getByTestId('forecast')).toBeVisible();
  // The model, the founder and the community stay three sections (rule 6).
  for (const id of ['forecast', 'analysis', 'community']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await context.close();
});

test('the match centre opens every section side by side from 768px, with no tabs', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/en/match/${PLAYED_MATCH}`);
  await expect(page.getByTestId('section-nav')).toBeHidden();
  for (const id of ['timeline', 'lineups', 'forecast', 'analysis', 'community', 'watch']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  // Three columns at 1280px: the line-ups beside the key events.
  const events = await page.locator('[data-column="events"]').boundingBox();
  const teams = await page.locator('[data-column="teams"]').boundingBox();
  expect(events).not.toBeNull();
  expect(teams).not.toBeNull();
  if (events !== null && teams !== null) expect(teams.x).toBeGreaterThan(events.x);
  await context.close();
});
