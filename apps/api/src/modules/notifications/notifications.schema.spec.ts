import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_KINDS } from '@fmip/contracts';

/**
 * Notifications against the real schema (T-270).
 *
 * Nothing in the API writes these tables yet — emission is T-271 and the inbox
 * is T-272 — so this writes what the service will write and checks the three
 * guarantees that belong to the database.
 *
 * **A block stops a notification at emission**, which is the only place it
 * works: the fastest way to undo a block is a notification saying the blocked
 * member did something.
 *
 * **Nothing is emitted twice**, enforced by an index rather than remembered by
 * an emitter.
 *
 * **Quiet hours wrap midnight**, which is the ordinary case and the one a naive
 * range comparison gets exactly backwards — quiet all day except at night.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('notifications', () => {
  let pool: Pool;
  const members: string[] = [];

  async function member(label: string, timezone = 'Europe/London'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', $5, now(), now())
       RETURNING id`,
      [
        `nt${label}${RUN}`.toLowerCase().slice(0, 20),
        `Notified ${label}`,
        `nt${label}${RUN}@example.test`.toLowerCase(),
        ENGLAND,
        timezone,
      ],
    );
    const id = rows[0]?.id ?? '';
    members.push(id);
    return id;
  }

  const notify = (
    userId: string,
    kind = 'friend_request',
    options: { source?: string; subjectId?: string; dedupe?: string | null } = {},
  ) =>
    pool.query<{ id: string }>(
      `INSERT INTO notification (user_id, kind, subject_type, subject_id, source_id, dedupe_key)
       VALUES ($1, $2, 'member', $3, $4, $5) RETURNING id`,
      [
        userId,
        kind,
        options.subjectId ?? options.source ?? userId,
        options.source ?? null,
        options.dedupe ?? null,
      ],
    );

  const quietAt = (userId: string, moment: string) =>
    pool
      .query<{ yes: boolean }>(`SELECT in_quiet_hours($1, $2::timestamptz) AS yes`, [
        userId,
        moment,
      ])
      .then(({ rows }) => rows[0]?.yes ?? false);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool === undefined) return;
    // Everything here cascades from `user_account`, so one delete is enough and
    // the replica dance the immutable tables need is not.
    await pool.query(`DELETE FROM user_block WHERE blocker_id = ANY($1::uuid[])`, [members]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [members]);
    await pool.end();
  });

  describe('a notification is addressed to somebody, about something', () => {
    it('carries a deep link and refuses a kind the product cannot emit', async () => {
      const who = await member('a1');
      await expect(notify(who, 'prediction_settled')).resolves.toBeTruthy();
      await expect(notify(who, 'someone_liked_your_haircut')).rejects.toMatchObject({
        constraint: 'notification_kind_check',
      });
    });

    it('refuses a subject the inbox could not open', async () => {
      const who = await member('a2');
      await expect(
        pool.query(
          `INSERT INTO notification (user_id, kind, subject_type, subject_id)
           VALUES ($1, 'rating_changed', 'a_vibe', 'x')`,
          [who],
        ),
      ).rejects.toMatchObject({ constraint: 'notification_subject_kind' });
    });

    it('refuses notifying somebody about themselves', async () => {
      const who = await member('a3');
      await expect(notify(who, 'mentioned', { source: who })).rejects.toMatchObject({
        constraint: 'notification_not_self',
      });
    });

    it('says why it was held, or was not held', async () => {
      const who = await member('a4');
      await expect(
        pool.query(
          `INSERT INTO notification (user_id, kind, subject_type, subject_id, held_reason)
           VALUES ($1, 'rating_changed', 'member', $2, '   ')`,
          [who, who],
        ),
      ).rejects.toMatchObject({ constraint: 'notification_hold_is_whole' });
    });

    it('will not be delivered before it existed', async () => {
      const who = await member('a5');
      await expect(
        pool.query(
          `INSERT INTO notification (user_id, kind, subject_type, subject_id, deliver_after)
           VALUES ($1, 'rating_changed', 'member', $2, now() - interval '1 hour')`,
          [who, who],
        ),
      ).rejects.toMatchObject({ constraint: 'notification_delivers_after_creation' });
    });
  });

  describe('a block stops it at emission', () => {
    it('refuses one from a member the recipient blocked', async () => {
      const [recipient, blocked] = await Promise.all([member('b1'), member('b2')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
        recipient,
        blocked,
      ]);
      await expect(notify(recipient, 'mentioned', { source: blocked })).rejects.toMatchObject({
        code: 'PL003',
      });
    });

    it('refuses one the other way round too', async () => {
      const [blocker, recipient] = await Promise.all([member('b3'), member('b4')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
        blocker,
        recipient,
      ]);
      // The blocker hearing from the person they blocked is the obvious case;
      // this is the other one, and `users_blocked` answers both because a block
      // is not a direction (T-200).
      await expect(notify(recipient, 'mentioned', { source: blocker })).rejects.toMatchObject({
        code: 'PL003',
      });
    });

    it('lets a sourceless notification through, because there is nobody to block', async () => {
      const [recipient, blocked] = await Promise.all([member('b5'), member('b6')]);
      await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2)`, [
        recipient,
        blocked,
      ]);
      // A settlement has no member behind it. Refusing it because the recipient
      // blocked somebody unrelated would be a block applied to the product.
      await expect(notify(recipient, 'prediction_settled')).resolves.toBeTruthy();
    });
  });

  describe('nothing is emitted twice', () => {
    it('refuses a second notification with the same dedupe key', async () => {
      const [who, source] = await Promise.all([member('d1'), member('d2')]);
      await notify(who, 'friend_request', { source, dedupe: `fr:${source}` });
      await expect(
        notify(who, 'friend_request', { source, dedupe: `fr:${source}` }),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('allows as many as the emitter wants when it gives no key', async () => {
      const [who, source] = await Promise.all([member('d3'), member('d4')]);
      // Two messages in one conversation an hour apart are two notifications.
      // An emitter with nothing sensible to deduplicate on is not forced to
      // invent a key.
      await expect(notify(who, 'message_received', { source })).resolves.toBeTruthy();
      await expect(notify(who, 'message_received', { source })).resolves.toBeTruthy();
    });

    it('scopes the key to the member and the kind', async () => {
      const [one, two, source] = await Promise.all([member('d5'), member('d6'), member('d7')]);
      await notify(one, 'friend_request', { source, dedupe: 'same' });
      // The same key for a different recipient, and for a different kind, are
      // different notifications.
      await expect(notify(two, 'friend_request', { source, dedupe: 'same' })).resolves.toBeTruthy();
      await expect(notify(one, 'mentioned', { source, dedupe: 'same' })).resolves.toBeTruthy();
    });
  });

  describe('a preference is a departure from the default', () => {
    it('stores only what the member chose', async () => {
      const who = await member('p1');
      const before = await pool.query(`SELECT 1 FROM notification_preference WHERE user_id = $1`, [
        who,
      ]);
      // No rows at registration. Writing every default in would freeze this
      // member's settings at the day they joined: changing a default afterwards
      // would reach nobody, silently.
      expect(before.rows).toHaveLength(0);

      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product)
         VALUES ($1, 'mentioned', false)`,
        [who],
      );
      const after = await pool.query<{ kind: string }>(
        `SELECT kind FROM notification_preference WHERE user_id = $1`,
        [who],
      );
      expect(after.rows.map((r) => r.kind)).toEqual(['mentioned']);
    });

    it('allows one row per kind and no more', async () => {
      const who = await member('p2');
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product) VALUES ($1, 'mentioned', false)`,
        [who],
      );
      await expect(
        pool.query(
          `INSERT INTO notification_preference (user_id, kind, in_product) VALUES ($1, 'mentioned', true)`,
          [who],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('refuses a preference for a kind that cannot be emitted', async () => {
      const who = await member('p3');
      await expect(
        pool.query(
          `INSERT INTO notification_preference (user_id, kind, in_product)
           VALUES ($1, 'weekly_digest', true)`,
          [who],
        ),
      ).rejects.toMatchObject({ constraint: 'notification_preference_kind_check' });
    });

    it('accepts every kind the contract names, and the contract names every kind', async () => {
      const who = await member('p4');
      for (const kind of NOTIFICATION_KINDS) {
        await expect(
          pool.query(
            `INSERT INTO notification_preference (user_id, kind, in_product) VALUES ($1, $2, true)`,
            [who, kind],
          ),
        ).resolves.toBeTruthy();
      }
      // The list in the schema and the list in the contract are two copies of
      // one fact, so the one thing worth checking is that they still agree.
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'notification_preference_kind_check'`,
      );
      const definition = rows[0]?.def ?? '';
      for (const kind of NOTIFICATION_KINDS) expect(definition).toContain(`'${kind}'`);
      // And a default for each, so no kind reaches a member with no documented
      // answer.
      for (const kind of NOTIFICATION_KINDS) {
        expect(NOTIFICATION_DEFAULTS[kind], `no default for ${kind}`).toBeTypeOf('boolean');
      }
    });
  });

  describe('quiet hours are read in the member own timezone', () => {
    it('holds inside an ordinary window and not outside it', async () => {
      const who = await member('q1', 'Europe/London');
      await pool.query(
        `INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, '13:00', '14:00')`,
        [who],
      );
      // 13:30 London on a summer date is 12:30Z.
      expect(await quietAt(who, '2026-07-01T12:30:00Z')).toBe(true);
      expect(await quietAt(who, '2026-07-01T14:30:00Z')).toBe(false);
    });

    it('handles a window that wraps midnight, which is the ordinary case', async () => {
      const who = await member('q2', 'Europe/London');
      await pool.query(
        `INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, '23:00', '07:00')`,
        [who],
      );
      // Read as a single range, 23:00–07:00 means the exact opposite: quiet all
      // day except at night. So both ends are checked, and so is the middle.
      expect(await quietAt(who, '2026-01-15T23:30:00Z')).toBe(true);
      expect(await quietAt(who, '2026-01-16T03:00:00Z')).toBe(true);
      expect(await quietAt(who, '2026-01-16T12:00:00Z')).toBe(false);
    });

    it('is their clock, not the server one', async () => {
      const [london, tehran] = await Promise.all([
        member('q3', 'Europe/London'),
        member('q4', 'Asia/Tehran'),
      ]);
      for (const who of [london, tehran]) {
        await pool.query(
          `INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, '23:00', '07:00')`,
          [who],
        );
      }
      // The same instant: 20:00Z is 21:00 in London (BST) and 23:30 in Tehran.
      const moment = '2026-07-01T20:00:00Z';
      expect(await quietAt(london, moment)).toBe(false);
      expect(await quietAt(tehran, moment)).toBe(true);
    });

    it('refuses a window that means both everything and nothing', async () => {
      const who = await member('q5');
      await expect(
        pool.query(
          `INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, '09:00', '09:00')`,
          [who],
        ),
      ).rejects.toMatchObject({ constraint: 'quiet_hours_not_empty' });
    });

    it('says no for a member who set none', async () => {
      const who = await member('q6');
      expect(await quietAt(who, '2026-01-16T03:00:00Z')).toBe(false);
    });
  });
});
