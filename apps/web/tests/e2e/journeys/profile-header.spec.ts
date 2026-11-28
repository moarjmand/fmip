import { expect, test } from '@playwright/test';
import { member, registerAndVerify } from './members';

/**
 * A member's own profile header at 375 px with the longest name it can hold
 * (T-1977): a username of 20 characters, the most the API takes, and a display
 * name of 30 with nowhere to break. Before, the name pushed «ویرایش نمایه» /
 * "Edit profile" out of shape, and on /fa the handle sat in an outer isolate
 * that aligned it to the left. Now the name and the handle wrap, the link
 * stays whole on one line, nothing leaves the page, and the handle reads
 * `@name` at the start of its line in English and in Persian.
 */

const RUN = Date.now().toString(36);
const LONG_NAME = 'Abcdefghijklmnopqrstuvwxyz1234';

test.use({ viewport: { width: 375, height: 812 } });

test('a long name on the member’s own profile at 375 px: no overflow, the link whole, the handle at the start', async ({
  page,
}) => {
  const who = member(RUN, 'longnam', LONG_NAME);
  expect(who.username.length, who.username).toBeLessThanOrEqual(20);
  expect(LONG_NAME).toHaveLength(30);
  await registerAndVerify(page, who);

  for (const locale of ['en', 'fa'] as const) {
    await page.goto(`/${locale}/u/${who.username}`);
    await expect(page.getByTestId('profile-name')).toHaveText(LONG_NAME);
    const handle = page.getByTestId('profile-handle');
    await expect(handle).toHaveText(`@${who.username}`);
    await expect(page.getByTestId('profile-edit')).toHaveText(
      locale === 'fa' ? 'ویرایش نمایه' : 'Edit profile',
    );

    const found = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const name = document.querySelector<HTMLElement>('[data-testid="profile-name"]')!;
      const handle = document.querySelector<HTMLElement>('[data-testid="profile-handle"]')!;
      const edit = document.querySelector<HTMLElement>('[data-testid="profile-edit"]')!;
      const header = name.closest('header')!;
      const column = name.parentElement!;
      const isolate = handle.querySelector('bdi')!;
      const first = isolate.getClientRects()[0]!;
      return {
        page: {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        },
        header: { start: box(header).left, end: box(header).right },
        column: { left: box(column).left, right: box(column).right },
        name: { scroll: name.scrollWidth, client: name.clientWidth },
        handle: {
          scroll: handle.scrollWidth,
          client: handle.clientWidth,
          direction: getComputedStyle(handle).direction,
          isolate: getComputedStyle(isolate).direction,
          firstLeft: first.left,
          firstRight: first.right,
          // No outer isolate of its own between the handle and the column.
          parent: handle.parentElement === column,
        },
        edit: {
          lines: edit.getClientRects().length,
          left: box(edit).left,
          right: box(edit).right,
          scroll: edit.scrollWidth,
          client: edit.clientWidth,
        },
        dir: document.documentElement.dir,
      };
    });

    expect(found.page.scroll, `${locale}: the page scrolls sideways`).toBeLessThanOrEqual(
      found.page.client,
    );
    // The name and the handle wrap inside their column, never past it.
    expect(found.name.scroll, `${locale}: the name overflows`).toBeLessThanOrEqual(
      found.name.client,
    );
    expect(found.handle.scroll, `${locale}: the handle overflows`).toBeLessThanOrEqual(
      found.handle.client,
    );
    // The link is whole: one line, inside the header and the viewport.
    expect(found.edit.lines, `${locale}: "Edit profile" breaks`).toBe(1);
    expect(found.edit.scroll, `${locale}: "Edit profile" is cut`).toBeLessThanOrEqual(
      found.edit.client + 0.5,
    );
    expect(found.edit.left, locale).toBeGreaterThanOrEqual(found.header.start - 0.5);
    expect(found.edit.right, locale).toBeLessThanOrEqual(found.header.end + 0.5);
    expect(found.edit.right, locale).toBeLessThanOrEqual(found.page.client);
    // `@name` left to right, in a line of the page's own direction, at its start.
    expect(found.dir).toBe(locale === 'fa' ? 'rtl' : 'ltr');
    expect(found.handle.parent, `${locale}: an isolate around the handle`).toBe(true);
    expect(found.handle.direction).toBe(found.dir);
    expect(found.handle.isolate).toBe('ltr');
    if (locale === 'fa') {
      expect(
        Math.abs(found.handle.firstRight - found.column.right),
        'fa: not at the start',
      ).toBeLessThan(1);
    } else {
      expect(
        Math.abs(found.handle.firstLeft - found.column.left),
        'en: not at the start',
      ).toBeLessThan(1);
    }
  }
});
