import { expect, test } from '@playwright/test';

/**
 * The SEO surface (T-039) with JavaScript switched off: what a crawler gets
 * is the rendered HTML, so the content, the canonical link, the language
 * alternates, the robots rule and the structured data all have to be in it.
 * CI runs the web app without an API, so these pages show their honest
 * "unreachable" state — still rendered, still indexable, still complete.
 */
test.use({ javaScriptEnabled: false });

test.describe('SEO surface without JavaScript', () => {
  test('a page carries its content, canonical URL and language alternates', async ({ page }) => {
    await page.goto('/en/scores');

    await expect(page.getByTestId('title')).toHaveText('Scores');
    await expect(page.getByTestId('nav-scores')).toBeVisible();
    await expect(page.getByTestId('nav-leaderboard')).toBeVisible();
    await expect(page.getByTestId('nav-search')).toBeVisible();
    // The honest state is rendered server-side, not filled in by a script.
    await expect(page.getByRole('alert')).toBeVisible();

    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /\/en\/scores$/);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      'href',
      /\/en\/scores$/,
    );
    await expect(page.locator('link[rel="alternate"][hreflang="x-rtl"]')).toHaveCount(0);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      'content',
      /\/en\/scores$/,
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index/);
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
  });

  test('the pseudo-locale and a member page are not indexed', async ({ page }) => {
    await page.goto('/x-rtl/scores');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await page.goto('/en/search?q=real');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await page.goto('/en/search');
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute('content', /noindex/);
  });

  test('the home page carries the site structured data', async ({ page }) => {
    await page.goto('/en');
    const scripts = page.locator('script[type="application/ld+json"]');
    await expect(scripts).toHaveCount(1);
    const data = JSON.parse((await scripts.first().textContent()) ?? '{}') as {
      '@type': string;
      potentialAction: { target: { urlTemplate: string } };
    };
    expect(data['@type']).toBe('WebSite');
    expect(data.potentialAction.target.urlTemplate).toMatch(
      /\/en\/search\?q=\{search_term_string\}$/,
    );
  });

  test('robots.txt and the sitemap are served', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const robotsText = await robots.text();
    expect(robotsText).toContain('Disallow: /x-rtl/');
    expect(robotsText).toContain('Disallow: /api/');
    expect(robotsText).toMatch(/Sitemap: .*\/sitemap\.xml/);

    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()['content-type']).toContain('xml');
    const xml = await sitemap.text();
    expect(xml).toContain('/en/scores</loc>');
    expect(xml).toContain('/en/leaderboard</loc>');
    expect(xml).not.toContain('/x-rtl/');
  });
});
