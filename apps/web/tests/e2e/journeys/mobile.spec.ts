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

  // A played match's row has no "View" on a phone (T-1757, D-374): the row,
  // at least 72px, is the link. Its preview, the bottom sheet over the list
  // (T-1738), is still the page's at `?pick=`.
  expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(72);
  await expect(row.getByTestId('row-pick')).toBeHidden();
  await expect(page.getByTestId('match-preview')).toBeHidden();
  const id = await row.getAttribute('data-fixture-id');
  await page.goto(`/en/scores?date=${PLAYED_DAY}&pick=${id}`);
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
  // A deep link opens its own tab: a story's "#analysis" shows the founder's
  // analysis on Predictions, a row or a card, and not the Summary's timeline.
  await page.goto(`/en/match/${PLAYED_MATCH}#analysis`);
  await expect(page.getByTestId('founder-analysis')).toBeVisible();
  await expect(page.getByTestId('timeline')).toBeHidden();
  // The founder and the community stay two sections, each once on the page
  // (rule 6; T-1744): the model's forecast is the Summary's card.
  for (const id of ['analysis', 'community']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByTestId('founder-analysis')).toHaveCount(1);
  await expect(page.getByTestId('consensus')).toHaveCount(1);
  await expect(page.getByTestId('forecast-reality')).toHaveCount(1);
  await context.close();
});

test('the match centre opens every section from 768px, a main and a side column, the tabs as jump links', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`/en/match/${PLAYED_MATCH}`);
  // The tabs stay, at the foot of the score band, and jump to their sections (T-1497).
  await expect(page.getByTestId('section-nav')).toBeVisible();
  for (const id of ['timeline', 'lineups', 'analysis', 'community', 'watch']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  // "No forecast" is said once (T-1746, D-367): only when the Summary's card
  // has said the match has no forecast and no Power Index either
  // (`forecast-reality-no-power`) is there no lower section to say it again;
  // otherwise the section is there, with the Power Index at least.
  await expect(page.getByTestId('forecast-reality')).toBeVisible();
  const saidBoth = (await page.getByTestId('forecast-reality-no-power').count()) > 0;
  if (saidBoth) await expect(page.locator('#forecast')).toHaveCount(0);
  else await expect(page.locator('#forecast')).toBeVisible();
  // Two columns at 1280px: the side column (the past meetings, the data
  // footer) beside the main one.
  const main = await page.locator('[data-column="main"]').boundingBox();
  const side = await page.locator('[data-column="side"]').boundingBox();
  expect(main).not.toBeNull();
  expect(side).not.toBeNull();
  if (main !== null && side !== null) expect(side.x).toBeGreaterThan(main.x + main.width - 1);
  await context.close();
});

/**
 * The phone's pick bar (T-1739, D-360): until kick-off a slim bar fixed above
 * the tab bar repeats the call to pick. It never covers the tab bar, the end
 * of the page clears it, and it is one link to the pick card -- which the
 * Predictions tab shows first and the Summary shows under the model's card.
 * No script decides any of it.
 */
for (const locale of ['en', 'x-rtl'] as const) {
  test(`/${locale}: the pick bar stands above the tab bar until kick-off and leads to the card`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(`/${locale}/match/${OPEN_MATCH}`);
    const bar = page.getByTestId('pick-bar');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-pick', 'open');
    const link = (await page.getByTestId('pick-bar-link').boundingBox())!;
    const tabs = (await page.getByTestId('tab-bar').boundingBox())!;
    // Directly above the tab bar: never over it, and no strip of page between.
    expect(link.y + link.height).toBeLessThanOrEqual(tabs.y + 0.5);
    expect(tabs.y - (link.y + link.height)).toBeLessThan(8);
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.height).toBeLessThanOrEqual(61);
    expect(link.width).toBeGreaterThan(340);
    // The tab bar still answers where it stands.
    const hit = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x ?? 0, y ?? 0)
          ?.closest('[data-testid^="tab-"]')
          ?.getAttribute('data-testid') ?? null,
      [tabs.x + tabs.width / 2, tabs.y + tabs.height / 2],
    );
    expect(hit).toMatch(/^tab-/);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

    // The end of the page clears the bar: the footer's last line is above it.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = (await page.getByTestId('site-footer').boundingBox())!;
    const at = (await bar.boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(at.y + 0.5);

    // On Summary the card is under the model's card and before the timeline.
    await page.goto(`/${locale}/match/${OPEN_MATCH}`);
    const card = page.locator('#pick');
    await expect(card.getByTestId('pick-control')).toHaveAttribute('data-pick', 'open');
    const model = (await page.getByTestId('forecast-reality').boundingBox())!;
    const pick = (await card.boundingBox())!;
    const timeline = (await page.getByTestId('section-timeline').boundingBox())!;
    expect(pick.y).toBeGreaterThanOrEqual(model.y + model.height);
    expect(pick.y + pick.height).toBeLessThanOrEqual(timeline.y);

    // One tap on the bar: the card, first on the Predictions tab.
    await page.getByTestId('pick-bar-link').click();
    await expect(page).toHaveURL(/#pick$/);
    await expect(card.getByTestId('pick-control')).toBeInViewport();
    await expect(page.getByTestId('section-timeline')).toBeHidden();
    // The other predictions follow it (T-1744): the founder's analysis first.
    await expect(page.locator('#predictions')).toBeVisible();
    const first = (await card.boundingBox())!;
    const panel = (await page.locator('#predictions').boundingBox())!;
    expect(first.y + first.height).toBeLessThanOrEqual(panel.y);
    // The Predictions tab is the same address while the pick is open.
    await expect(page.locator('[data-tab-link="predictions"]')).toHaveAttribute('href', '#pick');
    // Another tab leaves the card out; the bar stays.
    await page.locator('[data-tab-link="lineups"]').click();
    await expect(card).toBeHidden();
    await expect(bar).toBeVisible();
    await context.close();
  });
}

test('a match that has kicked off has no pick bar, and its card is locked', async ({ page }) => {
  await page.goto(`/en/match/${PLAYED_MATCH}`);
  await expect(page.getByTestId('match-header')).toBeVisible();
  await expect(page.getByTestId('pick-bar')).toHaveCount(0);
  // From kick-off on the pick is one locked row, not three inert buttons (T-1744).
  const row = page.locator('#pick').getByTestId('match-pick');
  await expect(row).toHaveAttribute('data-product-row', '');
  await expect(row).toHaveAttribute('data-state', 'locked');
  await expect(row.getByTestId('pick-lock')).toBeVisible();
  await expect(row.getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('pick-control')).toHaveCount(0);
  // After kick-off the Predictions tab is the panel's again.
  await expect(page.locator('[data-tab-link="predictions"]')).toHaveAttribute(
    'href',
    '#predictions',
  );
});

// T-1743 (D-364, board P2-4): before kick-off the phone's top block -- the
// tools row, the band and the tabs -- is short enough for the forecast and
// the pick to start on the first screen. 264px as drawn; the bound leaves
// room for a competition line that wraps.
for (const locale of ['en', 'fa'] as const) {
  test(`/${locale}: the phone’s top block before kick-off is one row, a short band and the tabs`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto(`/${locale}/match/${OPEN_MATCH}`);
    const tools = (await page.getByTestId('match-tools').boundingBox())!;
    const nav = (await page.getByTestId('section-nav').boundingBox())!;
    expect(tools.height).toBe(44);
    expect(nav.y + nav.height - tools.y).toBeLessThanOrEqual(300);
    // Follow is the row's last word, and leads to sign-in with the way back.
    await expect(page.getByTestId('match-follow-guest').getByRole('link')).toHaveAttribute(
      'href',
      `/${locale}/login?next=${encodeURIComponent(`/${locale}/match/${OPEN_MATCH}`)}`,
    );
    // One freshness line, a reading and no counter; the stream is not named.
    const line = page.getByTestId('freshness-line');
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute('data-freshness', 'current');
    await expect(page.getByTestId('live-state')).toHaveCount(0);
    // The rest is behind a native disclosure, which opens without a script.
    const facts = page.getByTestId('freshness-facts');
    await expect(facts).toBeHidden();
    await line.click();
    await expect(facts).toBeVisible();
    await expect(facts.getByRole('listitem').first()).toBeVisible();
    // From 768px the facts row stands in the band; on a phone it is not drawn.
    await expect(page.getByTestId('last-update')).toBeHidden();
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
    await context.close();
  });
}
