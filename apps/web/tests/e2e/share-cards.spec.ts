import { expect, test } from '@playwright/test';

/**
 * The share cards (T-520) are drawn, not just linked (T-1505). Each page's
 * `og:image` was answered 500 on production because the image routes were
 * rendered as static ones while the API client reads the request's headers.
 * CI runs the web app without an API, so every card here is the plain one --
 * still a picture, which is the point: a chat app shows nothing for a 500.
 */
test.use({ javaScriptEnabled: false });

const PAGES = [
  '/en/match/00000000-0000-4000-8000-000000000901',
  '/en/competition/00000000-0000-4000-8000-000000000101',
  '/en/u/someone',
  // The Persian pages' cards (T-1506): drawn in English, never a 502.
  '/fa/match/00000000-0000-4000-8000-000000000901',
  '/fa/competition/00000000-0000-4000-8000-000000000101',
  '/fa/u/someone',
];

test.describe('share cards', () => {
  for (const path of PAGES) {
    test(`${path} links a card that is served as a PNG`, async ({ page, request }) => {
      await page.goto(path);
      const content = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(content).toBeTruthy();

      // The meta tag carries the public origin (siteUrl); the card is fetched
      // from the server under test.
      const card = new URL(content ?? '');
      const response = await request.get(`${card.pathname}${card.search}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
      expect((await response.body()).subarray(1, 4).toString()).toBe('PNG');
    });
  }
});
