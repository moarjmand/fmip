import { type Page, expect, test } from '@playwright/test';

/**
 * A box that scrolls sideways keeps what it holds, screen-reader text
 * included, on a 375px phone in both directions (T-1860).
 *
 * The competition page on /fa at 375px scrolled sideways by 40px (finding
 * qa-2026-11-10-01): the standings table is wider than its `scroll-cue` box,
 * and its Form cells, which start off the screen's left edge in Persian, each
 * carry an `sr-only` read-out (`FormSquares`). `sr-only` is absolutely
 * positioned, the cell is static, and the box was not positioned, so the
 * read-out took its containing block from the page: the box neither scrolled
 * nor clipped it and the page grew to hold it. In English the Form cell
 * starts inside the screen, so nothing showed.
 *
 * This build has no API, so no table: the table's box is drawn here as
 * `StandingsTable` draws it (the card that clips, the `scroll-cue` box, a
 * sticky place cell, cells wider than the phone, a caption and a Form cell
 * with its `sr-only` line), inside the real page and its production CSS.
 */

const LOCALES = [
  { locale: 'en', dir: 'ltr' },
  { locale: 'fa', dir: 'rtl' },
  { locale: 'x-rtl', dir: 'rtl' },
] as const;

/** The standings card as `StandingsTable` draws it, wider than a phone. */
async function drawWideTable(page: Page): Promise<void> {
  await page.locator('main').evaluate((main) => {
    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className: string,
      text = '',
    ): HTMLElementTagNameMap[K] => {
      const node = document.createElement(tag);
      node.className = className;
      node.textContent = text;
      return node;
    };
    const card = el('section', 'flex min-w-0 flex-col overflow-hidden');
    const box = el('div', 'scroll-cue overflow-x-auto');
    box.dataset.testid = 'probe-scroll';
    const table = el('table', 'w-full border-separate border-spacing-0 text-sm tabular-nums');
    table.append(el('caption', 'sr-only', 'League table'));
    const body = el('tbody', '');
    for (let row = 1; row <= 3; row += 1) {
      const tr = el('tr', '');
      const place = el('td', 'sticky start-0 z-1 bg-surface', String(row));
      tr.append(place);
      // Nine columns of numbers: wider than a 375px phone, as the table is.
      for (let col = 0; col < 9; col += 1) {
        const cell = el('td', 'px-1.5 py-2.5', '10');
        cell.style.minInlineSize = '2.75rem';
        tr.append(cell);
      }
      const form = el('td', 'pe-4');
      form.append(el('span', 'sr-only', 'Won, won, drawn, lost, won'));
      const squares = el('span', 'inline-flex', 'WWDLW');
      squares.setAttribute('aria-hidden', 'true');
      form.append(squares);
      tr.append(form);
      body.append(tr);
    }
    table.append(body);
    box.append(table);
    card.append(box);
    main.prepend(card);
  });
}

test.describe('a sideways-scrolling box on a 375px phone (T-1860)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const { locale, dir } of LOCALES) {
    test(`${locale}: holds its screen-reader text, and the page does not scroll sideways`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/competitions`);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await drawWideTable(page);

      // The table does overflow its box: the case under test.
      const box = page.getByTestId('probe-scroll');
      const [inner, outer] = await box.evaluate((b) => [b.scrollWidth, b.clientWidth]);
      expect(inner).toBeGreaterThan(outer);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
