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

    await bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/en/competition/${PREMIER_LEAGUE}`));
    await expect(page.getByTestId('title')).toHaveText(/Premier League/i);
    await expect(bar.locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
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
