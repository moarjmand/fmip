import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/** The WCAG levels every page is held to, as elsewhere. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * The Persian pass (T-1501) over the six rebuilt Stadiomind pages on `/fa`,
 * with the API and the seed behind them, on a 390 px phone and a 1440 px
 * desktop. Each page's own journey checks its modules; this checks what a
 * Persian reader sees on every one of them:
 *
 * - a right-to-left Persian document, drawn in Vazirmatn (lite mode off, so
 *   the web fonts are used), with the founder's voice in Markazi Text;
 * - every figure in Persian digits: no ASCII digit in the page's visible text
 *   except where it is not ours to change -- a left-to-right run (`dir=ltr`),
 *   the model's version string, and text an outside publisher wrote;
 * - the phone's five tabs and the desktop header's sections mirrored: the
 *   first one at the inline start, which on this page is the right (the
 *   competition pills were the matchday rail's until T-1642, D-300);
 * - no sideways scroll of the page itself.
 *
 * Where each score sits beside its own team is checked geometrically in
 * `rtl-content.spec.ts` and the matches and match-centre journeys.
 */

const PAGES = [
  { name: 'home', path: '/fa' },
  { name: 'matches', path: '/fa/scores?date=2025-01-05&tz=UTC' },
  { name: 'match centre', path: '/fa/match/00000000-0000-4000-8000-000000000901' },
  { name: 'competition', path: '/fa/competition/00000000-0000-4000-8000-000000000201' },
  { name: 'club', path: '/fa/team/00000000-0000-4000-8000-000000000601' },
  { name: 'player', path: '/fa/player/00000000-0000-4000-8000-000000000701' },
] as const;

/** Text an outside publisher wrote: a story's title, a clip's caption, their credits. */
const OUTSIDE_TEXT = [
  '[data-testid="home-story"]',
  '[data-testid="related-story"]',
  '[data-testid="entity-news"]',
  '[data-testid="breaking-story"]',
].join(',');

/** Visible text in the page's main region holding an ASCII digit it should not. */
async function asciiDigits(page: Page, outside: string): Promise<string[]> {
  return page.evaluate((outsideText) => {
    const found: string[] = [];
    const root = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const element = node.parentElement;
      if (element === null || element.closest('script, style, [dir="ltr"]')) continue;
      if (element.closest(outsideText)) continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // The model's version is an identifier (`dixon-coles-elo@0.6.0`), drawn
      // as `ModelVersion` writes it: the name, an "@" and the number.
      const context = element.closest('p, li, div, section')?.textContent ?? '';
      const text = (node.textContent ?? '').trim();
      if (/^@?\d+(\.\d+){2}$/.test(text) && context.includes('@')) continue;
      if (/[0-9]/.test(text.replace(/[a-z-]+@\d+(\.\d+){2}/g, ''))) found.push(text.slice(0, 60));
    }
    return found;
  }, outside);
}

/** The inline-start edge of each visible link or button in a bar, in order. */
async function itemEdges(page: Page, testId: string): Promise<number[]> {
  return page
    .getByTestId(testId)
    .locator('a, button')
    .evaluateAll((items) =>
      items
        .map((item) => item.getBoundingClientRect())
        .filter((box) => box.width > 0)
        .map((box) => Math.round(box.right)),
    );
}

for (const width of [390, 1440]) {
  test.describe(`/fa at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: 'fmip_lite', value: 'off', url: baseURL ?? '' }]);
    });

    for (const { name, path } of PAGES) {
      test(`the ${name} reads as a Persian page`, async ({ page }) => {
        await page.goto(path);
        const html = page.locator('html');
        await expect(html).toHaveAttribute('lang', 'fa');
        await expect(html).toHaveAttribute('dir', 'rtl');
        await expect(html).toHaveAttribute('data-lite', 'off');
        await page.evaluate(() => document.fonts.ready);

        const face = await page
          .locator('main')
          .evaluate((main) => getComputedStyle(main).fontFamily.split(',')[0]);
        expect(face).toContain('Vazirmatn');
        const founder = page.locator('[data-voice="founder"] p').first();
        if ((await founder.count()) > 0) {
          expect(
            await founder.evaluate((title) => getComputedStyle(title).fontFamily.split(',')[0]),
          ).toContain('Markazi Text');
        }

        expect(await asciiDigits(page, OUTSIDE_TEXT)).toEqual([]);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(0);

        // The first tab or section at the right, each next one further left.
        const bar = width < 768 ? 'tab-bar' : 'primary-nav';
        const edges = await itemEdges(page, bar);
        expect(edges.length).toBeGreaterThan(1);
        expect(edges).toEqual([...edges].sort((a, b) => b - a));
      });
    }
  });
}

/**
 * The header's language picker leads to the same page in the other language,
 * its query kept (T-1572): a reader who switches loses neither the day nor
 * the filters. The picker is drawn only when the API says Persian is
 * offered, which is why this lives with the journeys. Since D-281 it is the
 * globe and the page's language in short, opening a list of every offered
 * language in its own name, the page's own marked current.
 */
test('the language picker keeps the page and its query', async ({ page }) => {
  await page.goto('/en/scores?date=2025-01-05&tz=UTC');
  const toggle = page.getByTestId('language-toggle');
  await expect(toggle).toContainText('EN');
  await toggle.click();
  await expect(page.getByTestId('language-en')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('language-en')).toHaveText('English');
  const fa = page.getByTestId('language-fa');
  await expect(fa).toHaveText('فارسی');
  await expect(fa).toHaveAttribute('href', '/fa/scores?date=2025-01-05&tz=UTC');
  await fa.click();
  await expect(page).toHaveURL(/\/fa\/scores\?date=2025-01-05&tz=UTC$/);
  await expect(page.getByTestId('language-toggle')).toContainText('فا');
  await expect(page.getByTestId('language-en')).toHaveAttribute(
    'href',
    '/en/scores?date=2025-01-05&tz=UTC',
  );
  // It closed on the way.
  await expect(page.getByTestId('language-en')).toBeHidden();
});

test('the language picker answers the keyboard and a screen reader', async ({ page }) => {
  await page.goto('/en/scores');
  const toggle = page.getByTestId('language-toggle');
  // Named by the word and the language, not by the letters it shows.
  await expect(toggle).toHaveAccessibleName(/Language\s*English/);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('language-fa')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('language-en')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('language-fa')).toBeHidden();
  await expect(toggle).toBeFocused();
  // A click elsewhere closes it too.
  await toggle.click();
  await expect(page.getByTestId('language-fa')).toBeVisible();
  await page.getByTestId('title').click();
  await expect(page.getByTestId('language-fa')).toBeHidden();
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
});

test('on a phone the picker is in the Menu, 44px, and the footer offers the languages too', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/fa/scores');
  await page.getByTestId('nav-menu').locator(':scope > summary').click();
  const toggle = page.getByTestId('language-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toContainText('زبان');
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await toggle.click();
  const en = page.getByTestId('language-en');
  expect((await en.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await en.click();
  await expect(page).toHaveURL(/\/en\/scores$/);
  // The Menu closed with it.
  await expect(page.getByTestId('language-toggle')).toBeHidden();
  const footer = page.getByTestId('footer-language-fa');
  await expect(footer).toHaveAttribute('href', '/fa/scores');
  await expect(page.getByTestId('footer-language-en')).toHaveAttribute('aria-current', 'page');
});
