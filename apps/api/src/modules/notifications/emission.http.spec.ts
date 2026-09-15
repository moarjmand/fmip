import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { GroupsModule } from '../groups/groups.module';
import { ModerationModule } from '../moderation/moderation.module';
import { SocialModule } from '../social/social.module';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

/**
 * Emitting notifications from the events that already happen (T-271).
 *
 * The acceptance criterion is two negatives — **nothing is emitted twice, and
 * nothing is emitted to somebody who blocked the source** — and negatives are
 * what this file is shaped around. Both are enforced by the database rather
 * than by the emitter, so both are tested by making the emitter try.
 *
 * The first producer is the social graph, chosen because it is the clearest
 * block case: a friend request is a member reaching another member, which is
 * exactly what a block is for.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('emitting notifications', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let notifications: NotificationsService;

  const alice = `em${RUN}a`;
  const bob = `em${RUN}b`;
  const carol = `em${RUN}c`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  const as = (who: string) => ({ cookie: `fmip_session=${cookies.get(who) ?? ''}` });
  const send = (method: 'POST' | 'DELETE', url: string, who: string) =>
    app.inject({ method, url, headers: as(who) });

  const notificationsFor = (who: string) =>
    pool
      .query<{ kind: string; source: string | null; subject_id: string }>(
        `SELECT n.kind, source.username AS source, n.subject_id
             FROM notification n
             LEFT JOIN user_account source ON source.id = n.source_id
            WHERE n.user_id = $1 ORDER BY n.created_at`,
        [ids.get(who)],
      )
      .then(({ rows }) => rows);

  async function register(username: string): Promise<void> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SocialModule, NotificationsModule, GroupsModule, ModerationModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    notifications = app.get(NotificationsService);

    for (const username of [alice, bob, carol]) await register(username);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    // `notification`, `notification_preference`, `friend_request`, `friendship`
    // and `user_block` all cascade from the account, so one delete unwinds the
    // lot.
    await pool.query(`DELETE FROM user_block WHERE blocker_id = ANY($1::uuid[])`, [everyone]);
    // Moderation records are RESTRICT on purpose -- one that vanished with the
    // account it was about would be the wrong trade (T-210) -- so they are
    // unwound in order, with the immutable ones behind a session-local
    // trigger-off.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      // The group goes before its owner's account. `group_member` carries a
      // deferred constraint trigger requiring at least one owner (T-240), so a
      // cascade that removed the owner would leave the group ownerless and the
      // whole delete would fail with "a group must have an owner".
      await client.query(
        `DELETE FROM group_member WHERE group_id IN (SELECT id FROM user_group WHERE slug = $1)`,
        [`g${RUN}`],
      );
      await client.query(
        `DELETE FROM group_invite WHERE group_id IN (SELECT id FROM user_group WHERE slug = $1)`,
        [`g${RUN}`],
      );
      await client.query(`DELETE FROM user_group WHERE slug = $1`, [`g${RUN}`]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
    await pool.end();
    await app.close();
  });

  describe('a friend request tells the person it was sent to', () => {
    it('emits once, naming who sent it and what to open', async () => {
      expect((await send('POST', `/me/friend-requests/${bob}`, alice)).statusCode).toBeLessThan(
        300,
      );
      const theirs = await notificationsFor(bob);
      expect(theirs).toHaveLength(1);
      expect(theirs[0]?.kind).toBe('friend_request');
      expect(theirs[0]?.source).toBe(alice);
      // The deep link: the member whose profile the recipient should open.
      expect(theirs[0]?.subject_id).toBe(ids.get(alice));
    });

    it('does not tell them again when the same request is re-sent', async () => {
      // The request already stands, so the second call changes nothing --
      // and telling somebody twice about something that has not changed is
      // exactly the "emitted twice" this task is measured by.
      await send('POST', `/me/friend-requests/${bob}`, alice);
      expect(await notificationsFor(bob)).toHaveLength(1);
    });

    it('tells the sender when it is accepted, and nobody else', async () => {
      expect(
        (await send('POST', `/me/friend-requests/${alice}/accept`, bob)).statusCode,
      ).toBeLessThan(300);
      const senders = await notificationsFor(alice);
      expect(senders.map((n) => n.kind)).toEqual(['friend_accepted']);
      expect(senders[0]?.source).toBe(bob);
      // And the accepter is not told about their own acceptance.
      expect((await notificationsFor(bob)).map((n) => n.kind)).toEqual(['friend_request']);
    });
  });

  describe('nothing is emitted to somebody who blocked the source', () => {
    it('writes nothing, and says so rather than failing', async () => {
      expect((await send('POST', `/me/blocks/${carol}`, alice)).statusCode).toBeLessThan(300);

      // Emitted directly, because the social surface refuses the request
      // itself across a block -- which is right, and would leave this rule
      // untested through the front door. The guard exists for every future
      // producer, not only this one.
      const outcome = await notifications.emit({
        userId: ids.get(alice) ?? '',
        kind: 'mentioned',
        subjectType: 'message',
        subjectId: 'whatever',
        sourceId: ids.get(carol) ?? '',
      });
      expect(outcome).toBe('blocked');
      expect((await notificationsFor(alice)).some((n) => n.kind === 'mentioned')).toBe(false);
    });

    it('refuses it the other way round too', async () => {
      // Alice blocked Carol. Carol hearing about Alice is the less obvious
      // direction and the one a check written from the blocker's side would
      // miss; `users_blocked` answers both, because a block is not a
      // direction (T-200).
      const outcome = await notifications.emit({
        userId: ids.get(carol) ?? '',
        kind: 'mentioned',
        subjectType: 'message',
        subjectId: 'whatever',
        sourceId: ids.get(alice) ?? '',
      });
      expect(outcome).toBe('blocked');
    });
  });

  describe('a member who turned a kind off does not get it', () => {
    it('is muted, and the emitter is told which', async () => {
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product)
           VALUES ($1, 'mentioned', false)`,
        [ids.get(bob)],
      );
      const outcome = await notifications.emit({
        userId: ids.get(bob) ?? '',
        kind: 'mentioned',
        subjectType: 'message',
        subjectId: 'whatever',
        sourceId: ids.get(carol) ?? '',
      });
      expect(outcome).toBe('muted');
    });

    it('follows the documented default for a kind nobody chose', async () => {
      // `panel_reaction` is off by default: a public panel can produce dozens
      // an evening and none of them needs answering.
      expect(await notifications.wants(ids.get(carol) ?? '', 'panel_reaction')).toBe(false);
      // `moderation_decision` is on, and a default that hid it would be the
      // product deciding not to explain itself.
      expect(await notifications.wants(ids.get(carol) ?? '', 'moderation_decision')).toBe(true);
      // And a stored choice beats the default in both directions.
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product)
           VALUES ($1, 'moderation_decision', false)`,
        [ids.get(carol)],
      );
      expect(await notifications.wants(ids.get(carol) ?? '', 'moderation_decision')).toBe(false);
    });
  });

  describe('the other producers, each from an event that already happened', () => {
    it('tells an invitee about a group invitation, once per group', async () => {
      const slug = `g${RUN}`;
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/groups',
            payload: { name: `Group ${RUN}`, slug, visibility: 'invite_only' },
            headers: as(alice),
          })
        ).statusCode,
      ).toBeLessThan(300);

      await app.inject({
        method: 'POST',
        url: `/groups/${slug}/invites/${bob}`,
        headers: as(alice),
      });
      const invited = (await notificationsFor(bob)).filter((n) => n.kind === 'group_invite');
      expect(invited).toHaveLength(1);
      expect(invited[0]?.source).toBe(alice);

      // Withdrawn and re-sent is the same group asking the same person.
      await app.inject({
        method: 'DELETE',
        url: `/groups/${slug}/invites/${bob}`,
        headers: as(alice),
      });
      await app.inject({
        method: 'POST',
        url: `/groups/${slug}/invites/${bob}`,
        headers: as(alice),
      });
      expect((await notificationsFor(bob)).filter((n) => n.kind === 'group_invite')).toHaveLength(
        1,
      );
    });

    it('tells a member what was decided about them, and does not name the moderator', async () => {
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'moderator', $1, 'the emission test')`,
        [ids.get(alice)],
      );
      const decided = await app.inject({
        method: 'POST',
        url: '/admin/moderation/decisions',
        payload: { subject: bob, outcome: 'warned', reason: 'a first warning' },
        headers: as(alice),
      });
      expect(decided.statusCode).toBeLessThan(300);

      const theirs = (await notificationsFor(bob)).filter((n) => n.kind === 'moderation_decision');
      expect(theirs).toHaveLength(1);
      // Policy section 2 promises the member is told *which* decision and
      // *why*, not who made it. Naming the moderator would hand a sanctioned
      // member a person to blame; the audit row names them, where it is read by
      // people who can be held responsible for reading it.
      expect(theirs[0]?.source).toBeNull();
    });
  });

  describe('emitting never breaks the thing that caused it', () => {
    it('reports a fault instead of throwing', async () => {
      // A subject type the schema does not allow. A real emitter would not
      // send one, which is the point: the failure that matters is the one
      // nobody predicted, and it must not undo an event that already
      // committed.
      const outcome = await notifications.emit({
        userId: ids.get(carol) ?? '',
        kind: 'rating_changed',
        subjectType: 'a_vibe' as never,
        subjectId: 'x',
      });
      expect(outcome).toBe('failed');
    });

    it('leaves the friendship alone when the notification is refused', async () => {
      // Dave blocks nobody, but his own preference is off, so the emit is
      // muted -- and the request still stands, which is the property worth
      // asserting: the consequence does not decide whether the cause happened.
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product)
           VALUES ($1, 'friend_request', false)`,
        [ids.get(carol)],
      );
      const response = await send('POST', `/me/friend-requests/${carol}`, bob);
      expect(response.statusCode).toBeLessThan(300);

      const standing = await pool.query(
        `SELECT 1 FROM friend_request WHERE requester_id = $1 AND addressee_id = $2`,
        [ids.get(bob), ids.get(carol)],
      );
      expect(standing.rows).toHaveLength(1);
      expect((await notificationsFor(carol)).some((n) => n.kind === 'friend_request')).toBe(false);
    });
  });
});
