import { expect, test } from '@playwright/test';

/**
 * The desktop header with the language picker as production draws it
 * (T-1534; the globe, T-1610, D-281): with the API behind the web app the
 * second language is offered, so the bar carries the globe and the page's
 * language in short ("EN", «فا»), and it stays one 64px row at 1024, 1280
 * and 1350px. The web-only project checks the same with the picker put in
 * by hand and in both faces (`header-row.spec.ts`).
 */

for (const width of [1024, 1280, 1350]) {
  for (const [locale, other, short] of [
    ['en', 'fa', 'EN'],
    ['fa', 'en', 'فا'],
  ] as const) {
    test(`at ${width}px /${locale} draws the language picker and keeps the header one row`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/scores`);
      await page.evaluate(() => document.fonts.ready);
      const toggle = page.getByTestId('language-toggle');
      await expect(toggle).toBeVisible();
      await expect(toggle).toContainText(short);
      // Closed until asked: the other language is in the page, not on it.
      await expect(page.getByTestId(`language-${other}`)).toBeHidden();
      const bar = page.locator('header nav').first();
      expect((await bar.boundingBox())?.height).toBe(64);
      const centre = async (id: string) => {
        const box = (await page.getByTestId(id).boundingBox())!;
        return box.y + box.height / 2;
      };
      const home = await centre('nav-home');
      for (const id of [
        'nav-matches',
        'nav-highlights',
        'nav-more',
        'language-toggle',
        'nav-sign-in',
      ]) {
        expect(Math.abs((await centre(id)) - home), id).toBeLessThanOrEqual(2);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(0);
    });
  }
}
