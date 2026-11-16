import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

/**
 * Suggestions under the search fields while a reader types (T-1844, D-435).
 * The suite runs without the API, so the route the field asks is answered
 * here: rows grouped by kind, the keyboard, Escape, the answer for a term the
 * field no longer holds, a failure said as one, and right-to-left.
 */

/** Waits until React has taken the field over (hydration); typing before then is a plain input's. */
async function hydrated(page: Page, testId: string) {
  await page.waitForFunction(
    (id) => {
      const field = document.querySelector(`[data-testid="${id}"]`);
      return field !== null && Object.keys(field).some((key) => key.startsWith('__reactFiber'));
    },
    testId,
    { timeout: 30_000 },
  );
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const NO_MEDIA = { coverage: 'not_supplied', url: null };

const row = (type: string, id: string, name: string, line: string | null, href: string) => ({
  type,
  id,
  name,
  line,
  href,
  image: NO_MEDIA,
  imageKind: type === 'team' ? 'crest' : type === 'competition' ? 'logo' : 'photo',
});

async function answer(page: Page, locale = 'en') {
  const asked: string[] = [];
  await page.route('**/api/search/suggest?*', async (route) => {
    const term = new URL(route.request().url()).searchParams.get('q') ?? '';
    asked.push(term);
    if (term === 'broken') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    if (term === 'zzzz') return route.fulfill({ json: { term, groups: [] } });
    return route.fulfill({
      json: {
        term,
        groups: [
          {
            type: 'team',
            heading: locale === 'fa' ? 'تیم‌ها' : 'Teams',
            headingLang: null,
            rows: [
              row('team', 't1', 'Manchester United', 'Premier League', `/${locale}/team/t1`),
              row('team', 't2', 'Manchester City', 'Premier League', `/${locale}/team/t2`),
            ],
          },
          {
            type: 'person',
            heading: 'Players',
            headingLang: null,
            rows: [row('person', 'p1', 'Mason Mount', 'Manchester United', `/${locale}/player/p1`)],
          },
        ],
      },
    });
  });
  return asked;
}

test.describe('search suggestions', () => {
  // The list needs the page's script: never Lite, however slow the server (as a11y.spec.ts).
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'fmip_lite', value: 'off', url: baseURL ?? '' }]);
  });

  test('lists the matches by kind under the header field, with every result last', async ({
    page,
  }) => {
    const asked = await answer(page);
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.fill('man');
    const list = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(list).toBeVisible();
    await expect(field).toHaveAttribute('aria-expanded', 'true');
    await expect(list.getByRole('group', { name: 'Teams' }).getByRole('option')).toHaveText([
      /Manchester United\s*Premier League/,
      /Manchester City/,
    ]);
    await expect(list.getByRole('group', { name: 'Players' }).getByRole('option')).toHaveCount(1);
    await expect(page.getByTestId('search-suggest-all')).toContainText('See all results for “man”');
    await expect(page.getByTestId('search-suggest-all')).toContainText(
      'Also searches news, groups and members',
    );
    // One character asks nothing; the pause folds the keystrokes into one question.
    expect(asked).toEqual(['man']);
    const results = await new AxeBuilder({ page })
      .include('[data-testid="nav-search-form"]')
      .withTags(TAGS)
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('moves with the arrow keys, keeps the focus in the field, and opens the row on Enter', async ({
    page,
  }) => {
    await answer(page);
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.fill('man');
    const options = page.getByTestId('search-suggest-option');
    await expect(options).toHaveCount(3);
    await field.press('ArrowDown');
    await field.press('ArrowDown');
    await expect(field).toBeFocused();
    const second = await options.nth(1).getAttribute('id');
    await expect(field).toHaveAttribute('aria-activedescendant', second!);
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    // Up from the first row wraps to "See all results".
    await field.press('ArrowUp');
    await field.press('ArrowUp');
    await expect(page.getByTestId('search-suggest-all')).toHaveAttribute('aria-selected', 'true');
    await field.press('ArrowDown');
    await field.press('ArrowDown');
    await field.press('Enter');
    await expect(page).toHaveURL(/\/en\/team\/t2$/);
  });

  test('sends the plain form on Enter with no row chosen, and from "See all results"', async ({
    page,
  }) => {
    await answer(page);
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.fill('man');
    await expect(page.getByTestId('search-suggest-option')).toHaveCount(3);
    await field.press('Enter');
    await expect(page).toHaveURL(/\/en\/search\?q=man$/);

    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    await page.getByTestId('nav-search-input').fill('man');
    await page.getByTestId('search-suggest-all').click();
    await expect(page).toHaveURL(/\/en\/search\?q=man$/);
  });

  test('asks once for a word typed quickly, and drops an answer for a term the field no longer holds', async ({
    page,
  }) => {
    const asked: string[] = [];
    await page.route('**/api/search/suggest?*', async (route) => {
      const term = new URL(route.request().url()).searchParams.get('q') ?? '';
      asked.push(term);
      // The first term's answer is slow and arrives after the second's.
      if (term === 'arse') await new Promise((resolve) => setTimeout(resolve, 1500));
      const club = row('team', term, `Club ${term}`, null, `/en/team/${term}`);
      try {
        await route.fulfill({
          json: {
            term,
            groups: [{ type: 'team', heading: 'Teams', headingLang: null, rows: [club] }],
          },
        });
      } catch {
        // The field aborted the slow request; nothing to answer.
      }
    });
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.click();
    await field.pressSequentially('arse', { delay: 20 });
    await expect.poll(() => asked).toEqual(['arse']);
    await field.pressSequentially('nal', { delay: 20 });
    const options = page.getByTestId('search-suggest-option');
    await expect(options).toHaveText([/Club arsenal/]);
    // The slow answer for "arse" has had its time; it is not drawn.
    await page.waitForTimeout(1800);
    await expect(options).toHaveText([/Club arsenal/]);
    expect(asked).toEqual(['arse', 'arsenal']);
  });

  test('closes on Escape, then clears the field on a second Escape', async ({ page }) => {
    await answer(page);
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.fill('man');
    await expect(page.getByRole('listbox', { name: 'Suggestions' })).toBeVisible();
    await field.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Suggestions' })).toBeHidden();
    await expect(field).toHaveValue('man');
    await field.press('Escape');
    await expect(field).toHaveValue('');
  });

  test('says when nothing matches, and when suggestions cannot be had, never one for the other', async ({
    page,
  }) => {
    await answer(page);
    await page.goto('/en/scores');
    await hydrated(page, 'nav-search-input');
    const field = page.getByTestId('nav-search-input');
    await field.fill('zzzz');
    await expect(page.getByTestId('search-suggest-none')).toHaveText(
      'No teams, competitions or players match “zzzz”',
    );
    await expect(page.getByTestId('search-suggest-unavailable')).toHaveCount(0);
    await field.fill('broken');
    await expect(page.getByTestId('search-suggest-unavailable')).toContainText(
      'Suggestions are unavailable right now.',
    );
    await expect(page.getByTestId('search-suggest-none')).toHaveCount(0);
    // "See all results" stays: the full search can still be asked.
    await expect(page.getByTestId('search-suggest-all')).toBeVisible();
  });

  test('suggests under the search page field on a phone, right to left in Persian', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await answer(page, 'fa');
    await page.goto('/fa/search');
    await hydrated(page, 'search-input');
    const field = page.getByTestId('search-input');
    await field.fill('من');
    const list = page.getByRole('listbox', { name: 'پیشنهادها' });
    await expect(list).toBeVisible();
    await expect(list.getByTestId('search-suggest-all')).toContainText('همه‌ی نتایج برای «من»');
    // The list takes the field row's width and stays on screen.
    const box = (await list.boundingBox())!;
    const form = (await page.locator('form[role="search"]').last().boundingBox())!;
    // Within a pixel: the list's border sits on a fractional edge.
    expect(Math.abs(box.x - form.x)).toBeLessThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // Rows are thumb-sized.
    for (const option of await list.getByTestId('search-suggest-option').all()) {
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});
