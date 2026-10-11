import { type Page, expect, test } from '@playwright/test';

/**
 * The right-to-left audit on real content (T-153, CLAUDE.md rule 7).
 *
 * The pseudo-locale check (`tests/e2e/rtl.spec.ts`) proves one accent bar on a
 * page with no data. That was the right first canary and it is not enough: the
 * things that break under right-to-left are the things with real content in
 * them — a score beside two team names, a clock, a timeline — and they break in
 * ways a static page never shows.
 *
 * So this runs against **`/ar`**, a real right-to-left locale (T-150), with the
 * API, the database and the seed behind it, and it asserts *geometry*: where
 * things actually landed. Not a screenshot — a screenshot diff fails on a font
 * hint and teaches everyone to ignore it.
 *
 * The bug it is written against is the classic one for a football product: a
 * score `2–1` rendered inside a right-to-left paragraph can be *read out* as
 * `1–2`, because the digits keep their direction and the separator does not.
 * Getting that wrong means telling every Arabic reader the wrong result.
 */

const PLAYED_MATCH = '00000000-0000-4000-8000-000000000901';
const OPEN_MATCH = '00000000-0000-4000-8000-000000000902';

/** Where an element actually landed, in page coordinates. */
async function leftEdge(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).first().boundingBox();
  if (box === null) throw new Error(`${testId} has no box`);
  return box.x;
}

/**
 * Where the first and the last digit of a score landed. Walks the text nodes
 * rather than assuming one: the score is rendered as separate nodes, and a
 * test that depends on that shape would break the next time somebody changes
 * the markup for a reason unrelated to bidi.
 */
async function digitOrder(
  page: Page,
  scope?: string,
): Promise<{ firstX: number; lastX: number } | null> {
  const root = scope === undefined ? page : page.getByTestId(scope).first();
  return root
    .getByTestId('score')
    .first()
    .evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
        if ((n.textContent ?? '').trim() !== '') nodes.push(n as Text);
      }
      const digit = /[0-9\u0660-\u0669\u06F0-\u06F9]/;
      const digitAt = (node: Text, fromStart: boolean): DOMRect | null => {
        const text = node.textContent ?? '';
        const chars = [...text];
        const index = fromStart
          ? chars.findIndex((c) => digit.test(c))
          : chars.length - 1 - [...chars].reverse().findIndex((c) => digit.test(c));
        if (index < 0 || index >= chars.length || !digit.test(chars[index] ?? '')) return null;
        // Digits are one UTF-16 unit each, so the index is the offset.
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return range.getBoundingClientRect();
      };
      const firstNode = nodes.find((n) => digit.test(n.textContent ?? ''));
      const lastNode = [...nodes].reverse().find((n) => digit.test(n.textContent ?? ''));
      if (firstNode === undefined || lastNode === undefined) return null;
      const firstBox = digitAt(firstNode, true);
      const lastBox = digitAt(lastNode, false);
      return firstBox === null || lastBox === null
        ? null
        : { firstX: firstBox.x, lastX: lastBox.x };
    });
}

test.describe('the match centre under right-to-left', () => {
  test('is an Arabic right-to-left document, and is not indexed while it is untranslated', async ({
    page,
  }) => {
    await page.goto(`/ar/match/${PLAYED_MATCH}`);

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    // T-150: it renders so a translator can see the work in place, and it is
    // kept out of the index until its catalogue is filled.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('mirrors the header: the home side sits on the right', async ({ page }) => {
    await page.goto(`/en/match/${PLAYED_MATCH}`);
    await expect(page.getByTestId('match-header')).toBeVisible();
    const ltrHome = await leftEdge(page, 'home-team');
    const ltrAway = await leftEdge(page, 'away-team');
    expect(ltrHome).toBeLessThan(ltrAway);

    await page.goto(`/ar/match/${PLAYED_MATCH}`);
    await expect(page.getByTestId('match-header')).toBeVisible();
    const rtlHome = await leftEdge(page, 'home-team');
    const rtlAway = await leftEdge(page, 'away-team');
    // The whole header mirrors, so the home side moves to the right. Had this
    // been laid out with `left`/`right` instead of logical properties, these
    // two numbers would be the same as the English ones.
    expect(rtlHome).toBeGreaterThan(rtlAway);
  });

  test('puts the home goals beside the home side, which is the bug that would matter most', async ({
    page,
  }) => {
    const ltr = await page.goto(`/en/match/${PLAYED_MATCH}`).then(async () => {
      await expect(page.getByTestId('score')).toBeVisible();
      return (await page.getByTestId('score').first().textContent()) ?? '';
    });
    const ltrOrder = await digitOrder(page);

    await page.goto(`/ar/match/${PLAYED_MATCH}`);
    await expect(page.getByTestId('score')).toBeVisible();
    const rtl = (await page.getByTestId('score').first().textContent()) ?? '';

    // Same characters in the same order in the DOM: home first, for a screen
    // reader and for a copy, in either direction...
    expect(rtl).toBe(ltr);
    const digits = ltr.match(/\d+/g) ?? [];
    expect(digits.length).toBeGreaterThanOrEqual(2);

    // ...and on screen the home goals sit on the home side: on the left in
    // English, on the right in Arabic, where the mirrored header puts the home
    // team (T-1375). A pair isolated left to right (T-153's first answer) put
    // them on the left of a right-to-left header, beside the away team; one
    // left to the paragraph can come apart. Both fail here.
    const rtlOrder = await digitOrder(page);
    expect(ltrOrder).not.toBeNull();
    expect(rtlOrder).not.toBeNull();
    if (ltrOrder !== null) expect(ltrOrder.firstX).toBeLessThan(ltrOrder.lastX);
    if (rtlOrder !== null) expect(rtlOrder.firstX).toBeGreaterThan(rtlOrder.lastX);
  });

  test('keeps the clock and the status readable on a match that has not started', async ({
    page,
  }) => {
    await page.goto(`/ar/match/${OPEN_MATCH}`);
    await expect(page.getByTestId('match-header')).toBeVisible();
    // The status is text, and it must still be in the header rather than
    // pushed out of it by a mirrored margin.
    const header = await page.getByTestId('match-header').boundingBox();
    const status = await page.getByTestId('match-status').first().boundingBox();
    expect(header).not.toBeNull();
    expect(status).not.toBeNull();
    if (header !== null && status !== null) {
      expect(status.x).toBeGreaterThanOrEqual(header.x - 1);
      expect(status.x + status.width).toBeLessThanOrEqual(header.x + header.width + 1);
    }
  });
});

test.describe('the scores page under right-to-left', () => {
  test('mirrors without pushing anything off the page', async ({ page }) => {
    await page.goto('/ar/scores?from=2025-01-05&to=2025-01-05&tz=UTC');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Nothing overflows horizontally. A physical `margin-left` on a mirrored
    // page is the usual cause, and it shows up as a scrollbar rather than as a
    // failed assertion anywhere else.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('puts every row’s home goals beside its home team (T-1375)', async ({ page }) => {
    // The seed's played day, as the other journeys open it.
    await page.goto('/ar/scores?date=2025-01-05&tz=UTC');
    const played = page
      .getByTestId('score-card')
      .filter({ has: page.getByTestId('score').filter({ hasText: /[0-9\u0660-\u0669]/ }) });
    await expect(played.first()).toBeVisible();
    const card = played.first();
    const home = await card.getByTestId('home-team').boundingBox();
    const away = await card.getByTestId('away-team').boundingBox();
    expect(home).not.toBeNull();
    expect(away).not.toBeNull();
    // The row mirrors: home on the right...
    if (home !== null && away !== null) expect(home.x).toBeGreaterThan(away.x);
    // ...and its goals with it, the first digit to the right of the last.
    await card.evaluate((element) => element.setAttribute('data-testid', 'card-under-test'));
    const order = await digitOrder(page, 'card-under-test');
    expect(order).not.toBeNull();
    if (order !== null) expect(order.firstX).toBeGreaterThan(order.lastX);
  });
});
