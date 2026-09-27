import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Until the service worker is activated and this page is under its control.
 *
 * `navigator.serviceWorker.ready` is not that: it resolves as soon as the
 * registration has an active worker, which includes one still *activating*
 * (running `clients.claim()`), and it never rejects -- so a worker that failed
 * to install hung the test until the test timeout, which named no step. The
 * registration happens after hydration, so the first load is never controlled;
 * a reload once the worker is activated is. Each wait is bounded and says what
 * it was waiting for.
 */
async function controlledByServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? 'none';
        }),
      { message: 'the service worker is activated', timeout: 15_000 },
    )
    .toBe('activated');
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      message: 'the page is controlled by the service worker',
      timeout: 15_000,
    })
    .toBe(true);
}

/**
 * Installability (T-082, D-042): the manifest with the fields Android needs,
 * the icons it points at, the service worker registering and serving the
 * honest offline page when the network is gone — and Chrome's own decision to
 * offer "Install", taken by the real browser on a phone-sized viewport. What
 * that leaves for a real phone is the tap itself.
 */
test.describe('progressive web app', () => {
  test('Chrome itself would offer to install it on a phone', async () => {
    // A real Google Chrome with a fresh profile, a service worker installing
    // its shell and Chrome's own install check: the default 30s was spent
    // before the last wait could finish on a CI runner (run 36356718113 timed
    // out with no step named). The waits below are each bounded; this is the
    // budget for all of them together.
    test.setTimeout(60_000);
    // Google Chrome (channel "chrome"), not Playwright's headless shell: only
    // the full browser runs the install-banner machinery that decides this,
    // and only outside incognito, hence a persistent context. The flag skips
    // Chrome's "has the user visited enough" heuristic, nothing else. Checked
    // against a blocked manifest while writing this: the errors then read
    // `no-manifest` and `manifest-parsing-or-network-error`, so an empty list
    // is a verdict, not a default.
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fmip-pwa-')), {
        channel: 'chrome',
        args: ['--bypass-app-banner-engagement-checks'],
        ...devices['Pixel 7'],
        baseURL: test.info().project.use.baseURL,
      });
    } catch (error) {
      test.skip(true, `Google Chrome is not installed here: ${String(error).split('\n')[0]}`);
      return;
    }
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.addInitScript(() => {
        window.addEventListener('beforeinstallprompt', () => {
          document.documentElement.dataset['installPrompt'] = 'offered';
        });
      });
      await page.goto('/en');
      // The decision needs a service worker in control of the page.
      await controlledByServiceWorker(page);
      // Chrome's verdict, asked for rather than waited on: an empty list once
      // every criterion is met on this load, the missing criterion otherwise.
      const cdp = await context.newCDPSession(page);
      await expect
        .poll(
          async () =>
            (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map(
              (e) => e.errorId,
            ),
          { message: 'Chrome finds nothing missing for an install', timeout: 15_000 },
        )
        .toEqual([]);
      // ...and it offers the install to the page.
      await expect(page.locator('html')).toHaveAttribute('data-install-prompt', 'offered', {
        timeout: 10_000,
      });
    } finally {
      await context.close();
    }
  });

  test('the manifest has what an install needs and its icons are served', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('manifest');
    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
      theme_color: string;
    };
    expect(manifest.name).toContain('FMIP');
    expect(manifest.short_name).toBe('FMIP');
    expect(manifest.start_url).toBe('/en/scores');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const image = await request.get(icon.src);
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()['content-type']).toContain('image/png');
    }
  });

  test('the page links the manifest, the theme colour and the apple icon', async ({ page }) => {
    await page.goto('/en');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b6b3a');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/icons/apple-touch-icon.png',
    );
  });

  test('the service worker registers and shows the offline page without a network', async ({
    page,
    context,
  }) => {
    await page.goto('/en');
    // Activated, not merely `ready`: a navigation offline is answered only by
    // a worker that is active, and the offline page only from a finished
    // install. Waiting on the cache alone raced an install still in progress.
    await controlledByServiceWorker(page);
    const scope = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistration())?.scope ?? '',
    );
    expect(scope).toMatch(/\/$/);
    // The shell is cached. Any cache: the worker's cache name carries a
    // version that changes with the shell (sw.js).
    expect(await page.evaluate(async () => (await caches.match('/en/offline')) !== undefined)).toBe(
      true,
    );

    await context.setOffline(true);
    await page.goto('/en/scores');
    await expect(page.getByTestId('offline-message')).toBeVisible();
    await expect(page.getByTestId('title')).toHaveText('You are offline');
    await context.setOffline(false);
  });
});
