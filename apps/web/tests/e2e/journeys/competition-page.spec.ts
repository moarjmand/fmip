import { type Page, expect, test } from '@playwright/test';

/**
 * The competition page in the Stadiomind design (T-1498, D-265) with the API
 * and the seed behind it, in English, Persian and the right-to-left
 * pseudo-locale, on a 390 px phone and a 1440 px desktop: the header and the
 * six section tabs, the table or the sentence that it is not supplied, the
 * day's matches, the latest results and the model in this league -- each
 * with its state said (rule 3) -- laid out in the reading direction with
 * nothing scrolling the page sideways.
 *
 * The seed's current Premier League season has no stored match and no
 * table, so this page is the honest empty one; the closed 2024/25 season
 * holds Liverpool 2-2 Manchester United, the latest result the page shows.
 */

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const SEASON_2024 = '00000000-0000-4000-8000-000000000301';

const LOCALES = [
  { locale: 'en', dir: 'ltr', model: 'Model in this league' },
  { locale: 'fa', dir: 'rtl', model: 'مدل در این لیگ' },
  { locale: 'x-rtl', dir: 'rtl', model: null },
] as const;

async function box(page: Page, testId: string) {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (b === null) throw new Error(`${testId} has no box`);
  return b;
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [390, 1440]) {
  test.describe(`the competition page at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { locale, dir, model } of LOCALES) {
      test(`${locale}: the header, the tabs and every module with its state`, async ({ page }) => {
        await page.goto(`/${locale}/competition/${PREMIER_LEAGUE}`);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await expect(page.getByTestId('title')).toBeVisible();
        await expect(page.getByTestId('competition-page')).toHaveAttribute('data-tab', 'overview');

        // Six sections, the Overview current; they run in the reading direction.
        const tabs = page.getByTestId('competition-tabs').getByRole('link');
        await expect(tabs).toHaveCount(6);
        await expect(page.getByTestId('competition-tab-overview')).toHaveAttribute(
          'aria-current',
          'page',
        );
        if (model !== null)
          await expect(page.getByTestId('competition-tab-model')).toHaveText(model);
        const first = await box(page, 'competition-tab-overview');
        const second = await box(page, 'competition-tab-table');
        if (dir === 'rtl') expect(first.x).toBeGreaterThan(second.x);
        else expect(first.x).toBeLessThan(second.x);

        // The table, or the sentence that it is not supplied; a zone colour only
        // where the feed lists the places.
        const table = page.getByTestId('table');
        await expect(table).toBeVisible();
        await expect(table.locator('[data-coverage-badge]').first()).toBeVisible();
        if ((await table.getByTestId('table-row').count()) === 0) {
          await expect(table.getByTestId('table-empty')).toBeVisible();
        }
        if ((await table.getByTestId('table-zones').count()) === 0) {
          await expect(table.locator('[data-zone]')).toHaveCount(0);
        }

        // The day's matches and the latest results: rows, or the sentence why not.
        for (const id of ['match-day', 'results-day']) {
          const card = page.getByTestId(id);
          await expect(card).toBeVisible();
          if ((await card.getByTestId('fixture').count()) === 0) {
            await expect(card.getByTestId(`${id}-empty`)).toBeVisible();
          }
        }
        // Each match of the day carries the model's figures or the words for why not.
        const day = page.getByTestId('match-day');
        await expect(day.getByTestId('model-figures')).toHaveCount(
          await day.getByTestId('fixture').count(),
        );

        // The model in this league says its state; a coverage badge unless unreachable.
        const league = page.getByTestId('league-model');
        await expect(league).toBeVisible();
        const state = await league.getAttribute('data-state');
        expect(['scored', 'not_supplied', 'unreachable']).toContain(state);
        if (state !== 'unreachable') {
          await expect(league.locator('[data-coverage-badge]')).toHaveCount(1);
        }

        if (width === 390) {
          await expect(page.getByTestId('competition-back')).toBeVisible();
        } else {
          await expect(page.getByTestId('competition-back')).toBeHidden();
          // The side column sits at the table's inline end.
          const main = await box(page, 'table');
          const side = await box(page, 'match-day');
          if (dir === 'rtl') expect(side.x).toBeLessThan(main.x);
          else expect(side.x).toBeGreaterThan(main.x);
        }
        await noSidewaysScroll(page);
      });
    }

    test('a closed season shows its latest result, home first, with its score', async ({
      page,
    }) => {
      await page.goto(`/en/competition/${PREMIER_LEAGUE}?season=${SEASON_2024}`);
      const results = page.getByTestId('results-day');
      await expect(results.getByTestId('fixture').first()).toBeVisible();
      await expect(results.getByTestId('fixture-score').first()).toHaveText('2–2');
      await expect(results).toContainText(/Liverpool.*Man United/);
      await noSidewaysScroll(page);
    });
  });
}

test.describe('the section tabs', () => {
  test('open the Model and Matches tabs, and an old Hybrid address lands on Matches', async ({
    page,
  }) => {
    await page.goto(`/en/competition/${PREMIER_LEAGUE}`);
    await page.getByTestId('competition-tab-model').click();
    await expect(page).toHaveURL(/\?tab=model$/);
    await expect(page.getByTestId('competition-page')).toHaveAttribute('data-tab', 'model');
    await expect(page.getByTestId('league-model')).toBeVisible();

    await page.getByTestId('competition-tab-matches').click();
    await expect(page).toHaveURL(/\?tab=matches$/);
    await expect(page.getByTestId('fixtures')).toBeVisible();
    await expect(page.getByTestId('results')).toBeVisible();

    await page.goto(`/en/competition/${PREMIER_LEAGUE}?tab=results`);
    await expect(page.getByTestId('competition-page')).toHaveAttribute('data-tab', 'matches');
    await page.goto(`/en/competition/${PREMIER_LEAGUE}?tab=stats`);
    await expect(page.getByTestId('competition-page')).toHaveAttribute('data-tab', 'overview');
  });

  test('keep the tab when another season is chosen from the menu', async ({ page }) => {
    await page.goto(`/en/competition/${PREMIER_LEAGUE}?tab=matches`);
    await page.getByTestId('seasons').locator('summary').click();
    await page.getByTestId('seasons').getByRole('link', { name: '2024/25' }).click();
    await expect(page).toHaveURL(new RegExp(`season=${SEASON_2024}&tab=matches`));
    await expect(page.getByTestId('competition-page')).toHaveAttribute('data-tab', 'matches');
  });
});
