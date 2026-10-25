import { type Page, expect, test } from '@playwright/test';

/**
 * The Stadiomind match centre on the seed's played match (T-1497), in
 * English, Persian and the right-to-left pseudo-locale, on a phone (390px)
 * and a desktop (1440px). The seed holds the score and nothing else, so the
 * board is mostly its honest states: the Summary card says the model had no
 * forecast before kick-off, every module states its coverage, and nothing is
 * drawn that the data does not hold (rule 3). The unit specs
 * (`match-centre-stadiomind.spec.tsx`) render the full and live boards.
 */

const PLAYED_MATCH = '00000000-0000-4000-8000-000000000901';

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  expect(b).not.toBeNull();
  return b ?? { x: 0, y: 0, width: 0, height: 0 };
};

for (const locale of ['en', 'fa', 'x-rtl'] as const) {
  const rtl = locale !== 'en';
  for (const width of [390, 1440] as const) {
    test.describe(`/${locale} at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('opens on the score band, the Summary card and the section tabs', async ({ page }) => {
        await page.goto(`/${locale}/match/${PLAYED_MATCH}`);
        await expect(page.locator('html')).toHaveAttribute('dir', rtl ? 'rtl' : 'ltr');
        const header = page.getByTestId('match-header');
        await expect(header).toBeVisible();
        // The seed's 2-2, each side's goals beside it; Persian digits on /fa.
        await expect(page.getByTestId('score')).toHaveText(locale === 'fa' ? /۲.*۲/ : /2.*2/);
        await expect(header.getByTestId('match-status')).toBeVisible();
        // Full time: no live badge, no live line.
        await expect(page.getByTestId('live-badge')).toHaveCount(0);
        // The Summary opens with the model's card; the seed has no version,
        // so it says the model had no forecast before kick-off.
        const card = page.getByTestId('forecast-reality');
        await expect(card).toBeVisible();
        await expect(card).not.toHaveAttribute('data-state', 'available');
        await expect(page.getByTestId('timeline')).toBeVisible();
        // The section tabs, at every width, inside the band.
        const nav = header.getByTestId('section-nav');
        await expect(nav).toBeVisible();
        await expect(nav.locator('[data-tab-link="summary"]')).toBeVisible();
        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
      });

      if (width === 1440) {
        test('lays out a main and a side column, mirrored on a right-to-left page', async ({
          page,
        }) => {
          await page.goto(`/${locale}/match/${PLAYED_MATCH}`);
          const main = await box(page, '[data-column="main"]');
          const side = await box(page, '[data-column="side"]');
          // Side by side, the side column at the inline end.
          expect(Math.abs(main.y - side.y)).toBeLessThan(2);
          if (rtl) expect(side.x + side.width).toBeLessThanOrEqual(main.x + 1);
          else expect(side.x).toBeGreaterThanOrEqual(main.x + main.width - 1);
          // The data footer states every module's coverage.
          await expect(page.getByTestId('coverage')).toBeVisible();
          // The home side at the inline start of the band.
          const home = await box(page, '[data-testid="home-team"]');
          const away = await box(page, '[data-testid="away-team"]');
          if (rtl) expect(home.x).toBeGreaterThan(away.x);
          else expect(home.x).toBeLessThan(away.x);
        });
      } else {
        test('shows one tab at a time, the side column’s sections under the Summary', async ({
          page,
        }) => {
          await page.goto(`/${locale}/match/${PLAYED_MATCH}`);
          const nav = page.getByTestId('section-nav');
          // The past meetings sit in the side column, and on a phone in the Summary.
          await expect(page.getByTestId('head-to-head')).toBeVisible();
          await expect(page.getByTestId('statistics')).toBeHidden();
          await nav.locator('[data-tab-link="stats"]').click();
          await expect(page.getByTestId('statistics')).toBeVisible();
          await expect(page.getByTestId('head-to-head')).toBeHidden();
          await expect(page.getByTestId('forecast-reality')).toBeHidden();
          // The data footer is on every tab.
          await expect(page.getByTestId('coverage')).toBeVisible();
          await nav.locator('[data-tab-link="lineups"]').click();
          await expect(page.getByTestId('lineups')).toBeVisible();
          expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
        });
      }
    });
  }
}
