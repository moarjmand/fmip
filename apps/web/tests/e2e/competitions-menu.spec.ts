import { expect, test } from '@playwright/test';

/**
 * The header's competitions menu without an API behind it (T-1643, D-301).
 * What must hold regardless of data: from 1024px the nav's Competitions is a
 * button that opens a panel under the header over a scrim; focus moves into
 * the panel and comes back on Esc or a click on the scrim; with nothing to
 * read the panel says so rather than showing an empty one (rule 3), and still
 * leads to the competitions page. Without a script, and below 1024px, the
 * entry stays the link it was; a phone's Leagues tab leads to the page.
 */
test.describe('competitions menu, no API', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('opens from Competitions, says it cannot be read, and closes on Esc', async ({ page }) => {
    await page.goto('/en/scores');
    const trigger = page.getByTestId('nav-competitions');
    await expect(trigger).toHaveJSProperty('tagName', 'BUTTON');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toHaveAttribute('aria-controls', 'competitions-menu');
    await expect(page.getByTestId('competitions-menu')).toBeHidden();

    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('dialog', { name: 'Every competition' });
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('competitions-menu-unreachable')).toBeVisible();
    await expect(page.getByTestId('competitions-menu-item')).toHaveCount(0);
    await expect(page.getByTestId('competitions-menu-scrim')).toBeVisible();
    // Under the header, the container's width.
    const header = await page.locator('header').first().boundingBox();
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 2);
    // Focus is inside the panel.
    expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('competitions-menu-scrim')).toHaveCount(0);
  });

  test('closes on a click on the scrim, the header staying above it', async ({ page }) => {
    await page.goto('/en/scores');
    await page.getByTestId('nav-competitions').click();
    await expect(page.getByTestId('competitions-menu')).toBeVisible();
    // The header is lifted over the scrim: the wordmark is not dimmed under it.
    const lifted = await page
      .locator('header')
      .first()
      .evaluate((element) => getComputedStyle(element).zIndex);
    expect(Number(lifted)).toBeGreaterThan(30);
    await page.mouse.click(640, 700);
    await expect(page.getByTestId('competitions-menu')).toBeHidden();
    await expect(page.getByTestId('nav-competitions')).toBeFocused();
  });

  test('toggles from its trigger, and leads to the competitions page', async ({ page }) => {
    await page.goto('/en');
    const trigger = page.getByTestId('nav-competitions');
    await trigger.click();
    await expect(page.getByTestId('competitions-menu')).toBeVisible();
    await page.getByTestId('competitions-menu-all').click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
    await expect(page.getByTestId('competitions-menu')).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-current', 'page');
    await trigger.click();
    await expect(page.getByTestId('competitions-menu')).toBeVisible();
    await trigger.click();
    await expect(page.getByTestId('competitions-menu')).toBeHidden();
  });

  test('is a link below 1024px, inside the Menu', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await page.goto('/en/scores');
    await page.getByTestId('nav-menu').locator(':scope > summary').click();
    const entry = page.getByTestId('nav-competitions');
    await expect(entry).toHaveJSProperty('tagName', 'A');
    await entry.click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
  });

  test('mirrors under the rtl pseudo-locale', async ({ page }) => {
    await page.goto('/x-rtl/scores');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.getByTestId('nav-competitions').click();
    const panel = await page.getByTestId('competitions-menu').boundingBox();
    const link = await page.getByTestId('competitions-menu-all').boundingBox();
    // The footer's link starts at the inline start: the right, under rtl.
    expect(link!.x + link!.width).toBeGreaterThan(panel!.x + panel!.width / 2);
  });

  test.describe('without a script', () => {
    test.use({ javaScriptEnabled: false });

    test('Competitions is the link to the page', async ({ page }) => {
      await page.goto('/en/scores');
      const entry = page.getByTestId('nav-competitions');
      await expect(entry).toHaveJSProperty('tagName', 'A');
      await entry.click();
      await expect(page).toHaveURL(/\/en\/competitions$/);
      await expect(page.getByTestId('competitions-menu')).toBeHidden();
    });
  });
});

test.describe('the competitions page on a phone, no API', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the Leagues tab leads there, and the page says the list could not be read', async ({
    page,
  }) => {
    await page.goto('/en/scores');
    await page.getByTestId('tab-leagues').click();
    await expect(page).toHaveURL(/\/en\/competitions$/);
    await expect(page.getByTestId('competitions-unreachable')).toBeVisible();
    await expect(page.getByTestId('competitions-phone')).toHaveCount(0);
    // There is no panel on a phone.
    await expect(page.getByTestId('competitions-menu')).toBeHidden();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
