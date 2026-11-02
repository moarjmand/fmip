import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetentionStore } from './internal/retention-store';
import { RetentionService, purgeInBatches } from './retention.service';

/**
 * The retention purge against the real schema (T-1715, D-345): every
 * statement is valid SQL over the tables it deletes from, the periods are
 * measured on the right column, and a delivery row becomes a count in the
 * same statement that deletes it.
 *
 * **Every row here is dated in 2001 and every purge runs "on" 2001-06-01**,
 * so its cut-offs fall in 2001 too. Other suites write rows dated now into
 * the same shared database at the same time, and a purge run at the real
 * date would delete their expired sessions and claims under them.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const NOW = new Date('2001-06-01T03:23:00Z');

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('retention purge', () => {
  let pool: Pool;
  let service: RetentionService;
  let store: RetentionStore;
  let member = '';
  let consoleUser = '';
  const ids: Record<string, string> = {};

  const exists = async (table: string, id: string) =>
    (await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rowCount === 1;
  const delivered = async (notificationId: string) =>
    (
      await pool.query(`SELECT 1 FROM notification_delivery WHERE notification_id = $1`, [
        notificationId,
      ])
    ).rowCount === 1;
  const clearCounts = () =>
    pool.query(
      `DELETE FROM notification_delivery_daily WHERE day BETWEEN '2001-01-01' AND '2001-12-31'`,
    );

  async function session(label: string, created: string, expires: string): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO session (user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4) RETURNING id`,
      [member, `retention-${label}-${RUN}`, created, expires],
    );
    ids[label] = rows[0]?.id ?? '';
  }

  async function token(label: string, created: string, expires: string): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO email_token (user_id, kind, token_hash, created_at, expires_at)
       VALUES ($1, 'verify_email', $2, $3, $4) RETURNING id`,
      [member, `retention-${label}-${RUN}`, created, expires],
    );
    ids[label] = rows[0]?.id ?? '';
  }

  /** A notification claimed at `claimed`, carried with `outcome` or never. */
  async function claim(
    label: string,
    claimed: string,
    outcome: { email: string; push: string } | null,
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, created_at, deliver_after)
       VALUES ($1, 'message_received', 'conversation', gen_random_uuid()::text, $2, $2)
       RETURNING id`,
      [member, claimed],
    );
    const id = rows[0]?.id ?? '';
    ids[label] = id;
    await pool.query(
      `INSERT INTO notification_delivery (notification_id, claimed_at, email, push, carried_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $3::text IS NULL THEN NULL ELSE $2::timestamptz END)`,
      [id, claimed, outcome?.email ?? null, outcome?.push ?? null],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new RetentionStore(pool);
    service = new RetentionService(store);
    await clearCounts();
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, 'Retention tester', $1 || '@example.test', $2, 'en', 'Europe/London', now(), now())
       RETURNING id`,
      [`rt_${RUN}`, ENGLAND],
    );
    member = rows[0]?.id ?? '';
    const consoleRows = await pool.query<{ id: string }>(
      `INSERT INTO console_user (username, display_name, password_hash)
       VALUES ($1, 'Retention tester', 'not-a-hash') RETURNING id`,
      [`rt-${RUN}`],
    );
    consoleUser = consoleRows.rows[0]?.id ?? '';

    // Sessions: the cut-off is 2001-05-02 (expired more than 30 days before).
    await session('sessionOld', '2001-01-01T00:00:00Z', '2001-01-15T00:00:00Z');
    await session('sessionRecent', '2001-05-01T00:00:00Z', '2001-05-15T00:00:00Z');
    const consoleSession = await pool.query<{ id: string }>(
      `INSERT INTO console_session (token_hash, user_id, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, '2001-01-01T00:00:00Z', '2001-01-01T00:00:00Z', '2001-01-02T00:00:00Z')
       RETURNING id`,
      [`retention-console-${RUN}`, consoleUser],
    );
    ids.consoleOld = consoleSession.rows[0]?.id ?? '';

    // Tokens: the cut-off is 2001-05-25 (expired more than 7 days before).
    await token('tokenOld', '2001-05-19T00:00:00Z', '2001-05-20T00:00:00Z');
    await token('tokenRecent', '2001-05-27T00:00:00Z', '2001-05-28T00:00:00Z');

    // Deliveries: the cut-off is 2001-03-03 (claimed more than 90 days before).
    await claim('sentA', '2001-01-10T10:00:00Z', { email: 'sent', push: 'absent' });
    await claim('sentB', '2001-01-10T22:00:00Z', { email: 'sent', push: 'absent' });
    await claim('uncarried', '2001-01-10T11:00:00Z', null);
    await claim('failedC', '2001-01-11T09:00:00Z', { email: 'skipped', push: 'failed' });
    await claim('recent', '2001-04-01T10:00:00Z', { email: 'sent', push: 'sent' });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await clearCounts();
    // Cascades take the sessions, tokens, notifications and their deliveries.
    await pool.query(`DELETE FROM user_account WHERE id = $1`, [member]);
    await pool.query(`DELETE FROM console_user WHERE id = $1`, [consoleUser]);
    await pool.end();
  });

  it('deletes deliveries in bounded batches, oldest first, counting each one once', async () => {
    const cutoff = new Date('2001-03-03T03:23:00Z');
    const first = await store.rollUpDeliveries(cutoff, 3);
    expect(first).toBe(3);
    // The oldest three claims went first; the fourth old one is still there.
    expect(await delivered(ids.sentA ?? '')).toBe(false);
    expect(await delivered(ids.uncarried ?? '')).toBe(false);
    expect(await delivered(ids.sentB ?? '')).toBe(false);
    expect(await delivered(ids.failedC ?? '')).toBe(true);

    const rest = await purgeInBatches((limit) => store.rollUpDeliveries(cutoff, limit), 3);
    expect(rest).toEqual({ deleted: 1, batches: 1, capped: false });
    expect(await delivered(ids.failedC ?? '')).toBe(false);
    expect(await delivered(ids.recent ?? '')).toBe(true);
    // The notification itself stays: only its delivery record is reduced.
    expect(await exists('notification', ids.sentA ?? '')).toBe(true);

    const { rows } = await pool.query<{
      day: string;
      kind: string;
      email: string;
      push: string;
      n: string;
    }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, email, push, n::text
         FROM notification_delivery_daily
        WHERE day BETWEEN '2001-01-01' AND '2001-12-31'
        ORDER BY day, email, push`,
    );
    expect(rows).toEqual([
      { day: '2001-01-10', kind: 'message_received', email: 'sent', push: 'absent', n: '2' },
      {
        day: '2001-01-10',
        kind: 'message_received',
        email: 'uncarried',
        push: 'uncarried',
        n: '1',
      },
      { day: '2001-01-11', kind: 'message_received', email: 'skipped', push: 'failed', n: '1' },
    ]);
  });

  it('purges expired sessions and tokens by their own periods, and keeps the rest', async () => {
    await service.purge(NOW);
    expect(await exists('session', ids.sessionOld ?? '')).toBe(false);
    expect(await exists('session', ids.sessionRecent ?? '')).toBe(true);
    expect(await exists('console_session', ids.consoleOld ?? '')).toBe(false);
    expect(await exists('email_token', ids.tokenOld ?? '')).toBe(false);
    expect(await exists('email_token', ids.tokenRecent ?? '')).toBe(true);
    expect(await delivered(ids.recent ?? '')).toBe(true);
  });

  it('adds to an existing day’s count rather than replacing it', async () => {
    await claim('late', '2001-01-10T23:00:00Z', { email: 'sent', push: 'absent' });
    await service.purge(NOW);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT n::text FROM notification_delivery_daily
        WHERE day = '2001-01-10' AND kind = 'message_received' AND email = 'sent' AND push = 'absent'`,
    );
    expect(rows).toEqual([{ n: '3' }]);
  });
});
