import { expect, test } from '@playwright/test';

/**
 * The desktop header with the language link as production draws it
 * (T-1534): with the API behind the web app the second language is offered,
 * so the bar carries «فارسی» on an English page and "English" on a Persian
 * one, and it stays one 64px row at 1024, 1280 and 1350px. The web-only
 * project checks the same with the link put in by hand and in both faces
 * (`header-row.spec.ts`).
 */

for (const width of [1024, 1280, 1350]) {
  for (const [locale, other] of [
    ['en', 'fa'],
    ['fa', 'en'],
  ] as const) {
    test(`at ${width}px /${locale} draws the ${other} link and keeps the header one row`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/scores`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId(`language-${other}`)).toBeVisible();
      const bar = page.locator('header nav').first();
      expect((await bar.boundingBox())?.height).toBe(64);
      const centre = async (id: string) => {
        const box = (await page.getByTestId(id).boundingBox())!;
        return box.y + box.height / 2;
      };
      const home = await centre('nav-home');
      for (const id of ['nav-matches', 'nav-more', `language-${other}`, 'nav-sign-in']) {
        expect(Math.abs((await centre(id)) - home), id).toBeLessThanOrEqual(2);
      }
    });
  }
}
