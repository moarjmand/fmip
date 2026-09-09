import { expect, test } from '@playwright/test';

/**
 * The RTL pseudo-locale check (D-003).
 *
 * These assertions are about computed layout, not screenshots. A screenshot
 * diff fails on a font hint or an antialiasing change and teaches everyone to
 * ignore it; a computed-style assertion fails on exactly one thing — someone
 * writing a physical property where a logical one belongs.
 *
 * The canary is the `<h1>` accent bar: `border-s-4 ps-4` sits on the inline
 * start, so it must render on the left in `en` and on the right in `x-rtl`.
 * Replace either with `border-l-4` or `pl-4` and the `x-rtl` case fails.
 */

const ACCENT_WIDTH = '4px';
const ACCENT_PADDING = '16px';

test.describe('locale routing', () => {
  test('/en renders left-to-right', async ({ page }) => {
    await page.goto('/en');

    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('title')).toHaveText('FMIP');
  });

  test('/x-rtl renders right-to-left', async ({ page }) => {
    await page.goto('/x-rtl');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'x-rtl');
    // Same English content: the pseudo-locale changes direction, not language.
    await expect(page.getByTestId('title')).toHaveText('FMIP');
  });

  test('a path without a locale redirects to the default one', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/en$/);
  });

  test('the pseudo-locale is not indexable', async ({ page }) => {
    await page.goto('/x-rtl');

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('layout mirrors under rtl', () => {
  test('the inline-start accent sits on the left in en', async ({ page }) => {
    await page.goto('/en');

    const style = await page.getByTestId('title').evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        borderLeftWidth: computed.borderLeftWidth,
        borderRightWidth: computed.borderRightWidth,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
      };
    });

    expect(style).toEqual({
      borderLeftWidth: ACCENT_WIDTH,
      borderRightWidth: '0px',
      paddingLeft: ACCENT_PADDING,
      paddingRight: '0px',
    });
  });

  test('the inline-start accent moves to the right in x-rtl', async ({ page }) => {
    await page.goto('/x-rtl');

    const style = await page.getByTestId('title').evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        borderLeftWidth: computed.borderLeftWidth,
        borderRightWidth: computed.borderRightWidth,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
      };
    });

    // This is the whole point of the pseudo-locale: had the accent been written
    // with `border-l-4 pl-4`, this object would be identical to the `en` one.
    expect(style).toEqual({
      borderLeftWidth: '0px',
      borderRightWidth: ACCENT_WIDTH,
      paddingLeft: '0px',
      paddingRight: ACCENT_PADDING,
    });
  });
});
