import { expect, test } from '@playwright/test';

/**
 * The moments rail with the API and the seed behind it (T-1642, D-300). The
 * seed's matches are in January 2025 and January 2099, so `GET /moments`
 * has nothing to pick today, even on its quiet-day reading (D-299): the
 * rail draws nothing at all (no empty bar, rule 3). Its client half is
 * there all the same, so the rail appears once there is something to show:
 * told by the page that a match moved, it asks its Server Function at once
 * and gets the rail drawn again by the server. The cards, the hover card,
 * the phone's row and Persian are in `../moments-rail.spec.ts`, against a
 * stand-in for the API.
 */

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';

test.describe('moments rail', () => {
  test('draws nothing on a day with no moment, and keeps asking the server (T-1635)', async ({
    page,
  }) => {
    await page.goto('/en');
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('moments-rail')).toHaveCount(0);
    await page.goto(`/en/competition/${PREMIER_LEAGUE}`);
    await expect(page.getByTestId('title')).toHaveText(/Premier League/i);

    // What the match centre and the scores page say when their stream sees a
    // goal: the rail asks at once (with nothing being played it would
    // otherwise wait minutes). The answer is a React Server Components
    // payload: the rail as the server draws it, still empty.
    const asked = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.request().headers()['next-action'] !== undefined,
    );
    await page.evaluate(() => window.dispatchEvent(new Event('fmip:live-moved')));
    const answer = await asked;
    expect(answer.status()).toBe(200);
    expect(answer.headers()['content-type']).toContain('text/x-component');
    await expect(page.getByTestId('moments-rail')).toHaveCount(0);
  });
});
