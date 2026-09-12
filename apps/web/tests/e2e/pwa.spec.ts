import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, expect, test, type BrowserContext } from '@playwright/test';

/**
 * Installability (T-082, D-042): the manifest with the fields Android needs,
 * the icons it points at, the service worker registering and serving the
 * honest offline page when the network is gone — and Chrome's own decision to
 * offer "Install", taken by the real browser on a phone-sized viewport. What
 * that leaves for a real phone is the tap itself.
 */
test.describe('progressive web app', () => {
  test('Chrome itself would offer to install it on a phone', async () => {
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
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
      });
      await page.reload();
      // Chrome fires beforeinstallprompt once every criterion is met.
      await expect(page.locator('html')).toHaveAttribute('data-install-prompt', 'offered', {
        timeout: 15_000,
      });
      const cdp = await context.newCDPSession(page);
      const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
      expect(installabilityErrors).toEqual([]);
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
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });
    expect(scope).toMatch(/\/$/);
    // Let the install step finish caching the shell.
    await page.waitForFunction(async () => {
      const cache = await caches.open('fmip-shell-v1');
      return (await cache.match('/en/offline')) !== undefined;
    });

    await context.setOffline(true);
    await page.goto('/en/scores');
    await expect(page.getByTestId('offline-message')).toBeVisible();
    await expect(page.getByTestId('title')).toHaveText('You are offline');
    await context.setOffline(false);
  });
});
