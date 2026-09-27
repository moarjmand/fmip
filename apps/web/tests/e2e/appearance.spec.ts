import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Text size, contrast and motion (blueprint 2.2, T-621) in a real browser.
 * Each choice is on <html> in the first response; Settings -> Appearance sets
 * it without an API (a guest's choice lives in the cookie); the largest text
 * with more contrast passes axe -- AAA contrast included -- in both themes;
 * and at a phone's width the largest text never makes the page itself scroll
 * sideways.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const PAGES = [
  '/en/scores',
  '/en/login',
  '/en/settings',
  '/en/match/00000000-0000-4000-8000-000000000901',
];
const MUTED = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--token-text-muted').trim();

async function choose(page: Page, cookies: Record<string, string>, baseURL: string | undefined) {
  await page
    .context()
    .addCookies(
      Object.entries(cookies).map(([name, value]) => ({ name, value, url: baseURL ?? '' })),
    );
}

test('the choices are in the server-rendered <html>, before any script runs', async ({
  request,
}) => {
  const response = await request.get('/en/scores', {
    headers: { cookie: 'fmip_text_size=larger; fmip_contrast=more; fmip_motion=reduce' },
  });
  const html = await response.text();
  expect(html).toContain('data-text-size="larger"');
  expect(html).toContain('data-contrast="more"');
  expect(html).toContain('data-motion="reduce"');

  const none = await (await request.get('/en/scores')).text();
  expect(none).toContain('data-text-size="default"');
  expect(none).toContain('data-contrast="system"');
  expect(none).toContain('data-motion="system"');
});

test('a guest sets each in Settings, it says which is on, and it lasts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
  await page.goto('/en/settings');
  const html = page.locator('html');
  await expect(page.getByTestId('settings-guest')).toBeVisible();

  const size = page.getByTestId('appearance-text_size');
  await expect(size.getByTestId('appearance-text_size-default')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await size.getByTestId('appearance-text_size-larger').click();
  await expect(html).toHaveAttribute('data-text-size', 'larger');
  await expect(size.getByTestId('appearance-text_size-larger')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    '20px',
  );

  expect(await page.evaluate(MUTED)).toBe('#4b5563');
  await page.getByTestId('appearance-contrast-more').click();
  await expect(html).toHaveAttribute('data-contrast', 'more');
  expect(await page.evaluate(MUTED)).toBe('#374151');

  await page.getByTestId('appearance-motion-reduce').click();
  await expect(html).toHaveAttribute('data-motion', 'reduce');
  expect(await page.evaluate(() => getComputedStyle(document.body).transitionDuration)).toBe(
    '1e-05s',
  );

  await page.reload();
  await expect(html).toHaveAttribute('data-text-size', 'larger');
  await expect(html).toHaveAttribute('data-contrast', 'more');
  await expect(html).toHaveAttribute('data-motion', 'reduce');

  await page.getByTestId('appearance-text_size-default').click();
  await expect(html).toHaveAttribute('data-text-size', 'default');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(
    '16px',
  );
});

test.describe('contrast nobody chose follows the device', () => {
  test('more when the device asks, in light and dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
    await page.goto('/en/scores');
    expect(await page.evaluate(MUTED)).toBe('#374151');
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    expect(await page.evaluate(MUTED)).toBe('#d4d4d8');
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference' });
    expect(await page.evaluate(MUTED)).toBe('#a3a3a8');
  });

  test('standard, once chosen, holds whatever the device says', async ({ page, baseURL }) => {
    await choose(page, { fmip_contrast: 'standard', fmip_theme: 'dark' }, baseURL);
    await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
    await page.goto('/en/scores');
    expect(await page.evaluate(MUTED)).toBe('#a3a3a8');
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`the largest text with more contrast, ${theme}`, () => {
    test.beforeEach(async ({ page, baseURL }) => {
      await choose(
        page,
        { fmip_theme: theme, fmip_text_size: 'larger', fmip_contrast: 'more' },
        baseURL,
      );
    });

    for (const path of PAGES) {
      test(`${path} has no WCAG 2.2 AA violations, and its text is AAA contrast`, async ({
        page,
      }) => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-contrast', 'more');
        const aa = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(aa.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`)).toEqual(
          [],
        );
        const aaa = await new AxeBuilder({ page }).withRules(['color-contrast-enhanced']).analyze();
        expect(
          aaa.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(' ')}: ${n.summary}`)),
        ).toEqual([]);
      });

      test(`${path} does not scroll sideways at 360px`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 780 });
        await page.goto(path);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
