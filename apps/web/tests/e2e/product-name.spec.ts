import { expect, test } from '@playwright/test';

/**
 * No page says the working name (T-1503, D-262): the title, every meta tag,
 * the structured data and the visible text say Stadiomind, on English, on
 * Persian (where the name stays in Latin letters) and on the RTL QA surface.
 * CI runs without an API, so the pages show their honest "unreachable"
 * states; those have to pass too.
 */

const PAGES = [
  '/en',
  '/en/scores',
  '/en/about',
  '/en/predictions',
  '/en/model-accuracy',
  '/en/login',
  '/en/register',
  '/en/rules',
  '/en/offline',
  '/en/welcome',
  '/en/match/00000000-0000-4000-8000-000000000901',
  '/en/competition/00000000-0000-4000-8000-000000000201',
  '/en/no-such-page',
  '/fa',
  '/fa/scores',
  '/fa/about',
  '/x-rtl/scores',
];

for (const path of PAGES) {
  test(`${path} names Stadiomind and never FMIP`, async ({ page }) => {
    await page.goto(path);
    const said = await page.evaluate(() => ({
      title: document.title,
      metas: [...document.querySelectorAll('meta[content]')].map(
        (meta) => meta.getAttribute('content') ?? '',
      ),
      data: [...document.querySelectorAll('script[type="application/ld+json"]')].map(
        (script) => script.textContent ?? '',
      ),
      text: document.body.innerText,
    }));
    expect(said.title).toContain('Stadiomind');
    for (const words of [said.title, ...said.metas, ...said.data, said.text]) {
      expect(words).not.toContain('FMIP');
    }
  });
}

test('the header says the name beside the mark', async ({ page }) => {
  await page.goto('/en/scores');
  await expect(page.getByTestId('nav-home')).toHaveText('Stadiomind');
});
