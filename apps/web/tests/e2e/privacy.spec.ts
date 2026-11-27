import { type Page, expect, test } from '@playwright/test';

/**
 * The privacy notice where the server names nobody (T-1969, D-465): this
 * project's web server has no `PRIVACY_CONTROLLER_NAME`, so `/privacy` says
 * the notice is being prepared, nothing links to it, and it is never
 * indexed. At 375 px, in Persian, in the right-to-left pseudo-locale and in
 * English, without sideways scroll. The notice itself, configured, is
 * `journeys/privacy-notice.spec.ts`'s: CI's journeys job names a test
 * controller.
 */

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.use({ viewport: { width: 375, height: 812 } });

for (const [path, dir, words] of [
  ['/fa/privacy', 'rtl', 'اطلاعیه‌ی حریم خصوصی در حال آماده شدن است'],
  ['/x-rtl/privacy', 'rtl', 'The privacy notice is being prepared.'],
  ['/en/privacy', 'ltr', 'The privacy notice is being prepared.'],
] as const) {
  test(`${path} says the notice is being prepared, is never indexed and does not scroll sideways`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByTestId('privacy-preparing')).toContainText(words);
    await expect(page.getByTestId('privacy-body')).toHaveCount(0);
    // Nothing leads to a page that is not ready (rule 3).
    await expect(page.getByTestId('footer-privacy')).toHaveCount(0);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });
}
