import { expect, test } from '@playwright/test';
import { member, registerAndVerify } from './members';

/**
 * What a new member sees first (T-1964, D-467): the end of the first run is
 * "Not picked yet" (`registerAndVerify` asserts the landing), and on a phone
 * every chip of its filter row is whole, in English and in Persian. Before,
 * a member's four views shared a line with Date and Filters and the current
 * one, "Not picked yet", was cut ("Not pi…").
 */

const RUN = Date.now().toString(36);

test.use({ viewport: { width: 375, height: 812 } });

test('a new member’s filter row at 375 px has no chip cut, in English and in Persian', async ({
  page,
}) => {
  await registerAndVerify(page, member(RUN, 'chips375', 'Chip Reader'));

  for (const locale of ['en', 'fa']) {
    await page.goto(`/${locale}/scores?unpicked=1`);
    const row = page.getByTestId('filter-row');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('view-unpicked')).toHaveAttribute('aria-current', 'true');
    const chips = await row.evaluate((el) => {
      const nav = el.querySelector<HTMLElement>('[data-testid="filters"]')!;
      const box = nav.getBoundingClientRect();
      const found = [
        ...el.querySelectorAll<HTMLElement>(
          '[data-testid^="view-"], [data-testid="date-chip"], [data-testid="filters-chip"]',
        ),
      ].filter((chip) => chip.getClientRects().length > 0);
      return {
        nav: { scroll: nav.scrollWidth, client: nav.clientWidth },
        viewport: document.documentElement.clientWidth,
        chips: found.map((chip) => {
          const r = chip.getBoundingClientRect();
          const inNav = nav.contains(chip);
          return {
            id: chip.dataset.testid,
            scroll: chip.scrollWidth,
            client: chip.clientWidth,
            start: r.left,
            end: r.right,
            within: !inNav || (r.left >= box.left - 0.5 && r.right <= box.right + 0.5),
          };
        }),
      };
    });
    expect(chips.chips.map((c) => c.id)).toEqual(
      expect.arrayContaining(['view-all', 'view-live', 'view-unpicked', 'view-mine', 'date-chip']),
    );
    expect(chips.nav.scroll, `${locale}: the views' row scrolls`).toBeLessThanOrEqual(
      chips.nav.client,
    );
    for (const chip of chips.chips) {
      expect(chip.scroll, `${locale} ${chip.id}: its words are cut`).toBeLessThanOrEqual(
        chip.client,
      );
      expect(chip.within, `${locale} ${chip.id}: outside its row`).toBe(true);
      expect(chip.start, `${locale} ${chip.id}`).toBeGreaterThanOrEqual(0);
      expect(chip.end, `${locale} ${chip.id}`).toBeLessThanOrEqual(chips.viewport);
    }
  }
});
