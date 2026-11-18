import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { type APIRequestContext, expect, test } from '@playwright/test';

/**
 * A merged-away duplicate's pages redirect for good to the survivor's
 * (T-1865b, D-446 point 7, D-453): the player page, the compare page by
 * either player and the coach page answer 308 with the survivor's URL, the
 * reader's query kept, and a browser lands on the survivor's page.
 *
 * Runs only in the `journeys` project (E2E_API_URL and DATABASE_URL set):
 * it merges two persons of its own through `merge_person`.
 */

const SALAH = '00000000-0000-4000-8000-000000000701';
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const SURVIVOR = '00000000-0000-4000-8000-0000000018a1';
const LOSER = '00000000-0000-4000-8000-0000000018a2';
const ACTOR_NAME = 't1865b_e2e_actor';
const NAME = 'Tombstone Redirect Survivor';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

interface Db {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
  connect(): Promise<Db & { release(): void }>;
  end(): Promise<void>;
}

/** `pg` from the database package: the web app has no driver of its own. */
function connect(): Db {
  const fromDb = createRequire(resolve(__dirname, '../../../../../packages/db/package.json'));
  const { Pool } = fromDb('pg') as { Pool: new (options: { connectionString: string }) => Db };
  return new Pool({ connectionString: DATABASE_URL });
}

/** Everything this journey wrote, the merge's immutable rows included. */
async function clean(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`SET session_replication_role = 'replica'`);
    await client.query(
      `DELETE FROM audit_log WHERE id IN (
         SELECT audit_log_id FROM person_merge WHERE from_person_id = $1
         UNION SELECT undo_audit_log_id FROM person_merge WHERE from_person_id = $1)`,
      [LOSER],
    );
    await client.query(
      `DELETE FROM person_merge_moved WHERE merge_id IN
         (SELECT id FROM person_merge WHERE from_person_id = $1)`,
      [LOSER],
    );
    await client.query(`DELETE FROM person_merge WHERE from_person_id = $1`, [LOSER]);
    await client.query(`DELETE FROM coach_fetch WHERE person_id = ANY($1::uuid[])`, [
      [SURVIVOR, LOSER],
    ]);
    await client.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[SURVIVOR, LOSER]]);
    await client.query(`DELETE FROM user_account WHERE username = $1`, [ACTOR_NAME]);
  } finally {
    await client.query(`SET session_replication_role = 'origin'`);
    client.release();
  }
}

/** The status and the target of one request, the redirect not followed. */
async function hop(request: APIRequestContext, path: string) {
  const response = await request.get(path, { maxRedirects: 0 });
  const location = response.headers()['location'] ?? '';
  const target = new URL(location, 'http://example.invalid');
  return {
    status: response.status(),
    path: target.pathname,
    query: Object.fromEntries(target.searchParams),
  };
}

test.describe('a merged-away person redirects to the survivor (T-1865b)', () => {
  test.skip(DATABASE_URL === '' || !process.env.E2E_API_URL, 'needs the API and the database');
  test.describe.configure({ mode: 'serial' });

  let db: Db;

  test.beforeAll(async () => {
    db = connect();
    await clean(db);
    const actor = (
      await db.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, status)
         VALUES ($1, 'T-1865b', 't1865b-e2e@example.com', $2, 'en', 'UTC', now(), 'active')
         RETURNING id`,
        [ACTOR_NAME, ENGLAND],
      )
    ).rows[0]!.id;
    await db.query(
      `INSERT INTO person (id, full_name, date_of_birth) VALUES
         ($1, $3, '1991-02-03'), ($2, $3, '1991-02-03')`,
      [SURVIVOR, LOSER, NAME],
    );
    // The provider described the survivor as a coach, so his coach page exists.
    await db.query(
      `INSERT INTO coach_fetch (source, person_id, fetched_at, spells_listed, spells_kept, spells_unmapped)
       VALUES ('api_football', $1, now(), 0, 0, 0)`,
      [SURVIVOR],
    );
    await db.query(`SELECT merge_person($1, $2, $3, 'T-1865b journey: one man, two ids')`, [
      LOSER,
      SURVIVOR,
      actor,
    ]);
  });

  test.afterAll(async () => {
    await clean(db);
    await db.end();
  });

  test('the player page answers 308 to the survivor, the query kept', async ({ request }) => {
    expect(await hop(request, `/en/player/${LOSER}?tab=career`)).toEqual({
      status: 308,
      path: `/en/player/${SURVIVOR}`,
      query: { tab: 'career' },
    });
    // The survivor's own page does not move.
    expect((await hop(request, `/en/player/${SURVIVOR}`)).status).toBe(200);
  });

  test('the compare page answers 308 by either player, ?with= too', async ({ request }) => {
    expect(await hop(request, `/fa/player/${SALAH}/compare?with=${LOSER}&season=x`)).toEqual({
      status: 308,
      path: `/fa/player/${SALAH}/compare`,
      query: { with: SURVIVOR, season: 'x' },
    });
    expect(await hop(request, `/en/player/${LOSER}/compare?with=${SALAH}`)).toEqual({
      status: 308,
      path: `/en/player/${SURVIVOR}/compare`,
      query: { with: SALAH },
    });
  });

  test('the coach page answers 308 to the survivor', async ({ request }) => {
    expect(await hop(request, `/en/coach/${LOSER}`)).toEqual({
      status: 308,
      path: `/en/coach/${SURVIVOR}`,
      query: {},
    });
  });

  test("a reader lands on the survivor's page", async ({ page }) => {
    await page.goto(`/en/player/${LOSER}`);
    await expect(page).toHaveURL(new RegExp(`/en/player/${SURVIVOR}$`));
    await expect(page.getByTestId('player-page')).toBeVisible();
  });
});
