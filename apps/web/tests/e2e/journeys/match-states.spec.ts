import { expect, test } from '@playwright/test';

/**
 * The match centre before kick-off (T-1550, T-1745), on the seed's scheduled
 * match in English and Persian. The seed declares no coverage for that
 * season, so the one card of the in-play modules says "Not supplied in this
 * competition" for all of them and promises nothing "at kick-off" that the
 * season does not cover (rule 3); the covered and the limited cases are
 * rendered in `match-centre-coming.spec.tsx`, a postponed match's "Not
 * played" in `match-centre-stadiomind.spec.tsx`.
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
    // One card where five empty ones stood (T-1745), on the Summary.
    const card = page.locator('[data-testid="coming"][data-coming="all"]');
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-expected', 'false');
    await expect(card.locator('[data-coverage-chip="not_supplied"]')).toHaveCount(5);
    await expect(card.locator('[data-coverage-chip="coming"]')).toHaveCount(0);
    for (const id of ['timeline', 'statistics', 'player-statistics', 'lineups']) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await expect(page.locator('[data-not-yet]')).toHaveCount(0);
  });
}
