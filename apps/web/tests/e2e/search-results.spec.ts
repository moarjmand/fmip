import { expect, test } from '@playwright/test';

/**
 * The search results page after a search (T-1850, D-435's design, option B):
 * the heading names the term, and from 1280px the header's field carries it
 * so the page draws no second field; below 1280px a compact field stays,
 * without the button. The empty page keeps its field and button. The suite
 * runs without the API, so the results themselves say unreachable; the
 * frame around them is what is checked here.
 */

test.describe('the search results frame', () => {
  test('names the term and leaves the field to the header from 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/search?q=man%20utd');
    await expect(page.getByTestId('title')).toHaveText('Results for “man utd”');
    await expect(page.getByTestId('search-form')).toBeHidden();
    await expect(page.getByTestId('nav-search-input')).toHaveValue('man utd');
  });

  test('keeps a compact field without the button on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/fa/search?q=%D9%85%D9%86%DA%86%D8%B3%D8%AA%D8%B1');
    await expect(page.getByTestId('title')).toHaveText('نتایج برای «منچستر»');
    const form = page.getByTestId('search-form');
    await expect(form).toBeVisible();
    await expect(page.getByTestId('search-input')).toHaveValue('منچستر');
    await expect(form.getByRole('button')).toHaveCount(0);
    expect((await page.getByTestId('search-input').boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
  });

  test('keeps the field and the button on the empty page, and the header field empty', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/search');
    await expect(page.getByTestId('title')).toHaveText('Search');
    await expect(page.getByTestId('search-form')).toBeVisible();
    await expect(page.getByTestId('search-form').getByRole('button')).toBeVisible();
    await expect(page.getByTestId('nav-search-input')).toHaveValue('');
  });

  test('leaves the term behind when the reader goes to another page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/search?q=arsenal');
    await expect(page.getByTestId('nav-search-input')).toHaveValue('arsenal');
    await page.getByTestId('nav-matches').click();
    await expect(page).toHaveURL(/\/en\/scores/);
    await expect(page.getByTestId('nav-search-input')).toHaveValue('');
  });
});
