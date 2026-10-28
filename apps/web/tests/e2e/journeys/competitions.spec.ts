import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The competitions bar and the All competitions page with the seed behind
 * them (T-1433): the bar names the competitions in the product's order and
 * opens each page; the page groups every competition (international, then
 * continental, then each country), filters by name or country as the reader
 * types, and opens a competition's page. Keyboard and axe included.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const LA_LIGA = '00000000-0000-4000-8000-000000000202';
const WORLD_CUP = '00000000-0000-4000-8000-000000000206';

test.describe('competitions bar', () => {
  test('names the competitions and opens one, marking it current', async ({ page }) => {
    await page.goto('/en');
    const bar = page.getByRole('navigation', { name: 'Competitions' });
    await expect(bar.getByTestId('competitions-bar-item').first()).toBeVisible();
    await expect(bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toHaveCount(1);
    // The seed plays nothing today, so each chip is a link and the Premier
    // League's says its next match day, the seeded match ahead (T-1623, T-1624).
    await expect(page.getByTestId('rail-drawer')).toHaveCount(0);
    await expect(
      bar.locator(`[data-competition="${PREMIER_LEAGUE}"] [data-testid="rail-status"]`),
    ).toHaveAttribute('data-kind', 'day');

    await bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/en/competition/${PREMIER_LEAGUE}`));
    await expect(page.getByTestId('title')).toHaveText(/Premier League/i);
    await expect(bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('is drawn again by the server when the page says a match moved (T-1635)', async ({
    page,
  }) => {
    await page.goto('/en');
    const bar = page.getByRole('navigation', { name: 'Competitions' });
    const premier = bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`);
    // A client-side navigation keeps the layout, and the rail with it.
    await premier.click();
    await expect(page).toHaveURL(new RegExp(`/en/competition/${PREMIER_LEAGUE}`));

    // What the match centre and the scores page say when their stream sees a
    // goal: the rail asks its Server Function at once (the seed plays nothing
    // today, so it would otherwise wait for the next day).
    const asked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.request().headers()['next-action'] !== undefined,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('fmip:live-moved')));
    const answer = await asked;
    expect(answer.status()).toBe(200);
    expect(await answer.text()).toContain(PREMIER_LEAGUE);

    // The rail drawn again is the same rail, still marking the page being read.
    await expect(premier.getByTestId('rail-status')).toHaveAttribute('data-kind', 'day');
    await expect(premier).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('matchday-rail')).not.toHaveAttribute('data-behind', 'true');
  });

  test('is reached by keyboard, All competitions last (T-1513)', async ({ page }) => {
    await page.goto('/en/scores');
    const all = page.getByTestId('competitions-bar-all');
    const last = page.getByTestId('competitions-bar-item').last();
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(all).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/competitions$/);
  });
});

test.describe('All competitions page', () => {
  test('groups every competition and filters as the reader types', async ({ page }) => {
    await page.goto('/en/competitions');
    const list = page.getByTestId('competitions-groups');
    const groups = page.getByTestId('competitions-group');
    await expect(groups.first()).toHaveAttribute('data-kind', 'international');
    await expect(groups.nth(1)).toHaveAttribute('data-kind', 'continental');
    await expect(groups.first().locator(`[data-competition="${WORLD_CUP}"]`)).toHaveCount(1);
    const england = page.locator('section', {
      has: page.getByRole('heading', { name: 'England' }),
    });
    await expect(england.getByTestId('competitions-item')).toHaveCount(2);

    // A country's name finds its competitions; a competition's name finds it.
    await page.getByLabel('Find a competition or country').fill('spain');
    await expect(page.getByTestId('competitions-item')).toHaveCount(1);
    await expect(list.locator(`[data-competition="${LA_LIGA}"]`)).toBeVisible();
    await expect(page).toHaveURL(/\?q=spain$/);

    await page.getByLabel('Find a competition or country').fill('nothing like this');
    await expect(page.getByTestId('competitions-no-match')).toBeVisible();

    await page.getByLabel('Find a competition or country').fill('liga');
    await list.locator(`[data-competition="${LA_LIGA}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/en/competition/${LA_LIGA}`));
  });

  test('answers a shared filtered address on the server', async ({ page }) => {
    await page.goto('/en/competitions?q=premier');
    await expect(page.getByLabel('Find a competition or country')).toHaveValue('premier');
    await expect(page.getByTestId('competitions-item')).toHaveCount(1);
  });

  test('chooses a country from its tile, keeps it in the address, and All resets (T-1612)', async ({
    page,
  }) => {
    await page.goto('/en/competitions');
    const chooser = page.getByRole('navigation', { name: 'Countries and regions' });
    const all = chooser.locator('[data-region="all"]');
    const england = chooser.locator('[data-region="eng"]');
    await expect(all).toHaveAttribute('aria-current', 'true');
    // Each tile names its country, how many competitions we follow there, and
    // draws a flag or the neutral box -- never a stand-in (the seed has no flags).
    await expect(england).toContainText('England');
    await expect(england).toContainText('2 competitions');
    await expect(england.getByTestId('country-flag')).toHaveAttribute(
      'data-coverage',
      /^(available|not_supplied)$/,
    );
    await expect(
      chooser.locator('[data-region="international"] [data-testid="region-mark"]'),
    ).toHaveCount(1);

    await england.click();
    await expect(page).toHaveURL(/\/en\/competitions\?country=eng$/);
    await expect(england).toHaveAttribute('aria-current', 'true');
    await expect(all).not.toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('competitions-group')).toHaveCount(1);
    await expect(page.getByTestId('competitions-item')).toHaveCount(2);
    await expect(page.getByTestId('competitions-chosen')).toContainText('England');

    // The filter narrows inside the choice, and both stay in the address.
    await page.getByLabel('Find a competition or country').fill('cup');
    await expect(page.getByTestId('competitions-item')).toHaveCount(1);
    await expect(page).toHaveURL(/\?country=eng&q=cup$/);

    await page.getByLabel('Find a competition or country').fill('');
    await all.click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
    expect(await page.getByTestId('competitions-group').count()).toBeGreaterThan(2);
  });

  test('answers a shared chosen address on the server, with its season on each card', async ({
    page,
  }) => {
    await page.goto(`/en/competitions?country=ENG`);
    await expect(
      page
        .getByRole('navigation', { name: 'Countries and regions' })
        .locator('[data-region="eng"]'),
    ).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('competitions-group')).toHaveCount(1);
    const premier = page
      .getByTestId('competitions-groups')
      .locator(`[data-competition="${PREMIER_LEAGUE}"]`);
    await expect(premier).toContainText('League');
    await expect(premier.getByTestId('competitions-item-season')).toHaveText(/^\d{4}(\/\d{2})?$/);
    // A country we do not follow opens the whole list, not an empty one.
    await page.goto('/en/competitions?country=atlantis');
    expect(await page.getByTestId('competitions-group').count()).toBeGreaterThan(2);
  });

  test('is in Persian on /fa, with Persian digits', async ({ page }) => {
    await page.goto('/fa/competitions?country=eng');
    const chooser = page.getByRole('navigation', { name: 'کشورها و منطقه‌ها' });
    await expect(chooser.locator('[data-region="all"]')).toContainText('همه');
    await expect(chooser.locator('[data-region="eng"]')).toContainText('۲ رقابت');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test.describe('without a script', () => {
    test.use({ javaScriptEnabled: false });

    test('a tile is a link the server answers', async ({ page }) => {
      await page.goto('/en/competitions');
      await page.locator('[data-region="esp"]').click();
      await expect(page).toHaveURL(/\/en\/competitions\?country=esp$/);
      await expect(page.getByTestId('competitions-group')).toHaveCount(1);
      await expect(
        page.getByTestId('competitions-groups').locator(`[data-competition="${LA_LIGA}"]`),
      ).toBeVisible();
    });
  });

  for (const width of [1280, 360]) {
    test(`passes axe at ${width}px, target-size included`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/en/competitions');
      await expect(page.getByTestId('competitions-item').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
      ).toEqual([]);
      // Nothing scrolls the page sideways; the bar scrolls inside itself.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
