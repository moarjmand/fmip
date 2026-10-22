import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Lite mode for slow connections (T-1387, D-205) in a real browser against
 * the production build: the server renders it from the choice or
 * `Save-Data`; a lite page requests no web font and no image; a slow
 * connection only a script can see turns it on after load and makes the next
 * page lite from the server; the banner's switch turns it off and that
 * lasts; Settings offers Auto / On / Off.
 */

const PAGES = ['/en/scores', '/fa/scores', '/en/settings', '/fa'];

async function setCookies(page: Page, cookies: Record<string, string>, baseURL?: string) {
  await page
    .context()
    .addCookies(
      Object.entries(cookies).map(([name, value]) => ({ name, value, url: baseURL ?? '' })),
    );
}

/**
 * Every font and image the page fetches over the network while it loads.
 * A file an earlier page left in Chromium's memory cache can be reported as a
 * request without anything being sent (`requestStart` is -1); that costs a
 * slow connection nothing, so it is not counted -- `loadedFaces` says the
 * page did not use it either.
 */
function watch(page: Page): { fonts: string[]; images: string[] } {
  const seen = { fonts: [] as string[], images: [] as string[] };
  page.on('requestfinished', (request) => {
    if (request.timing().requestStart < 0) return;
    const url = request.url();
    if (request.resourceType() === 'font' || /\.woff2?(\?|$)/.test(url)) seen.fonts.push(url);
    if (request.resourceType() === 'image') seen.images.push(url);
  });
  return seen;
}

/** The web font faces the document actually loaded (or is loading). */
const loadedFaces = (page: Page) =>
  page.evaluate(() =>
    [...document.fonts].filter((face) => face.status !== 'unloaded').map((face) => face.family),
  );

test.use({ serviceWorkers: 'block' });

test('the server renders lite mode from the choice or Save-Data, and off wins', async ({
  request,
}) => {
  const html = async (headers: Record<string, string>) =>
    (await request.get('/en/scores', { headers })).text();

  const none = await html({});
  expect(none).toContain('data-lite="off"');
  expect(none).not.toContain('data-testid="lite-banner"');

  const chosen = await html({ cookie: 'fmip_lite=on' });
  expect(chosen).toContain('data-lite="on"');
  expect(chosen).toContain('data-reason="chosen"');
  expect(chosen).toContain('No images or club crests · device fonts only');

  const saveData = await html({ 'save-data': 'on' });
  expect(saveData).toContain('data-lite="on"');
  expect(saveData).toContain('Lite mode on · slow connection detected');

  const hint = await html({ cookie: 'fmip_slow=1' });
  expect(hint).toContain('data-lite="on"');
  expect(hint).toContain('data-reason="slow"');

  const off = await html({ 'save-data': 'on', cookie: 'fmip_lite=off; fmip_slow=1' });
  expect(off).toContain('data-lite="off"');
});

for (const path of PAGES) {
  test(`${path} in lite mode loads no woff2 and no image, and draws no <img>`, async ({
    page,
    baseURL,
  }) => {
    await setCookies(page, { fmip_lite: 'on' }, baseURL);
    const seen = watch(page);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('html')).toHaveAttribute('data-lite', 'on');
    await expect(page.getByTestId('lite-banner')).toBeVisible();
    await expect(page.locator('img')).toHaveCount(0);
    expect(seen.fonts).toEqual([]);
    expect(seen.images).toEqual([]);
    expect(await loadedFaces(page)).toEqual([]);
    // The text is drawn in the device's own face.
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family).not.toMatch(/Variable/);
  });
}

test('the same page out of lite mode does load its web fonts (the check above can fail)', async ({
  page,
}) => {
  const seen = watch(page);
  await page.goto('/en/scores');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'off');
  expect(seen.fonts.length).toBeGreaterThan(0);
  expect((await loadedFaces(page)).length).toBeGreaterThan(0);
});

test('an English page fetches no Persian face, even for the language picker’s word (T-1464)', async ({
  page,
}) => {
  const seen = watch(page);
  await page.goto('/en');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'off');
  expect(seen.fonts.filter((url) => /vazirmatn|markazi/i.test(url))).toEqual([]);
  expect((await loadedFaces(page)).filter((family) => /Vazirmatn|Markazi/.test(family))).toEqual(
    [],
  );
});

test('a slow connection only a script sees turns lite on, and the next page is lite from the server', async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    const connection = Object.assign(new EventTarget(), { effectiveType: '3g', saveData: false });
    Object.defineProperty(Navigator.prototype, 'connection', { get: () => connection });
  });
  const first = await page.goto('/en/scores');
  expect(await first!.text()).toContain('data-lite="off"');
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'on');
  await expect(page.getByTestId('lite-banner')).toContainText('slow connection detected');
  const cookies = await page.context().cookies(baseURL);
  expect(cookies.find((c) => c.name === 'fmip_slow')?.value).toBe('1');
  // This first page was rendered before anyone knew: its fonts may still be
  // arriving. Only the next page's requests count.
  await page.waitForLoadState('networkidle');

  // The next page, in a new tab of the same browser (its cookies, not the
  // first tab's memory cache): lite from the server's first byte.
  const second = await page.context().newPage();
  const seen = watch(second);
  const next = await second.goto('/en/settings');
  expect(await next!.text()).toContain('data-lite="on"');
  await second.waitForLoadState('networkidle');
  expect(seen.fonts).toEqual([]);
  expect(seen.images).toEqual([]);
  expect(await loadedFaces(second)).toEqual([]);
});

test.describe('with Save-Data: on', () => {
  test.use({ extraHTTPHeaders: { 'save-data': 'on' } });

  test('the banner’s switch turns lite mode off, and the choice is remembered', async ({
    page,
    context,
  }) => {
    await page.goto('/en/scores');
    const banner = page.getByTestId('lite-banner');
    await expect(banner).toContainText('Lite mode on · slow connection detected');

    const toggle = page.getByRole('switch', { name: 'Lite mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const box = await toggle.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
    // A banner, not a modal: the page under it stays in reach.
    await expect(page.locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
    const results = await new AxeBuilder({ page }).include('[data-testid="lite-banner"]').analyze();
    expect(results.violations).toEqual([]);

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(banner).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-lite', 'off');
    // Every cookie of the context: on a production build the choice is `Secure`,
    // which a filter by this plain-http address would leave out.
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === 'fmip_lite')?.value).toBe('off');

    // Still Save-Data, still off.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-lite', 'off');
    await expect(page.getByTestId('lite-banner')).toHaveCount(0);
  });
});

test('Settings offers Auto, On and Off, and On says plainly "Lite mode on"', async ({ page }) => {
  await page.goto('/en/settings');
  const row = page.getByTestId('appearance-lite');
  await expect(row.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
  await row.getByRole('button', { name: 'On' }).click();
  await expect(row.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'on');
  await expect(page.getByTestId('lite-banner')).toHaveText('Lite mode on');
  await expect(page.getByTestId('lite-footnote')).toBeVisible();

  await row.getByRole('button', { name: 'Off' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-lite', 'off');
  await expect(page.getByTestId('lite-banner')).toHaveCount(0);
});
