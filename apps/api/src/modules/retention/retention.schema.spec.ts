import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTriggersOff } from '../../testing/cleanup';
import { ActivityService } from '../activity/activity.service';
import { ActivityStore } from '../activity/internal/activity-store';
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
 *
 * The purge also keeps the Activity report's day counts (T-1727, D-353) in
 * `activity_daily`, which only this file writes: its rows are set aside
 * before the suite and put back after it, so the 2001 days are the only
 * ones the purge sees.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const UPCOMING = '00000000-0000-4000-8000-000000000902';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
// Two matches of this suite's own, dated in 2001 like everything else here:
// one that kicked off more than 30 days before the run, one that did not.
const MATCH_OLD = randomUUID();
const MATCH_RECENT = randomUUID();
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const NOW = new Date('2001-06-01T03:23:00Z');

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('retention purge', () => {
  let pool: Pool;
  let service: RetentionService;
  let store: RetentionStore;
  let activity: ActivityStore;
  let member = '';
  let other = '';
  let keptBefore: { day: string; sign_ins: number; active_members: number; kept_at: Date }[] = [];
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

  async function session(
    label: string,
    created: string,
    expires: string,
    user: string = member,
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO session (user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4) RETURNING id`,
      [user, `retention-${label}-${RUN}`, created, expires],
    );
    ids[label] = rows[0]?.id ?? '';
  }

  /** A prediction on the seeded upcoming fixture, its one version submitted at `submitted`. */
  async function predict(user: string, submitted: string): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_prediction (user_id, fixture_id, created_at, updated_at)
       VALUES ($1, $2, $3, $3) RETURNING id`,
      [user, UPCOMING, submitted],
    );
    await pool.query(
      `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence, submitted_at)
       VALUES ($1, 1, 'home', 3, $2)`,
      [rows[0]?.id, submitted],
    );
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
    activity = new ActivityStore(pool);
    service = new RetentionService(store, new ActivityService(activity));
    await clearCounts();
    keptBefore = (
      await pool.query<{ day: string; sign_ins: number; active_members: number; kept_at: Date }>(
        `DELETE FROM activity_daily
         RETURNING to_char(day, 'YYYY-MM-DD') AS day, sign_ins, active_members, kept_at`,
      )
    ).rows;
    const account = async (username: string) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, 'Retention tester', $1 || '@example.test', $2, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [username, ENGLAND],
      );
      return rows[0]?.id ?? '';
    };
    member = await account(`rt_${RUN}`);
    other = await account(`rt2_${RUN}`);
    const consoleRows = await pool.query<{ id: string }>(
      `INSERT INTO console_user (username, display_name, password_hash)
       VALUES ($1, 'Retention tester', 'not-a-hash') RETURNING id`,
      [`rt-${RUN}`],
    );
    consoleUser = consoleRows.rows[0]?.id ?? '';

    // Sessions: the cut-off is 2001-05-02 (expired more than 30 days before).
    await session('sessionOld', '2001-01-01T00:00:00Z', '2001-01-15T00:00:00Z');
    await session('sessionRecent', '2001-05-01T00:00:00Z', '2001-05-15T00:00:00Z');

    // The Activity day counts (D-353): on 2001-02-10 three sign-ins by two
    // members, one of whom also predicts; on 2001-02-11 a prediction only.
    // All three sessions expired more than 30 days before the run.
    await session('dayA1', '2001-02-10T08:00:00Z', '2001-02-24T08:00:00Z');
    await session('dayA2', '2001-02-10T20:00:00Z', '2001-02-24T20:00:00Z');
    await session('dayA3', '2001-02-10T23:30:00Z', '2001-02-24T23:30:00Z', other);
    await predict(other, '2001-02-10T12:00:00Z');
    await predict(member, '2001-02-11T12:00:00Z');
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

    // Pending picks (T-1740, D-361): the cut-off is 2001-05-02, compared with
    // the match's kick-off. Written past the insert guard, which refuses a
    // match that has kicked off and a member whose address is confirmed.
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
       ($1, $3, TIMESTAMPTZ '2001-03-01 15:00:00+00', 'finished'),
       ($2, $3, TIMESTAMPTZ '2001-05-20 15:00:00+00', 'finished')`,
      [MATCH_OLD, MATCH_RECENT, PL_2025],
    );
    const pick = async (
      label: string,
      user: string,
      fixture: string,
      status: string,
      created: string,
      resolved: string | null,
    ) => {
      await withTriggersOff(pool, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO pending_pick (user_id, fixture_id, outcome, status, created_at, resolved_at)
           VALUES ($1, $2, 'home', $3, $4, $5) RETURNING id`,
          [user, fixture, status, created, resolved],
        );
        ids[label] = rows[0]?.id ?? '';
      });
    };
    // Kicked off before the cut-off: gone, whatever became of them.
    await pick('pickOldWaiting', member, MATCH_OLD, 'pending', '2001-02-20T10:00:00Z', null);
    await pick(
      'pickOldReplaced',
      member,
      MATCH_OLD,
      'replaced',
      '2001-02-19T10:00:00Z',
      '2001-02-20T10:00:00Z',
    );
    // Kicked off after it: kept, except the one that became a prediction.
    await pick('pickRecentWaiting', member, MATCH_RECENT, 'pending', '2001-05-10T10:00:00Z', null);
    await pick(
      'pickRecentExpired',
      other,
      MATCH_RECENT,
      'expired',
      '2001-05-10T10:00:00Z',
      '2001-05-21T10:00:00Z',
    );
    await pick(
      'pickConverted',
      other,
      MATCH_RECENT,
      'converted',
      '2001-05-11T10:00:00Z',
      '2001-05-12T10:00:00Z',
    );
    // Converted after this run's moment: the next run's, not this one's.
    await pick(
      'pickConvertedLater',
      member,
      UPCOMING,
      'converted',
      '2001-06-15T10:00:00Z',
      '2001-07-01T10:00:00Z',
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await clearCounts();
    await pool.query(`DELETE FROM activity_daily WHERE day < '2002-01-01'`);
    for (const row of keptBefore) {
      await pool.query(
        `INSERT INTO activity_daily (day, sign_ins, active_members, kept_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT (day) DO NOTHING`,
        [row.day, row.sign_ins, row.active_members, row.kept_at],
      );
    }
    const accounts = [member, other];
    await withTriggersOff(pool, async (c) => {
      await c.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
        [accounts],
      );
      await c.query(`DELETE FROM user_prediction WHERE user_id = ANY($1::uuid[])`, [accounts]);
    });
    // Cascades take the sessions, tokens, notifications and their deliveries.
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [accounts]);
    // Their pending picks went with the accounts; the two matches are this suite's own.
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[MATCH_OLD, MATCH_RECENT]]);
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

  it('keeps a day’s sign-ins and active members when its sessions are purged (T-1727)', async () => {
    const since = new Date('2001-01-01T00:00:00Z');
    const members = new Set(['sign_ins', 'active_members']);
    const report2001 = async () =>
      Object.fromEntries(
        (await activity.counts(since))
          .filter((row) => members.has(row.metric) && row.day.startsWith('2001-'))
          .map((row) => [`${row.metric} ${row.day}`, row.n]),
      );

    const before = await report2001();
    expect(before).toMatchObject({
      'sign_ins 2001-01-01': 1,
      'active_members 2001-01-01': 1,
      'sign_ins 2001-02-10': 3,
      'active_members 2001-02-10': 2,
      'active_members 2001-02-11': 1,
      'sign_ins 2001-05-01': 1,
      'active_members 2001-05-01': 1,
    });

    const report = await service.purge(NOW);
    for (const label of ['sessionOld', 'dayA1', 'dayA2', 'dayA3']) {
      expect(await exists('session', ids[label] ?? '')).toBe(false);
    }
    // The same figures, now from the kept days up to 2001-02-10 and live after.
    expect(await report2001()).toEqual(before);

    // Kept: every day through the latest creation day of a purged session,
    // quiet days as zeros; 2001-02-11 and later stay live.
    const { rows } = await pool.query<{ day: string; sign_ins: number; active_members: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, sign_ins, active_members
         FROM activity_daily WHERE day BETWEEN '2001-01-01' AND '2001-12-31' ORDER BY day`,
    );
    expect(rows).toHaveLength(41);
    expect(report.activity_days_kept).toBeGreaterThanOrEqual(41);
    expect(rows[0]).toEqual({ day: '2001-01-01', sign_ins: 1, active_members: 1 });
    expect(rows[1]).toEqual({ day: '2001-01-02', sign_ins: 0, active_members: 0 });
    expect(rows.at(-1)).toEqual({ day: '2001-02-10', sign_ins: 3, active_members: 2 });

    // A second run keeps nothing again and changes nothing.
    expect((await service.purge(NOW)).activity_days_kept).toBe(0);
    expect(await report2001()).toEqual(before);
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

  it('purges pending picks 30 days after kick-off, and a converted one at the next run (T-1740)', async () => {
    const predictionsBefore = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM prediction_version v
         JOIN user_prediction p ON p.id = v.prediction_id
        WHERE p.user_id = ANY($1::uuid[])`,
      [[member, other]],
    );
    await service.purge(NOW);
    expect(await exists('pending_pick', ids.pickOldWaiting ?? '')).toBe(false);
    expect(await exists('pending_pick', ids.pickOldReplaced ?? '')).toBe(false);
    expect(await exists('pending_pick', ids.pickConverted ?? '')).toBe(false);
    expect(await exists('pending_pick', ids.pickRecentWaiting ?? '')).toBe(true);
    expect(await exists('pending_pick', ids.pickRecentExpired ?? '')).toBe(true);
    expect(await exists('pending_pick', ids.pickConvertedLater ?? '')).toBe(true);

    // In bounded batches like every other table, and a second run finds nothing.
    expect(
      await purgeInBatches(
        (limit) => store.deletePendingPicks(new Date('2001-05-02T03:23:00Z'), limit, NOW),
        2,
      ),
    ).toEqual({ deleted: 0, batches: 1, capped: false });

    // No prediction is touched: a pending pick is not one (rule 8).
    const predictionsAfter = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM prediction_version v
         JOIN user_prediction p ON p.id = v.prediction_id
        WHERE p.user_id = ANY($1::uuid[])`,
      [[member, other]],
    );
    expect(predictionsAfter.rows).toEqual(predictionsBefore.rows);
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
