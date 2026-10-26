import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The Highlights page with the seed behind it (T-1434, D-226). The seed holds
 * one verified clip, for the finished Liverpool v Manchester United, offered
 * in every territory: a guest who chose no territory is shown it, unmarked,
 * with the sentence that every clip is listed (T-1488, D-260); the
 * clip names its match (a link to the match page) and its publisher (a link
 * out, never a player); the competition filter and the territory chooser
 * keep each other in the address. Keyboard and axe included.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FINISHED_MATCH = '00000000-0000-4000-8000-000000000901';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';

test.describe('Highlights page', () => {
  test('lists the clip with its match and publisher, link only', async ({ page }) => {
    await page.goto('/en/highlights');
    await expect(page.getByTestId('highlights-all')).toBeVisible();

    const item = page.locator(`[data-testid="highlight-item"][data-fixture="${FINISHED_MATCH}"]`);
    await expect(item).toBeVisible();
    await expect(item).toContainText('Liverpool');
    await expect(item).toContainText('Premier League');
    await expect(item.getByTestId('highlight-match')).toHaveAttribute(
      'href',
      `/en/match/${FINISHED_MATCH}`,
    );
    // The way out names the destination's host; the publisher is named beside it (T-1614).
    const out = item.getByTestId('highlight-link');
    await expect(out).toHaveAttribute('href', 'https://example.com/highlights/e2e-0901');
    await expect(out).toHaveAttribute('rel', /noopener/);
    await expect(out).toHaveAttribute('data-link-out', 'example.com');
    await expect(item.getByTestId('highlight-publisher')).toContainText('Example Publisher');
    // Offered everywhere: nothing to warn about.
    await expect(item.getByTestId('highlight-restricted')).toHaveCount(0);
    // Link only (D-184): nothing is played here, and the poster is drawn from
    // our own crests and logos (or their lettered marks), never a video frame.
    await expect(page.locator('main iframe, main video')).toHaveCount(0);
    await expect(item.getByTestId('highlight-play')).toBeVisible();
    await expect(item.locator('[data-testid="entity-image"][data-kind="crest"]')).toHaveCount(2);
    await expect(item.locator('img:not([src^="/api/media/"])')).toHaveCount(0);
  });

  test('features the newest clip as a poster, and the poster opens the clip', async ({ page }) => {
    await page.goto('/en/highlights');
    const featured = page.locator('[data-testid="highlight-item"][data-look="featured"]');
    await expect(featured).toHaveCount(1);
    // The whole poster is the clip's link; the competition and the match page are their own.
    const teams = featured.getByTestId('highlight-teams');
    await teams.scrollIntoViewIfNeeded();
    const box = await teams.boundingBox();
    expect(box).not.toBeNull();
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('data-testid'),
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(hit).toBe('highlight-link');
    await expect(featured.getByTestId('highlight-competition')).toHaveAttribute(
      'href',
      new RegExp(`/en/highlights\\?competition=${PREMIER_LEAGUE}`),
    );
  });

  test('filters by competition and keeps a guest territory on every link', async ({ page }) => {
    await page.goto('/en/highlights');
    const filter = page.getByTestId('highlights-filter');
    await filter.locator(`[data-competition="${PREMIER_LEAGUE}"]`).click();
    await expect(page).toHaveURL(new RegExp(`competition=${PREMIER_LEAGUE}`));
    await expect(filter.locator(`[data-competition="${PREMIER_LEAGUE}"]`)).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('highlight-item')).not.toHaveCount(0);

    // A guest picks a territory: the filter stays, the "every clip" sentence goes.
    const form = page.getByTestId('viewing-territory-form');
    await form.getByLabel('Territory').selectOption({ label: 'Iran' });
    await form.getByRole('button').click();
    await expect(page).toHaveURL(/territory=IR/);
    await expect(page).toHaveURL(new RegExp(`competition=${PREMIER_LEAGUE}`));
    await expect(page.getByTestId('highlights-all')).toHaveCount(0);
    await expect(page.getByTestId('highlight-match').first()).toHaveAttribute(
      'href',
      /territory=IR/,
    );
    await expect(page.getByTestId('highlights-filter-all')).toHaveAttribute(
      'href',
      '/en/highlights?territory=IR',
    );
  });

  test('says when a page holds nothing, rather than an empty list', async ({ page }) => {
    await page.goto('/en/highlights?page=400');
    await expect(page.getByTestId('highlights-empty')).toBeVisible();
    await expect(page.getByTestId('highlight-item')).toHaveCount(0);
  });

  test('is reached from the header nav by keyboard, a section of its own (D-281)', async ({
    page,
  }) => {
    await page.goto('/en');
    await page.getByTestId('nav-highlights').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/highlights$/);
  });

  for (const width of [1280, 360]) {
    test(`passes axe at ${width}px, target-size included`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/en/highlights');
      await expect(page.getByTestId('highlight-item').first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
      ).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
