import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { member, registerAndVerify } from './members';

/**
 * Matches and predictions on one page (T-1496, D-268), through the whole
 * stack: the seed's open match (Liverpool v Manchester United, 1 January
 * 2099, no forecast stored) and its played day.
 *
 * - The row carries the model's cell and a Pick; a match with no forecast says
 *   "Not supplied", never an empty bar (rule 3).
 * - A pick made from the row is stored, and the community's split appears only
 *   after it (D-206); the row then says "Picked" and "Not picked yet" leaves it out.
 * - en, fa and x-rtl at 390 px and 1440 px: the preview beside the list on a
 *   desktop, above it on a phone once Pick was pressed, mirrored in RTL.
 */

const OPEN_MATCH = '00000000-0000-4000-8000-000000000902';
const OPEN_DAY = '2099-01-01';
const PLAYED_DAY = '2025-01-05';
const RUN = Date.now().toString(36).slice(-6);
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const openRow = (page: Page) =>
  page.locator(`[data-testid="score-card"][data-fixture-id="${OPEN_MATCH}"]`);

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('the matches page', () => {
  for (const viewport of VIEWPORTS) {
    for (const locale of ['en', 'fa', 'x-rtl'] as const) {
      test(`${locale} at ${viewport.width} px: rows, "Not supplied", the preview`, async ({
        browser,
      }) => {
        const context = await browser.newContext({ viewport: viewport });
        const page = await context.newPage();
        await page.goto(`/${locale}/scores?date=${OPEN_DAY}&tz=UTC`);

        const rtl = locale !== 'en';
        await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');
        const row = openRow(page);
        await expect(row).toBeVisible();
        // The seed stores no forecast: the badge, never an empty bar.
        const model = row.getByTestId('row-forecast');
        await expect(model).toHaveAttribute('data-state', /none|unavailable/);
        await expect(model.locator('[data-coverage-badge="not_supplied"]')).toBeVisible();
        await expect(model.locator('[data-outcome]')).toHaveCount(0);
        // Lower case in the catalogue, raised by the badge's first-letter rule.
        if (locale === 'en') await expect(model).toContainText(/not supplied/i);
        if (locale === 'fa') {
          await expect(page.getByTestId('title')).toHaveText('مسابقه‌ها');
          await expect(row.getByTestId('row-pick')).toHaveText('انتخاب');
          // Persian digits in the day strip.
          await expect(page.getByTestId('day-strip')).toContainText(/[۰-۹]/);
        }

        // The status column at the inline start of the row, the Pick at its end.
        const status = (await row.getByTestId('score-status').boundingBox())!;
        const pick = (await row.getByTestId('row-pick').boundingBox())!;
        if (rtl) expect(status.x).toBeGreaterThan(pick.x);
        else expect(status.x).toBeLessThan(pick.x);
        expect(pick.height).toBeGreaterThanOrEqual(44);

        const preview = page.getByTestId('match-preview');
        if (viewport.width >= 1024) {
          // The first open match is previewed beside the list, unasked.
          await expect(preview).toBeVisible();
          const list = (await row.boundingBox())!;
          const side = (await preview.boundingBox())!;
          if (rtl) expect(side.x + side.width).toBeLessThanOrEqual(list.x + 1);
          else expect(side.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
        } else {
          // On a phone it waits for a Pick, then stands above the list.
          await expect(preview).toBeHidden();
          await row.getByTestId('row-pick').click();
          await expect(page).toHaveURL(new RegExp(`pick=${OPEN_MATCH}`));
          await expect(preview).toBeVisible();
          const top = (await preview.boundingBox())!.y;
          expect(top).toBeLessThan((await openRow(page).boundingBox())!.y);
        }
        // A guest is asked to sign in; nobody's split is on the page.
        await expect(preview.getByTestId('inline-pick')).toHaveAttribute('data-pick', 'guest');
        await expect(page.getByTestId('community-split')).toHaveCount(0);
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(1);
        await context.close();
      });
    }
  }

  test('keeps the live freshness stamp on a played day', async ({ page }) => {
    await page.goto(`/en/scores?date=${PLAYED_DAY}&tz=UTC`);
    const state = page.getByTestId('live-state');
    await expect(state).toHaveAttribute('data-state', 'live', { timeout: 15_000 });
    await expect(state).toContainText(/Last checked/);
    // Each competition still says once when its matches last changed (rule 4).
    await expect(
      page.getByTestId('competition-group').first().getByTestId('block-updated'),
    ).toContainText('Updated');
  });
});

test.describe('a pick made from a row', () => {
  test.describe.configure({ mode: 'serial' });

  for (const viewport of VIEWPORTS) {
    test(`is stored, and only then shows the community split (${viewport.width} px)`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: viewport });
      const page = await context.newPage();
      await registerAndVerify(page, member(RUN, `pick${viewport.width}`, 'Row Picker'));

      await page.goto(`/en/scores?date=${OPEN_DAY}&tz=UTC`);
      const row = openRow(page);
      await expect(row.getByTestId('row-pick')).toHaveAttribute('data-pick', 'open');
      // A member has the two views a guest does not.
      await expect(page.getByTestId('view-unpicked')).toBeVisible();
      await expect(page.getByTestId('view-mine')).toBeVisible();

      await row.getByTestId('row-pick').click();
      await expect(page).toHaveURL(new RegExp(`pick=${OPEN_MATCH}`));
      const preview = page.getByTestId('match-preview');
      await expect(preview).toBeVisible();
      await expect(row).toHaveAttribute('aria-current', 'true');
      const form = preview.getByTestId('prediction-form');
      // The row's Pick was the first press: the outcomes are open at once.
      await expect(form).toHaveAttribute('data-pick', 'choosing');
      // Before the pick, the split is not on the page at all (D-206).
      await expect(page.getByTestId('community-split')).toHaveCount(0);
      await expect(preview.getByTestId('card-community')).toHaveAttribute('data-state', 'sealed');

      await form.locator('label[data-outcome="home"]').click();
      await form.getByRole('button', { name: 'Submit prediction' }).click();
      await expect(form).toHaveAttribute('data-pick', 'picked');
      await expect(preview.getByTestId('community-split')).toBeVisible();

      // Stored: a fresh load says so on the row and in the preview.
      await page.goto(`/en/scores?date=${OPEN_DAY}&tz=UTC&pick=${OPEN_MATCH}`);
      await expect(openRow(page).getByTestId('row-pick')).toHaveAttribute('data-pick', 'picked');
      await expect(
        page.getByTestId('match-preview').getByTestId('prediction-form'),
      ).toHaveAttribute('data-pick', 'picked');
      await expect(page.getByTestId('community-split')).toBeVisible();

      // "Not picked yet" leaves the picked match out.
      await page.getByTestId('view-unpicked').click();
      await expect(page).toHaveURL(/unpicked=1/);
      await expect(openRow(page)).toHaveCount(0);
      await context.close();
    });
  }
});

/**
 * T-1535: the chosen row (`aria-current`) is drawn on `--token-selected`, a
 * solid saffron tint, where the old 10% wash put the model's percentages under
 * 4.5:1 on Day. axe reads the row in Day and Night. The seed stores no
 * forecast, so here the row carries its status, names, coverage badge and
 * Pick; the percentages' own ratios on this ground are `tokens.spec.ts`'s,
 * which checks every text role on it in all twelve token blocks.
 */
test.describe('the selected row', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`reads at AA on its highlight (${theme === 'dark' ? 'Night' : 'Day'})`, async ({
      browser,
      baseURL,
    }) => {
      const context = await browser.newContext({
        viewport: VIEWPORTS[1],
        colorScheme: theme,
      });
      await context.addCookies([
        { name: 'fmip_theme', value: theme, url: baseURL ?? '' },
        { name: 'fmip_lite', value: 'off', url: baseURL ?? '' },
      ]);
      const page = await context.newPage();
      await page.goto(`/en/scores?date=${OPEN_DAY}&tz=UTC&pick=${OPEN_MATCH}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const row = openRow(page);
      await expect(row).toHaveAttribute('aria-current', 'true');
      // The ground is the token, solid, not a wash over whatever is behind.
      const [ground, token] = await row.evaluate((el) => {
        const probe = document.createElement('span');
        probe.style.backgroundColor = 'var(--token-selected)';
        document.body.append(probe);
        const value = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return [getComputedStyle(el).backgroundColor, value];
      });
      expect(ground).toBe(token);

      const results = await new AxeBuilder({ page })
        .include('[data-testid="score-card"][aria-current="true"]')
        .withTags(TAGS)
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual(
        [],
      );
      await context.close();
    });
  }
});
