import { expect, type Locator, type Page, test } from '@playwright/test';

/**
 * The About page's two pictures (T-1615, D-286), without an API behind them
 * (they need none): "How Stadiomind works" is an ordered list of six steps
 * drawn as a diagram, and "Find your way" is the main sections as links.
 * What a screenshot cannot say is checked here: the flow runs along the
 * line of reading (left to right in English, right to left under the rtl
 * pseudo-locale), turns vertical on a phone, keeps the three products in
 * lanes of their own, and moves only when motion is welcome.
 */

const STEPS = [
  'how-source',
  'how-record',
  'how-lanes',
  'how-kickoff',
  'how-settle',
  'how-outcomes',
] as const;

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error('not drawn');
  return found;
}

async function centreX(page: Page, testId: string): Promise<number> {
  const { x, width } = await box(page.getByTestId(testId));
  return x + width / 2;
}

test.describe('About page', () => {
  test('says how it works in an ordered list, the words being the diagram', async ({ page }) => {
    await page.goto('/en/about');
    const figure = page.getByTestId('how-it-works');
    await expect(figure.locator('figcaption')).toContainText('The steps in order.');
    const steps = page.getByTestId('how-steps');
    await expect(steps.locator('> li')).toHaveCount(STEPS.length);
    for (const [index, id] of STEPS.entries()) {
      await expect(steps.locator('> li').nth(index)).toHaveAttribute('data-testid', id);
    }
    // The three products, in lanes and in records of their own.
    for (const part of ['how-lanes', 'how-outcomes']) {
      await expect(page.getByTestId(part).locator('[data-product]')).toHaveCount(3);
    }
    // Wires and gate marks are pictures: hidden from assistive technology.
    await expect(figure.locator('.how-wire:not([aria-hidden="true"])')).toHaveCount(0);
    await expect(figure.locator('.how-node:not([aria-hidden="true"])')).toHaveCount(0);

    const headings = await page
      .locator('main')
      .locator('h1, h2, h3')
      .evaluateAll((all) => all.map((h) => h.tagName));
    expect(headings.slice(0, 5)).toEqual(['H1', 'H2', 'H2', 'H3', 'H3']);
  });

  test('flows along the line of reading on a wide screen, both ways', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/en/about');
    const record = await centreX(page, 'how-record');
    const kickoff = await centreX(page, 'how-kickoff');
    const outcomes = await centreX(page, 'how-outcomes');
    expect(record).toBeLessThan(kickoff);
    expect(kickoff).toBeLessThan(outcomes);
    // Each lane, its two gate marks and its record share one line.
    const lane = await box(page.getByTestId('how-lanes').locator('[data-product="founder"]'));
    const result = await box(page.getByTestId('how-outcomes').locator('[data-product="founder"]'));
    expect(Math.abs(lane.y + lane.height / 2 - (result.y + result.height / 2))).toBeLessThan(2);

    await page.goto('/x-rtl/about');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await centreX(page, 'how-record')).toBeGreaterThan(await centreX(page, 'how-kickoff'));
    expect(await centreX(page, 'how-kickoff')).toBeGreaterThan(await centreX(page, 'how-outcomes'));
  });

  test('turns vertical on a phone, with nothing wider than the screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/en/about');
    let bottom = -1;
    for (const id of STEPS) {
      const step = await box(page.getByTestId(id));
      expect(step.y).toBeGreaterThan(bottom);
      bottom = step.y + step.height;
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  test('moves only when motion is welcome', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/en/about');
    const strand = page.locator('.how-strand').first();
    await expect(strand).toHaveCSS('animation-name', 'none');
    await expect(page.getByTestId('how-outcomes')).toHaveCSS('opacity', '1');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    await expect(strand).toHaveCSS('animation-name', 'how-dots');
  });

  test('maps the sections as links, in the reader’s language', async ({ page }) => {
    await page.goto('/fa/about');
    await expect(page.getByTestId('title')).toHaveText('Stadiomind چیست');
    const tiles = page.locator('[data-testid^="about-tile-"]');
    await expect(tiles).toHaveCount(10);
    await expect(page.getByTestId('about-tile-model')).toHaveAttribute(
      'href',
      '/fa/model-accuracy',
    );
    await expect(page.getByTestId('about-tile-leaderboard')).toHaveAttribute(
      'href',
      '/fa/leaderboard',
    );
    await page.getByTestId('about-tile-competitions').click();
    await expect(page).toHaveURL(/\/fa\/competitions$/);
  });
});
