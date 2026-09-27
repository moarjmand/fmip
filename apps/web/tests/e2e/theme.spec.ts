import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * The theme (T-602, D-089) in a real browser. A chosen theme wins over the
 * device's and is on <html> in the first response, so there is nothing to
 * flash; the header's switch works without an API (a guest's choice lives in
 * the cookie); and each theme passes axe on the pages that carry the most
 * colour, whichever way the device leans.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = ['/en/scores', '/en/login', '/en/match/00000000-0000-4000-8000-000000000901'];

for (const [theme, device, canvas] of [
  ['dark', 'light', 'rgb(18, 18, 18)'],
  ['light', 'dark', 'rgb(255, 255, 255)'],
] as const) {
  test.describe(`a chosen ${theme} theme on a ${device} device`, () => {
    test.beforeEach(async ({ context, page, baseURL }) => {
      await context.addCookies([{ name: 'fmip_theme', value: theme, url: baseURL ?? '' }]);
      await page.emulateMedia({ colorScheme: device });
    });

    test('is in the server-rendered <html>, before any script runs', async ({ request }) => {
      const response = await request.get('/en/scores', {
        headers: { cookie: `fmip_theme=${theme}` },
      });
      expect(await response.text()).toContain(`data-theme="${theme}"`);
    });

    test('paints the page in its own colours', async ({ page }) => {
      await page.goto('/en/scores');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        canvas,
      );
    });

    for (const path of PAGES) {
      test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.goto(path);
        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(
          results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
        ).toEqual([]);
      });
    }
  });
}

test('the header switch sets the theme, says which is on, and it lasts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/en/scores');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'system');

  const header = page.getByTestId('theme-switch-compact');
  await expect(header.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true');
  await header.getByTestId('theme-dark').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(header.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(18, 18, 18)',
  );

  await page.getByTestId('theme-switch-compact').getByTestId('theme-system').click();
  await expect(html).toHaveAttribute('data-theme', 'system');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(255, 255, 255)',
  );
});
