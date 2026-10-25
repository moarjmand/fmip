import { expect, test } from '@playwright/test';

/**
 * The match centre before kick-off (T-1550), on the seed's scheduled match
 * in English and Persian. The seed declares no coverage for that season, so
 * every module that has nothing says "Not supplied", and none promises data
 * "from kick-off" that the season does not cover (rule 3); the covered
 * case, "From kick-off", and a postponed match's "Not played" are rendered
 * in `match-centre-stadiomind.spec.tsx`.
 */

const SCHEDULED_MATCH = '00000000-0000-4000-8000-000000000902';

for (const locale of ['en', 'fa'] as const) {
  test(`/${locale}: before kick-off, a module the season does not cover says so`, async ({
    page,
  }) => {
    await page.goto(`/${locale}/match/${SCHEDULED_MATCH}`);
    const header = page.getByTestId('match-header');
    await expect(header).toBeVisible();
    // Before kick-off the band shows the kick-off time, never a score.
    await expect(page.getByTestId('score')).toHaveCount(0);
    await expect(page.getByTestId('live-badge')).toHaveCount(0);
    const timeline = page.getByTestId('timeline');
    await expect(timeline).toHaveAttribute('data-coverage', 'not_supplied');
    await expect(timeline.locator('[data-coverage-badge="not_supplied"]')).toBeVisible();
    await expect(page.locator('[data-not-yet]')).toHaveCount(0);
  });
}
