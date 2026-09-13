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

  test('never reverses the score, which is the bug that would matter most', async ({ page }) => {
    const ltr = await page.goto(`/en/match/${PLAYED_MATCH}`).then(async () => {
      await expect(page.getByTestId('score')).toBeVisible();
      return (await page.getByTestId('score').first().textContent()) ?? '';
    });

    await page.goto(`/ar/match/${PLAYED_MATCH}`);
    await expect(page.getByTestId('score')).toBeVisible();
    const rtl = (await page.getByTestId('score').first().textContent()) ?? '';

    // Same characters in the same order in the DOM...
    expect(rtl).toBe(ltr);

    // ...and the same order on screen. `Intl.Segmenter` is not the check here;
    // the check is that the browser's own bidi resolution did not flip it,
    // which is what the bounding boxes of the two digits say.
    const digits = ltr.match(/\d+/g) ?? [];
    expect(digits.length).toBeGreaterThanOrEqual(2);

    const order = await page
      .getByTestId('score')
      .first()
      .evaluate((element) => {
        // Walk the text nodes rather than assuming one: the score is rendered as
        // separate nodes, and a test that depends on that shape would break the
        // next time somebody changes the markup for a reason unrelated to bidi.
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
          if ((n.textContent ?? '').trim() !== '') nodes.push(n as Text);
        }
        const digitAt = (node: Text, fromStart: boolean): DOMRect | null => {
          const text = node.textContent ?? '';
          const index = fromStart
            ? text.search(/\d/)
            : text.length - 1 - [...text].reverse().findIndex((c) => /\d/.test(c));
          if (index < 0 || index >= text.length || !/\d/.test(text[index] ?? '')) return null;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          return range.getBoundingClientRect();
        };
        const firstNode = nodes.find((n) => /\d/.test(n.textContent ?? ''));
        const lastNode = [...nodes].reverse().find((n) => /\d/.test(n.textContent ?? ''));
        if (firstNode === undefined || lastNode === undefined) return null;
        const firstBox = digitAt(firstNode, true);
        const lastBox = digitAt(lastNode, false);
        return firstBox === null || lastBox === null
          ? null
          : { firstX: firstBox.x, lastX: lastBox.x };
      });

    // A score is a number, and a number reads left to right in every script.
    // If bidi had reversed it the first digit would have ended up on the right.
    expect(order).not.toBeNull();
    if (order !== null) expect(order.firstX).toBeLessThan(order.lastX);
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
});
