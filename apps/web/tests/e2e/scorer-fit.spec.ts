import { type Page, expect, test } from '@playwright/test';

/**
 * A scorer in the match band never widens the page on a 375px phone, in
 * either direction (T-1947).
 *
 * The Persian match page at 375px scrolled sideways by 21px (finding
 * qa-2026-11-20-01): a scorer's unit, "M. Guilavogui ۶۳′", is one line that
 * never wraps (T-1796, D-395), and nothing held it to its column, so a unit
 * wider than the column stuck out of it; on the side nearest the page's end
 * edge that widened the page. A Latin name is wider in Vazirmatn than in
 * Archivo, which is why the English page of the same match was fine.
 *
 * This build has no API, so no match: the band is drawn here as `Hero` and
 * `scorerLine` draw it (`match-centre-view.tsx`: the three-column grid, a
 * side's name and its scorers under it, the unit's and the name's classes as
 * `match-centre-stadiomind.spec.tsx` pins them), inside the real page and its
 * production CSS. The score is drawn wide, as a shoot-out's or a rugby-sized
 * one is, so the side columns are narrower than the long unit in every
 * locale; without the fix each locale fails.
 */

const LOCALES = [
  { locale: 'en', dir: 'ltr' },
  { locale: 'fa', dir: 'rtl' },
  { locale: 'x-rtl', dir: 'rtl' },
] as const;

// `SCORER_UNIT` and `SCORER_NAME` of `match-centre-view.tsx`.
const UNIT = 'inline-flex max-w-full items-baseline whitespace-nowrap';
const NAME = 'min-w-0 overflow-x-clip text-ellipsis';

/** The band with one scorer a side, the away one the long unit. */
async function drawBand(
  page: Page,
  scorers: { home: [string, string]; away: [string, string] },
  score: string,
): Promise<void> {
  await page.locator('main').evaluate(
    (main, { scorers, score, UNIT, NAME }) => {
      const el = (tag: string, className: string, text = ''): HTMLElement => {
        const node = document.createElement(tag);
        node.className = className;
        node.textContent = text;
        return node;
      };
      const side = (which: 'home' | 'away', team: string) => {
        const [who, at] = scorers[which];
        const cell = el('div', 'min-w-0');
        cell.dataset.testid = `probe-${which}`;
        const row = el('div', 'flex flex-col items-center text-center');
        const stack = el('span', 'flex max-w-full min-w-0 flex-col gap-1.5');
        stack.append(el('bdi', 'block max-w-full text-base leading-tight font-extrabold', team));
        const line = el('span', 'text-xs text-muted max-md:pb-1.5 md:text-sm');
        const unit = el('span', UNIT);
        unit.dataset.testid = `probe-unit-${which}`;
        const name = el('bdi', NAME, who);
        name.dataset.testid = `probe-name-${which}`;
        const minutes = el('span', 'shrink-0', `\u00a0${at}`);
        minutes.dataset.testid = `probe-minutes-${which}`;
        unit.append(name, minutes);
        line.append(unit);
        stack.append(line);
        row.append(stack);
        cell.append(row);
        return cell;
      };
      const frame = el('div', 'page-frame');
      const band = el(
        'div',
        'grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 max-md:pt-1',
      );
      const figure = el(
        'span',
        'font-sans font-extrabold tabular-nums whitespace-nowrap text-display-4',
        score,
      );
      figure.dir = 'ltr';
      band.append(side('home', 'Lens'), figure, side('away', 'Lyon'));
      frame.append(band);
      main.prepend(frame);
    },
    { scorers, score, UNIT, NAME },
  );
  await page.evaluate(() => document.fonts.ready);
}

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const widthOf = async (page: Page, id: string) =>
  (await page.getByTestId(id).boundingBox())?.width ?? -1;

test.describe('a scorer in the match band on a 375px phone (T-1947)', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  for (const { locale, dir } of LOCALES) {
    const minute = locale === 'fa' ? '۶۳′' : '63′';
    const minutes = locale === 'fa' ? '۱۲′, ۴۵+۲′' : '12′, 45+2′';

    test(`${locale}: a unit wider than its column gives up the end of the name, not the page`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/competitions`);
      await expect(page.locator('html')).toHaveAttribute('dir', dir);
      await drawBand(
        page,
        { home: ['M. Guilavogui', minute], away: ['D. Calvert-Lewin', minutes] },
        '10–11',
      );

      for (const which of ['home', 'away'] as const) {
        // The unit lies inside its column.
        expect(await widthOf(page, `probe-unit-${which}`)).toBeLessThanOrEqual(
          (await widthOf(page, `probe-${which}`)) + 0.5,
        );
        // The minutes are whole.
        const [inner, outer] = await page
          .getByTestId(`probe-minutes-${which}`)
          .evaluate((m) => [m.scrollWidth, m.clientWidth]);
        expect(inner).toBeLessThanOrEqual(outer);
      }
      // The long name is the case under test: it is cut, with an ellipsis.
      const name = page.getByTestId('probe-name-away');
      const [inner, outer] = await name.evaluate((n) => [n.scrollWidth, n.clientWidth]);
      expect(inner).toBeGreaterThan(outer);
      expect(await name.evaluate((n) => getComputedStyle(n).textOverflow)).toBe('ellipsis');

      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`${locale}: a unit that fits is drawn whole`, async ({ page }) => {
      await page.goto(`/${locale}/competitions`);
      await drawBand(
        page,
        { home: ['M. Guilavogui', minute], away: ['E. Haaland', minute] },
        '1–2',
      );
      for (const which of ['home', 'away'] as const) {
        const [inner, outer] = await page
          .getByTestId(`probe-name-${which}`)
          .evaluate((n) => [n.scrollWidth, n.clientWidth]);
        expect(inner).toBeLessThanOrEqual(outer);
      }
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
