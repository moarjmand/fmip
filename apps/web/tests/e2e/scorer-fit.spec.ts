import { type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The match band never widens the page on a phone, in either direction
 * (T-1947, finding qa-2026-11-20-01).
 *
 * The Persian page of Seattle Sounders v Real Salt Lake (1-1, 2-4 on
 * penalties) scrolled sideways at 375px. Two things met there. The line
 * under the score, "پنالتی ۲–۴ · ۹۰ دقیقه ۱–۱ · نیمه‌ی اول ۱–۰", was one line
 * as wide as its words, and the band's middle column grew to hold it, which
 * left each side well under 100px. And a scorer's unit, "M. Guilavogui ۶۳′",
 * was one line that never wraps (T-1796, D-395) with nothing holding it to
 * its column, so on the away side it stuck out past the page's end edge. The
 * English page was fine: its line under the score is shorter and Archivo is
 * narrower than Vazirmatn.
 *
 * This build has no API, so no match. The band is the real one all the same:
 * `src/components/match-band-fit.spec.tsx` renders `MatchCentreView` with
 * that match's facts and keeps its `<header>` in `fixtures/match-band/`,
 * failing when the component no longer draws what is kept. Here each kept
 * band is put inside the real page and its production CSS.
 */

type Locale = 'en' | 'fa';
const band = (name: string, locale: Locale) =>
  readFileSync(join(__dirname, 'fixtures', 'match-band', `${name}-${locale}.txt`), 'utf8');

async function draw(page: Page, name: string, locale: Locale): Promise<void> {
  await page.goto(`/${locale}/competitions`);
  await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
  await page.locator('main').evaluate(
    (main, header) => {
      // The match page's `main` and frame (`app/[locale]/match/[id]/page.tsx`),
      // in place of this page's own.
      main.className = 'min-h-dvh bg-stage pb-8';
      main.innerHTML = `<div class="page-frame flex flex-col">${header}</div>`;
    },
    band(name, locale),
  );
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('match-header')).toBeVisible();
}

/** How far each part of each scorer's line sticks out of its side's column. */
const scorersOutside = (page: Page) =>
  page.evaluate(() =>
    (['home', 'away'] as const).flatMap((side) => {
      const column = document
        .querySelector(`[data-testid="${side}-team"]`)!
        .getBoundingClientRect();
      const line = document.querySelector(`[data-testid="scorers-${side}"]`)!;
      return [...line.querySelectorAll('span, bdi')].map((part) => {
        const box = part.getBoundingClientRect();
        return Math.max(column.left - box.left, box.right - column.right, 0);
      });
    }),
  );

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * The line under the score as it is drawn: its visible boxes, items and
 * separators, row by row from the inline start, and how many lines of text
 * each item takes.
 */
const statusRows = (page: Page) =>
  page.evaluate(() => {
    const line = document.querySelector('[data-testid="match-header"] [data-status-line]')!;
    const rtl = getComputedStyle(line).direction === 'rtl';
    const boxes = [...line.querySelectorAll('[data-status-item], [data-status-separator]')]
      .map((el) => ({
        kind: el.hasAttribute('data-status-item') ? 'item' : 'separator',
        box: el.getBoundingClientRect(),
        lineHeight: parseFloat(getComputedStyle(el).lineHeight),
      }))
      .filter((b) => b.box.width > 0 && b.box.height > 0);
    const rows = new Map<number, typeof boxes>();
    for (const b of boxes) {
      // Boxes whose middles are within half a line of each other share a row.
      const middle = b.box.top + b.box.height / 2;
      const key = [...rows.keys()].find((k) => Math.abs(k - middle) < b.lineHeight / 2) ?? middle;
      rows.set(key, [...(rows.get(key) ?? []), b]);
    }
    return {
      items: boxes.filter((b) => b.kind === 'item').length,
      itemLines: boxes.filter((b) => b.kind === 'item').map((b) => b.box.height / b.lineHeight),
      rows: [...rows.values()].map((row) =>
        row
          .sort((a, b) => (rtl ? b.box.right - a.box.right : a.box.left - b.box.left))
          .map((b) => b.kind),
      ),
    };
  });

/** Each side's column, in px. */
const columns = (page: Page) =>
  page.evaluate(() =>
    ['home', 'away'].map(
      (side) =>
        document.querySelector(`[data-testid="${side}-team"]`)!.getBoundingClientRect().width,
    ),
  );

for (const width of [375, 320]) {
  test.describe(`the match band on a ${width}px phone (T-1947)`, () => {
    test.use({ viewport: { width, height: 812 } });

    for (const locale of ['fa', 'en'] as const) {
      test(`${locale}: the reported match does not scroll sideways, and each scorer stays in his column`, async ({
        page,
      }) => {
        await draw(page, 'reported', locale);
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        for (const out of await scorersOutside(page)) expect(out).toBeLessThanOrEqual(0.5);
      });

      test(`${locale}: the line under a shoot-out's score is whole items, no separator at a row's edge`, async ({
        page,
      }) => {
        await draw(page, 'reported', locale);
        const rows = await statusRows(page);
        // "Pens 2–4", "90 minutes 1–1", "HT 1–0": more than one row here.
        expect(rows.items).toBe(3);
        expect(rows.rows.length).toBeGreaterThanOrEqual(2);
        // Each item is on one row, its score beside its words.
        for (const lines of rows.itemLines) expect(lines).toBeLessThan(1.5);
        // No row starts or ends with a separator: beside Persian digits a
        // middle dot reads as a zero.
        for (const row of rows.rows) {
          expect(row[0]).toBe('item');
          expect(row[row.length - 1]).toBe('item');
        }
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      });

      test(`${locale}: three minutes and two scorers a side stay in their column`, async ({
        page,
      }) => {
        await draw(page, 'crowded', locale);
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        const outside = await scorersOutside(page);
        // Four units of two parts each, at least.
        expect(outside.length).toBeGreaterThanOrEqual(12);
        for (const out of outside) expect(out).toBeLessThanOrEqual(0.5);
        // No name is squeezed to nothing: each keeps room to be read.
        const names = await page
          .getByTestId('match-header')
          .locator('[data-testid^="scorers-"] bdi')
          .evaluateAll((list) => list.map((n) => n.getBoundingClientRect().width));
        for (const w of names) expect(w).toBeGreaterThan(40);
      });
    }
  });
}

test.describe('the match band at 375px, what stays as it was (T-1947)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const locale of ['fa', 'en'] as const) {
    test(`${locale}: the line under a shoot-out's score leaves the sides their room`, async ({
      page,
    }) => {
      await draw(page, 'reported', locale);
      for (const w of await columns(page)) expect(w).toBeGreaterThanOrEqual(100);
    });

    test(`${locale}: in an ordinary result each scorer is one whole line, and so is the line under the score`, async ({
      page,
    }) => {
      await draw(page, 'ordinary', locale);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      const header = page.getByTestId('match-header');
      const oneLine = (el: Element) =>
        el.getBoundingClientRect().height <= parseFloat(getComputedStyle(el).lineHeight) + 1;
      for (const side of ['home', 'away'] as const) {
        const unit = header.getByTestId(`scorers-${side}`).locator('> span');
        expect(await unit.evaluate(oneLine)).toBe(true);
        const [inner, outer] = await unit
          .locator('bdi')
          .evaluate((n) => [n.scrollWidth, n.clientWidth]);
        expect(inner).toBeLessThanOrEqual(outer);
      }
      expect(
        await header.locator('[data-status-item]').first().locator('..').evaluate(oneLine),
      ).toBe(true);
      // One row, as it always was: its separator between the two items.
      expect((await statusRows(page)).rows).toEqual([['item', 'separator', 'item']]);
    });
  }
});

test.describe('the line under the score on a desktop (T-1947)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const locale of ['fa', 'en'] as const) {
    test(`${locale}: a shoot-out's line is one row, a separator between each two items`, async ({
      page,
    }) => {
      await draw(page, 'reported', locale);
      const { rows } = await statusRows(page);
      expect(rows).toEqual([['item', 'separator', 'item', 'separator', 'item']]);
    });
  }
});
