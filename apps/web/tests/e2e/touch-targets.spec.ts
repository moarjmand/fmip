import { type Locator, expect, test } from '@playwright/test';

/**
 * The secondary pages' links on a phone (T-1574): every one a thumb is meant
 * to press is a 44px target, in English and Persian. Without an API, so these
 * are the links each page draws in any state: the welcome steps and their way
 * out, the Watch day strip and the leaderboard's switchers. The shared fields
 * and buttons are T-1573's (`field.spec.tsx`, `button.spec.tsx`).
 */

const CONTROLS: { path: string; selector: string }[] = [
  { path: '/welcome?step=timezone', selector: '[data-testid="first-run-steps"] a' },
  { path: '/welcome?step=timezone', selector: '[data-testid="first-run-skip"]' },
  { path: '/watch', selector: '[data-testid="day-strip"] a' },
  { path: '/leaderboard', selector: '[data-testid="scope-switcher"] a' },
  { path: '/leaderboard', selector: '[data-testid="period-switcher"] a' },
];

async function heights(controls: Locator): Promise<number[]> {
  return controls.evaluateAll((elements) =>
    elements
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 2)
      .map((box) => Math.round(box.height)),
  );
}

test.use({ viewport: { width: 390, height: 844 } });

for (const locale of ['en', 'fa'] as const) {
  for (const { path, selector } of CONTROLS) {
    test(`/${locale}${path}: ${selector} is a 44px target`, async ({ page }) => {
      await page.goto(`/${locale}${path}`);
      const found = await heights(page.locator(selector));
      expect(found.length, 'the controls are drawn').toBeGreaterThan(0);
      for (const height of found) expect(height).toBeGreaterThanOrEqual(44);
    });
  }
}
