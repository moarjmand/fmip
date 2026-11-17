import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * The Live view with nothing in play and a match still to come today
 * (T-1779, D-386), through the whole stack. The seed's days are fixed --
 * 5 January 2025 is played and 1 January 2099 is never today -- and "today"
 * is the web server's own clock, so this journey stores one scheduled match
 * of its own two hours from now and removes it afterwards. CI runs the
 * journeys one at a time; a local run of the journeys in parallel may let
 * another file (the moments rail) see that match while it is stored, so run
 * them with `--workers=1` locally too. The viewer's zone is chosen so that it is about
 * ten in the morning there: the kick-off is always later the same day.
 *
 * - "Nothing is in play right now.", then "Next kick-off · today" with the
 *   competition and the list's own row for that match, its Pick on a
 *   desktop, its kick-off time and no countdown.
 * - "Show today's 1 match" leads to the All view of the same day.
 * - The founder's analysis and its links are not drawn in that state.
 * - Persian at 375px: the same frame, nothing scrolling sideways.
 *
 * Runs only in the `journeys` project (E2E_API_URL and DATABASE_URL set).
 */

const NEXT_MATCH = '00000000-0000-4000-8000-0000000009e1';
const SEASON = '00000000-0000-4000-8000-000000000302'; // Premier League 2025/26
const STAGE = '00000000-0000-4000-8000-000000000401';
const VENUE = '00000000-0000-4000-8000-000000000502';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MANCHESTER_UNITED = '00000000-0000-4000-8000-000000000601';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

interface Db {
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

/** `pg` from the database package: the web app has no driver of its own. */
function connect(): Db {
  const fromDb = createRequire(resolve(__dirname, '../../../../../packages/db/package.json'));
  const { Pool } = fromDb('pg') as { Pool: new (options: { connectionString: string }) => Db };
  return new Pool({ connectionString: DATABASE_URL });
}

/** An `Etc/GMT` zone where it is about 10:00 now (Etc/GMT-3 is UTC+3). */
function morningZone(now: Date): string {
  const offset = ((22 - now.getUTCHours() + 24) % 24) - 12;
  if (offset === 0) return 'UTC';
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

const kickoff = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 60_000) * 60_000);
const zone = morningZone(new Date());
const kickoffTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: zone,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
}).format(kickoff);
const live = (locale: string) => `/${locale}/scores?live=1&tz=${encodeURIComponent(zone)}`;

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('the Live view with a match still to come today (T-1779)', () => {
  test.skip(DATABASE_URL === '' || !process.env.E2E_API_URL, 'needs the API and the database');
  test.describe.configure({ mode: 'serial' });

  let db: Db;

  test.beforeAll(async () => {
    db = connect();
    await db.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status, venue_id)
       VALUES ($1, $2, $3, 'Matchweek 98', $4, 'scheduled', $5)
       ON CONFLICT (id) DO UPDATE SET kickoff_at = EXCLUDED.kickoff_at, status = 'scheduled'`,
      [NEXT_MATCH, SEASON, STAGE, kickoff.toISOString(), VENUE],
    );
    await db.query(
      `INSERT INTO fixture_participant (id, fixture_id, team_id, side) VALUES
         ('00000000-0000-4000-8000-000000000ae1', $1, $2, 'home'),
         ('00000000-0000-4000-8000-000000000ae2', $1, $3, 'away')
       ON CONFLICT (id) DO NOTHING`,
      [NEXT_MATCH, LIVERPOOL, MANCHESTER_UNITED],
    );
  });

  test.afterAll(async () => {
    try {
      await db.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [NEXT_MATCH]);
      await db.query(`DELETE FROM fixture WHERE id = $1`, [NEXT_MATCH]);
    } finally {
      await db.end();
    }
  });

  test('names the next kick-off as the list’s own row, and leads to the day (1280 px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(live('en'));

    await expect(page.getByTestId('scores-empty')).toHaveText('Nothing is in play right now.');
    const next = page.getByTestId('live-next');
    await expect(next).toBeVisible();
    await expect(next.getByRole('heading', { level: 2 })).toHaveText('Next kick-off · today');
    await expect(next).toContainText('Premier League');

    const row = next.locator(`[data-testid="score-card"][data-fixture-id="${NEXT_MATCH}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(kickoffTime);
    // The time of the kick-off, never a countdown.
    await expect(next).not.toContainText(/\bin \d+\s*(h|hr|hours?|m|min|minutes?)\b/i);
    await expect(next).not.toContainText(/starts in/i);

    const pick = row.getByTestId('row-pick');
    await expect(pick).toBeVisible();
    await expect(pick).toHaveAttribute('href', new RegExp(`pick=${NEXT_MATCH}`));

    // The founder's analysis and its two links are not about live.
    await expect(page.getByTestId('matches-analysis')).toHaveCount(0);
    // A match is left today, so not the none-left sentence.
    await expect(page.getByTestId('live-none-left')).toHaveCount(0);

    // 44px targets: the row's Pick and the way to the day.
    const show = page.getByTestId('live-show-day');
    await expect(show).toHaveText('Show today’s 1 match');
    for (const target of [pick, show]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    await show.click();
    await expect(page).not.toHaveURL(/live=1/);
    await expect(
      page.locator(`[data-testid="score-card"][data-fixture-id="${NEXT_MATCH}"]`),
    ).toBeVisible();
    await expect(page.getByTestId('live-next')).toHaveCount(0);
  });

  test('keeps the frame in Persian on a phone, nothing scrolling sideways (375 px)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(live('fa'));

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const next = page.getByTestId('live-next');
    await expect(next).toBeVisible();
    await expect(
      next.locator(`[data-testid="score-card"][data-fixture-id="${NEXT_MATCH}"]`),
    ).toBeVisible();
    await expect(page.getByTestId('live-show-day')).toBeVisible();
    await expect(page.getByTestId('matches-analysis')).toHaveCount(0);
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
  });
});
