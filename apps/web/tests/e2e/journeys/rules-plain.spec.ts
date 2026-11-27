import { type Page, expect, test } from '@playwright/test';

/**
 * The community rules in plain words on a phone (T-1969, D-459): at 375 px,
 * in Persian, in the right-to-left pseudo-locale and in English, the plain
 * words open `/rules` above the platform rules they explain, and the page
 * never scrolls sideways. A journey, not a plain E2E: the plain words are
 * shown only beside the version they were written for, and the version comes
 * from the API (`rules-page.spec.tsx` checks the words themselves).
 */

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test.use({ viewport: { width: 375, height: 812 } });

for (const [path, dir, title] of [
  ['/fa/rules', 'rtl', 'قوانین جامعه، به زبان ساده'],
  ['/x-rtl/rules', 'rtl', 'Community rules, in plain words'],
  ['/en/rules', 'ltr', 'Community rules, in plain words'],
] as const) {
  test(`${path} opens on the plain words and does not scroll sideways`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('dir', dir);
    const plain = page.getByTestId('rules-plain');
    await expect(plain.getByRole('heading', { level: 2 })).toHaveText(title);
    const plainBox = await plain.boundingBox();
    const textBox = await page.getByTestId('rules-body').boundingBox();
    expect(plainBox).not.toBeNull();
    expect(textBox).not.toBeNull();
    expect(plainBox!.y + plainBox!.height).toBeLessThanOrEqual(textBox!.y);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });
}
