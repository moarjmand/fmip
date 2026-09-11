import { expect, test } from '@playwright/test';

/**
 * Installability (T-082, D-042): the manifest with the fields Android needs,
 * the icons it points at, the service worker registering and serving the
 * honest offline page when the network is gone. What cannot be automated —
 * tapping "Install" on a phone — is a device check for the maintainer.
 */
test.describe('progressive web app', () => {
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
