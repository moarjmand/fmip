import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * The competitions menu with the seed behind it (T-1643, D-301): every
 * competition at once, grouped by region, each a link to its page; the
 * filter narrows by name as the reader types; All, Today and Live keep what
 * their counts say; Esc closes and focus comes back. On a phone the
 * competitions page is the same list, stacked, with 44px rows. Persian on
 * /fa, axe clean, nothing scrolling sideways.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const LA_LIGA = '00000000-0000-4000-8000-000000000202';
const PRO_LEAGUE = '00000000-0000-4000-8000-000000000203';
const FA_CUP = '00000000-0000-4000-8000-000000000204';
const WORLD_CUP = '00000000-0000-4000-8000-000000000206';

const item = (page: Page, id: string) =>
  page.locator(`[data-testid="competitions-menu-item"][data-competition="${id}"]`);

/** The number a toggle's label carries ("Today 3"), in any digits. */
async function counted(page: Page, show: string): Promise<number> {
  const text = await page.locator(`[data-show="${show}"]`).first().innerText();
  const digits = text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).match(/\d+/);
  return Number(digits?.[0] ?? Number.NaN);
}

test.describe('competitions menu', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('shows every competition by region, each a link to its page', async ({ page }) => {
    await page.goto('/en/scores');
    await page.getByTestId('nav-competitions').click();
    const panel = page.getByRole('dialog', { name: 'Every competition' });
    await expect(panel.getByTestId('competitions-menu-item').first()).toBeVisible();
    // The seed's competitions, each filed once.
    const group = (region: string) =>
      panel.locator(`[data-testid="competitions-menu-group"][data-region="${region}"]`);
    await expect(group('big-five').locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toBeVisible();
    await expect(group('big-five').locator(`[data-competition="${LA_LIGA}"]`)).toBeVisible();
    await expect(group('asia').locator(`[data-competition="${PRO_LEAGUE}"]`)).toBeVisible();
    await expect(group('cups').locator(`[data-competition="${FA_CUP}"]`)).toBeVisible();
    await expect(group('national').locator(`[data-competition="${WORLD_CUP}"]`)).toBeVisible();
    await expect(panel.getByTestId('competitions-menu-counts')).toContainText(/\d+ in all/);
    // Focus starts in the filter.
    await expect(panel.getByTestId('competitions-menu-filter')).toBeFocused();
    // No sideways scroll anywhere: not the page, not the panel.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const inner = await panel.evaluate((element) => {
      const box = element.firstElementChild as HTMLElement;
      return box.scrollWidth - box.clientWidth;
    });
    expect(inner).toBeLessThanOrEqual(0);

    await item(page, LA_LIGA).click();
    await expect(page).toHaveURL(new RegExp(`/en/competition/${LA_LIGA}$`));
    await expect(panel).toBeHidden();
  });

  test('filters as the reader types, and says when nothing matches', async ({ page }) => {
    await page.goto('/en');
    await page.getByTestId('nav-competitions').click();
    const filter = page.getByTestId('competitions-menu-filter');
    await expect(filter).toBeFocused();
    await filter.fill('liga');
    await expect(item(page, LA_LIGA)).toBeVisible();
    await expect(item(page, PREMIER_LEAGUE)).toHaveCount(0);
    await expect(page.getByTestId('competitions-menu-shown')).toHaveText(/^\d+ competitions?$/);
    // A country's name finds its competitions too.
    await filter.fill('england');
    await expect(item(page, PREMIER_LEAGUE)).toBeVisible();
    await expect(item(page, FA_CUP)).toBeVisible();
    await expect(item(page, LA_LIGA)).toHaveCount(0);
    await filter.fill('zzzz');
    await expect(page.getByTestId('competitions-menu-no-match')).toBeVisible();
    await expect(page.getByTestId('competitions-menu-item')).toHaveCount(0);
  });

  test('keeps what each toggle counts, one pressed at a time', async ({ page }) => {
    await page.goto('/en/scores');
    await page.getByTestId('nav-competitions').click();
    const panel = page.getByTestId('competitions-menu');
    await expect(panel.getByTestId('competitions-menu-item').first()).toBeVisible();
    const all = await counted(page, 'all');
    await expect(panel.getByTestId('competitions-menu-item')).toHaveCount(all);
    for (const show of ['today', 'live', 'all'] as const) {
      const expected = await counted(page, show);
      await panel.locator(`[data-show="${show}"]`).click();
      await expect(panel.locator(`[data-show="${show}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.locator('[aria-pressed="true"]')).toHaveCount(1);
      if (expected === 0) {
        await expect(page.getByTestId('competitions-menu-no-match')).toBeVisible();
      } else {
        await expect(panel.getByTestId('competitions-menu-item')).toHaveCount(expected);
      }
    }
  });

  test('closes on Esc and hands focus back', async ({ page }) => {
    await page.goto('/en/scores');
    const trigger = page.getByTestId('nav-competitions');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('competitions-menu-filter')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-show="all"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('competitions-menu')).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('passes axe open, target-size included', async ({ page }) => {
    await page.goto('/en/scores');
    await page.getByTestId('nav-competitions').click();
    await expect(page.getByTestId('competitions-menu-item').first()).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('#competitions-menu')
      .withTags(TAGS)
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
      ),
    ).toEqual([]);
  });

  test('is in Persian on /fa, right to left, with Persian digits', async ({ page }) => {
    await page.goto('/fa/scores');
    await page.getByTestId('nav-competitions').click();
    const panel = page.getByRole('dialog', { name: 'همه رقابت‌ها' });
    await expect(panel.getByTestId('competitions-menu-item').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(panel.getByTestId('competitions-menu-counts')).toContainText('در مجموع');
    await expect(panel.getByTestId('competitions-menu-counts')).not.toContainText(/[0-9]/);
    await expect(
      panel.locator('[data-testid="competitions-menu-group"][data-region="big-five"]'),
    ).toContainText('پنج لیگ بزرگ');
  });
});

test.describe('the competitions page on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is the same list, stacked, with 44px rows and the filter and toggles on top', async ({
    page,
  }) => {
    await page.goto('/en/scores');
    await page.getByTestId('tab-leagues').click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
    const list = page.getByTestId('competitions-phone');
    await expect(list).toBeVisible();
    // The desktop's tiles and cards are not drawn on a phone.
    await expect(page.getByTestId('competitions-jump')).toBeHidden();
    await expect(list.getByTestId('competitions-menu-body')).toHaveAttribute(
      'data-layout',
      'stack',
    );
    const rows = list.getByTestId('competitions-menu-item');
    await expect(rows.first()).toBeVisible();
    for (const row of await rows.all()) {
      expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // The filter and the toggles come before the first group.
    const filter = await list.getByTestId('competitions-menu-filter').boundingBox();
    const first = await list.getByTestId('competitions-menu-group').first().boundingBox();
    expect(filter!.y).toBeLessThan(first!.y);
    await list.getByTestId('competitions-menu-filter').fill('liga');
    await expect(list.locator(`[data-competition="${LA_LIGA}"]`)).toBeVisible();
    await expect(list.locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('passes axe at 360px, target-size included', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/fa/competitions');
    await expect(page.getByTestId('competitions-phone')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
      ),
    ).toEqual([]);
  });
});
