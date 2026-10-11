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
    // The homepage's own heading is "Today" since the Hybrid front page
    // (T-1382, D-200): the wordmark is the header's.
    await expect(page.getByTestId('title')).toHaveText('Today');
  });

  test('/x-rtl renders right-to-left', async ({ page }) => {
    await page.goto('/x-rtl');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'x-rtl');
    // Same English content: the pseudo-locale changes direction, not language.
    await expect(page.getByTestId('title')).toHaveText('Today');
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

  // T-809: the not-found page is inside the locale layout, so it mirrors too.
  for (const path of ['/ar/no-such-page', '/x-rtl/no-such-page']) {
    test(`${path}'s not-found is right-to-left, its accent on the right`, async ({ page }) => {
      await page.goto(path);

      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('error-not-found')).toBeVisible();
      const style = await page.getByTestId('title').evaluate((el) => {
        const computed = getComputedStyle(el);
        return {
          borderLeftWidth: computed.borderLeftWidth,
          borderRightWidth: computed.borderRightWidth,
        };
      });
      expect(style).toEqual({ borderLeftWidth: '0px', borderRightWidth: ACCENT_WIDTH });
    });
  }

  // T-931: the platform rules page mirrors, while the rules themselves stay
  // an English, left-to-right block inside it.
  test('/x-rtl/rules is right-to-left, its accent on the right', async ({ page }) => {
    await page.goto('/x-rtl/rules');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const style = await page.getByTestId('title').evaluate((el) => {
      const computed = getComputedStyle(el);
      return {
        borderLeftWidth: computed.borderLeftWidth,
        borderRightWidth: computed.borderRightWidth,
      };
    });
    expect(style).toEqual({ borderLeftWidth: '0px', borderRightWidth: ACCENT_WIDTH });
  });

  // T-1369: the model accuracy page mirrors, its figures' table included.
  // T-1383 (D-201) set it in editorial mode, whose heading has no accent bar:
  // the canary is now the heading's 680px measure, which sits at the inline
  // start -- the right edge in `x-rtl`, the left in `en`. A `ml-auto` or a
  // `left-0` where `ms-`/`start-0` belongs puts it on the wrong side.
  for (const [locale, dir] of [
    ['x-rtl', 'rtl'],
    ['en', 'ltr'],
  ] as const) {
    test(`/${locale}/model-accuracy is ${dir}, its measure at the inline start`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/model-accuracy`);

      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      const width = page.viewportSize()?.width ?? 1280;
      const box = await page.getByTestId('title').boundingBox();
      expect(box).not.toBeNull();
      if (box === null) return;
      if (dir === 'rtl') expect(box.x + box.width).toBeGreaterThan(width * 0.75);
      else expect(box.x).toBeLessThan(width * 0.25);
    });
  }

  // T-1383: the Predictions page and its model rows mirror too.
  test('/x-rtl/predictions is right-to-left, its measure on the right', async ({ page }) => {
    await page.goto('/x-rtl/predictions');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('main')).toHaveAttribute('data-mode', 'editorial');
    const width = page.viewportSize()?.width ?? 1280;
    const box = await page.getByTestId('title').boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) expect(box.x + box.width).toBeGreaterThan(width * 0.75);
  });

  // T-1387: lite mode's banner -- the words at the inline start, the switch at
  // the inline end, its knob at the switch's inline end -- mirrors as a whole.
  for (const [path, rtl] of [
    ['/en/scores', false],
    ['/x-rtl/scores', true],
  ] as const) {
    test(`${path}'s lite banner puts its switch at the inline end`, async ({ page, baseURL }) => {
      await page.context().addCookies([{ name: 'fmip_lite', value: 'on', url: baseURL ?? '' }]);
      await page.goto(path);

      const banner = page.getByTestId('lite-banner');
      const words = (await banner.locator('span').first().boundingBox())!;
      const toggle = (await page.getByTestId('lite-switch').boundingBox())!;
      const knob = (await page.getByTestId('lite-switch').locator('span span').boundingBox())!;
      const track = (await page.getByTestId('lite-switch').locator('> span').boundingBox())!;
      if (rtl) {
        expect(toggle.x + toggle.width).toBeLessThanOrEqual(words.x);
        expect(knob.x - track.x).toBeLessThan(track.x + track.width - (knob.x + knob.width));
      } else {
        expect(words.x + words.width).toBeLessThanOrEqual(toggle.x);
        expect(knob.x - track.x).toBeGreaterThan(track.x + track.width - (knob.x + knob.width));
      }
    });
  }
});
