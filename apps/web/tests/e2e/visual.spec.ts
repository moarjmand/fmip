import { expect, test } from '@playwright/test';

/**
 * The visual baseline of the Stadiomind pages (T-1502, D-264): every rebuilt
 * page in Night and Day, at a desktop width and at 390 px, compared with the
 * committed pictures on every CI run. Against the production build without an
 * API, like the rest of this project, so a page is drawn in its honest
 * unreachable state; that state is what a reader sees when the API is down,
 * and it carries the whole shell, the type and the colours.
 *
 * A picture is only worth comparing if it is the same every time:
 * - both clocks are fixed: the browser's here, the server's by
 *   `fixed-clock.cjs` (the server writes "today" into the scores day strip,
 *   the date picker and the home page's date line), and the spec runs only
 *   with it: CI's E2E job runs it as its own step, "Visual baseline";
 * - motion is reduced and Playwright stops animations and hides the caret;
 * - every font is loaded before the shot, and lite mode (which swaps the web
 *   fonts for system faces) is off;
 * - the browser's language and time zone are set, and the service worker is
 *   blocked.
 *
 * The pictures are Linux renders, made by CI's runner (or the Playwright
 * image of the same version): a Windows or macOS render differs in its
 * anti-aliasing, so on any other platform the spec is skipped. To remake them
 * after an intended change, see docs/08-load-test.md, "Visual baseline".
 */

const MATCH = '00000000-0000-4000-8000-000000000901';

const PAGES = [
  { name: 'home', path: '/en' },
  { name: 'scores', path: '/en/scores' },
  { name: 'match', path: `/en/match/${MATCH}` },
  { name: 'competition', path: '/en/competition/00000000-0000-4000-8000-000000000201' },
  { name: 'team', path: '/en/team/00000000-0000-4000-8000-000000000601' },
  { name: 'player', path: '/en/player/00000000-0000-4000-8000-000000000701' },
  // The About page's diagram, drawn still as reduced motion draws it (T-1615).
  { name: 'about', path: '/en/about' },
] as const;

const VIEWS = [
  { name: 'night', theme: 'dark', viewport: { width: 1280, height: 800 } },
  { name: 'day', theme: 'light', viewport: { width: 1280, height: 800 } },
  { name: 'night-390', theme: 'dark', viewport: { width: 390, height: 844 } },
  { name: 'day-390', theme: 'light', viewport: { width: 390, height: 844 } },
] as const;

/** A Saturday evening in UTC, the same instant `fixed-clock.cjs` starts the server at. */
const CLOCK = new Date('2026-10-24T18:00:00Z');

// Playwright's web server inherits this process's environment, so the
// server's clock is fixed exactly when this one is.
const FIXED_SERVER_CLOCK = (process.env.NODE_OPTIONS ?? '').includes('fixed-clock.cjs');

test.skip(process.platform !== 'linux', 'the baselines are Linux renders');
test.skip(
  !FIXED_SERVER_CLOCK,
  'needs NODE_OPTIONS=--require=<absolute path of tests/e2e/fixed-clock.cjs>',
);

test.use({
  serviceWorkers: 'block',
  reducedMotion: 'reduce',
  locale: 'en-GB',
  timezoneId: 'Europe/London',
});

for (const view of VIEWS) {
  test.describe(`${view.name} at ${view.viewport.width}px`, () => {
    test.use({ viewport: view.viewport, colorScheme: view.theme });

    test.beforeEach(async ({ context, page, baseURL }) => {
      const url = baseURL ?? '';
      await context.addCookies([
        { name: 'fmip_theme', value: view.theme, url },
        { name: 'fmip_lite', value: 'off', url },
        { name: 'fmip_motion', value: 'reduce', url },
      ]);
      await page.clock.setFixedTime(CLOCK);
    });

    for (const { name, path } of PAGES) {
      test(`${name} (${path})`, async ({ page }) => {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', view.theme);
        await expect(page.locator('html')).not.toHaveAttribute('data-lite', 'on');
        // Every face the page asked for, loaded: a shot taken on a fallback
        // face would differ from the next one by every glyph.
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.fonts.status)).toBe('loaded');

        await expect(page).toHaveScreenshot(`${name}-${view.name}.png`, {
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          // Two renders on the same runner image agree to the pixel; this
          // leaves room for a glyph's anti-aliasing and nothing larger.
          maxDiffPixelRatio: 0.002,
        });
      });
    }
  });
}
