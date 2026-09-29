import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  Group,
  GroupAppealResponse,
  GroupModerationView,
  GroupsResponse,
  ModerationQueueResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { GroupsModule } from '../groups/groups.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SocialModule } from '../social/social.module';
import { ModerationModule } from './moderation.module';

/**
 * Administrators and groups (T-1025, D-135), against the real schema.
 *
 * The acceptance criterion: a report about a group reaches the queue; closing
 * makes the group read-only to its members, takes it out of the directory and
 * says why; reopening takes a reason too; content is removed with a reason;
 * each is an audited `moderation_decision` naming the actor, the reason and
 * the previous state; members can still leave and read; the owner can appeal.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'groups and administrators',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const mod = `gm_${RUN}m`;
    const owner = `gm_${RUN}o`;
    const member = `gm_${RUN}e`;
    const reporter = `gm_${RUN}r`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    let made = 0;

    const as = (who?: string) =>
      who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
    const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
    const post = (url: string, payload: unknown, who?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as Record<string, unknown>,
        headers: as(who),
      });
    const patch = (url: string, payload: unknown, who?: string) =>
      app.inject({
        method: 'PATCH',
        url,
        payload: payload as Record<string, unknown>,
        headers: as(who),
      });
    const del = (url: string, who?: string) =>
      app.inject({ method: 'DELETE', url, headers: as(who) });

    const register = async (username: string) => {
      const response = await post('/auth/register', {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      expect(response.statusCode).toBe(201);
      cookies.set(username, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [username],
      );
      ids.set(username, rows[0]?.id ?? '');
    };

    /** A public group with a member, and its conversation. */
    const group = async (): Promise<{ slug: string; room: string }> => {
      await pool.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [
        [...ids.values()],
      ]);
      made += 1;
      const slug = `gm-${RUN}-${made}`.toLowerCase();
      expect(
        (
          await post(
            '/groups',
            { slug, name: `Closable ${RUN} ${made}`, visibility: 'public', description: 'about' },
            owner,
          )
        ).statusCode,
      ).toBe(201);
      expect((await post(`/groups/${slug}/members`, null, member)).statusCode).toBe(204);
      const body = (await get(`/groups/${slug}`, owner)).json() as { group: Group };
      return { slug, room: body.group.conversation_id as string };
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          DatabaseModule,
          IdentityModule,
          GroupsModule,
          ConversationsModule,
          ModerationModule,
          SocialModule,
        ],
      })
        .overrideProvider(MAILER)
        .useValue(new CaptureMailer())
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue(options)
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      for (const username of [mod, owner, member, reporter]) await register(username);
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'moderator', $1, 'the group moderation test')`,
        [ids.get(mod)],
      );
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM appeal_note WHERE author_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM report WHERE reporter_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM message WHERE author_id = ANY($1::uuid[])`, [everyone]);
        await client.query(
          `DELETE FROM conversation WHERE group_id IN
           (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(
          `DELETE FROM group_member WHERE user_id = ANY($1::uuid[])
            OR group_id IN (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM user_group WHERE created_by = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM user_role WHERE user_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gm_${RUN}%`]);
      await pool.end();
      await app.close();
    });

    it('takes a report about a group to the queue, beside the members', async () => {
      const { slug } = await group();
      const filed = await post(
        '/reports',
        { subject_type: 'group', subject: slug, reason: 'abuse' },
        reporter,
      );
      expect(filed.statusCode).toBe(204);
      const queue = (
        await get('/admin/moderation/queue?limit=200', mod)
      ).json() as ModerationQueueResponse;
      const entry = queue.groups.find((g) => g.slug === slug);
      expect(entry).toMatchObject({ subject_type: 'group', closed: null });
      expect(entry?.reports).toHaveLength(1);
      // An unknown group is unknown to a reporter.
      expect(
        (
          await post(
            '/reports',
            { subject_type: 'group', subject: 'nope-nope-nope', reason: 'spam' },
            reporter,
          )
        ).statusCode,
      ).toBe(404);
    });

    it('closes a group: read-only to members, out of the directory, and says why', async () => {
      const { slug, room } = await group();
      await post('/reports', { subject_type: 'group', subject: slug, reason: 'abuse' }, reporter);
      const view = (
        await get(`/admin/moderation/groups/${slug}`, mod)
      ).json() as GroupModerationView;
      const reportId = view.reports[0]?.id as string;

      expect((await post(`/admin/moderation/groups/${slug}/close`, {}, mod)).statusCode).toBe(400);
      const closed = await post(
        `/admin/moderation/groups/${slug}/close`,
        { reason: 'Organised harassment.', report_ids: [reportId] },
        mod,
      );
      expect(closed.statusCode).toBe(201);
      expect(closed.json()).toMatchObject({ answered: 1 });
      expect(
        (await post(`/admin/moderation/groups/${slug}/close`, { reason: 'Again.' }, mod))
          .statusCode,
      ).toBe(409);

      const seen = (await get(`/groups/${slug}`, member)).json() as { group: Group };
      expect(seen.group.closed).toMatchObject({ reason: 'Organised harassment.' });
      expect(seen.group.may_invite).toBe(false);

      // Nothing new: a message, a join, a settings change.
      const said = await post(
        `/me/conversations/${room}/messages`,
        { body: 'still here?' },
        member,
      );
      expect(said.statusCode).toBe(409);
      expect((said.json() as { message: string }).message).toMatch(/closed/);
      expect((await post(`/groups/${slug}/members`, null, reporter)).statusCode).toBe(409);
      expect((await patch(`/groups/${slug}`, { name: 'Renamed' }, owner)).statusCode).toBe(409);
      expect((await del(`/groups/${slug}`, owner)).statusCode).toBe(409);

      // Out of the directory.
      const listed = (
        await get(`/groups?q=${encodeURIComponent(`Closable ${RUN}`)}`, reporter)
      ).json() as GroupsResponse;
      expect(listed.groups.map((g) => g.slug)).not.toContain(slug);

      // Reading and leaving stay open.
      expect((await get(`/me/conversations/${room}`, member)).statusCode).toBe(200);
      expect((await del(`/groups/${slug}/members/me`, member)).statusCode).toBe(204);

      // Audited: a decision naming the actor and the reason, and the state before.
      const decision = await pool.query<{ moderator_id: string; outcome: string; reason: string }>(
        `SELECT moderator_id, outcome, reason FROM moderation_decision
        WHERE subject_type = 'group' AND subject_id = (SELECT id::text FROM user_group WHERE slug = $1)`,
        [slug],
      );
      expect(decision.rows).toEqual([
        { moderator_id: ids.get(mod), outcome: 'group_closed', reason: 'Organised harassment.' },
      ]);
      const audit = await pool.query<{ action: string; previous: { closed_at: unknown } }>(
        `SELECT action, previous FROM audit_log
        WHERE target_type = 'user_group' AND target_id = (SELECT id::text FROM user_group WHERE slug = $1)`,
        [slug],
      );
      expect(audit.rows).toEqual([
        { action: 'moderation.group_close', previous: { closed_at: null, closed_reason: null } },
      ]);
    });

    it('reopens with a reason, and the group takes writes again', async () => {
      const { slug, room } = await group();
      await post(`/admin/moderation/groups/${slug}/close`, { reason: 'Spam ring.' }, mod);
      expect((await post(`/admin/moderation/groups/${slug}/reopen`, {}, mod)).statusCode).toBe(400);
      expect(
        (await post(`/admin/moderation/groups/${slug}/reopen`, { reason: 'Appeal upheld.' }, mod))
          .statusCode,
      ).toBe(201);
      expect(
        (await post(`/admin/moderation/groups/${slug}/reopen`, { reason: 'Twice.' }, mod))
          .statusCode,
      ).toBe(409);
      expect(
        (await post(`/me/conversations/${room}/messages`, { body: 'back again' }, member))
          .statusCode,
      ).toBe(201);
      const view = (
        await get(`/admin/moderation/groups/${slug}`, mod)
      ).json() as GroupModerationView;
      expect(view.closed).toBeNull();
      expect(view.decisions.map((d) => d.outcome)).toEqual(['group_reopened', 'group_closed']);
    });

    it('removes content with a reason, keeping it as it was in the audit row', async () => {
      const { slug, room } = await group();
      const sent = await post(
        `/me/conversations/${room}/messages`,
        { body: 'the bad words' },
        member,
      );
      const id = (sent.json() as { message: { id: string } }).message.id;
      expect(
        (await post(`/admin/moderation/groups/${slug}/removal`, { reason: 'Hate.' }, mod))
          .statusCode,
      ).toBe(400);
      const removed = await post(
        `/admin/moderation/groups/${slug}/removal`,
        { reason: 'Hate.', message_ids: [id], description: true },
        mod,
      );
      expect(removed.statusCode).toBe(201);
      const page = (await get(`/me/conversations/${room}`, member)).json() as {
        messages: { id: string; body: string | null; removed: { by: string } | null }[];
      };
      expect(page.messages.find((m) => m.id === id)).toMatchObject({
        body: null,
        removed: { by: 'moderator' },
      });
      const seen = (await get(`/groups/${slug}`, member)).json() as { group: Group };
      expect(seen.group.description).toBeNull();
      const audit = await pool.query<{
        previous: { messages: { body: string }[]; description: string };
      }>(
        `SELECT previous FROM audit_log WHERE action = 'moderation.group_content'
          AND target_id = (SELECT id::text FROM user_group WHERE slug = $1)`,
        [slug],
      );
      expect(audit.rows[0]?.previous.messages[0]?.body).toBe('the bad words');
      expect(audit.rows[0]?.previous.description).toBe('about');
      // Naming nothing still standing is refused.
      expect(
        (
          await post(
            `/admin/moderation/groups/${slug}/removal`,
            { reason: 'Hate.', message_ids: [id] },
            mod,
          )
        ).statusCode,
      ).toBe(409);
    });

    it('lets the owner, and only the owner, appeal a closure', async () => {
      const { slug } = await group();
      expect((await get(`/groups/${slug}/closure/appeal`, owner)).statusCode).toBe(409);
      await post(`/admin/moderation/groups/${slug}/close`, { reason: 'Impersonation.' }, mod);
      expect((await post(`/groups/${slug}/closure/appeal`, { body: 'x' }, member)).statusCode).toBe(
        403,
      );
      expect((await post(`/groups/${slug}/closure/appeal`, { body: ' ' }, owner)).statusCode).toBe(
        400,
      );
      const appealed = await post(
        `/groups/${slug}/closure/appeal`,
        { body: 'We are a supporters club, not impostors.' },
        owner,
      );
      expect(appealed.statusCode).toBe(201);
      const response = appealed.json() as GroupAppealResponse;
      expect(response.closed.reason).toBe('Impersonation.');
      expect(response.notes.map((n) => n.author)).toEqual([owner]);
      const view = (
        await get(`/admin/moderation/groups/${slug}`, mod)
      ).json() as GroupModerationView;
      expect(view.appeal).toHaveLength(1);
    });

    it("is the schema's rule: nothing is inserted into a closed group, whatever the caller", async () => {
      const { slug, room } = await group();
      await post(`/admin/moderation/groups/${slug}/close`, { reason: 'Closed.' }, mod);
      await expect(
        pool.query(
          `INSERT INTO message (conversation_id, author_id, body) VALUES ($1, $2, 'sneaky')`,
          [room, ids.get(owner)],
        ),
      ).rejects.toMatchObject({ code: 'PL021' });
    });

    it("leaves a closed group's content to the administrators, not its own moderators", async () => {
      const { slug, room } = await group();
      const sent = await post(`/me/conversations/${room}/messages`, { body: 'before' }, member);
      const id = (sent.json() as { message: { id: string } }).message.id;
      await post(`/admin/moderation/groups/${slug}/close`, { reason: 'Closed.' }, mod);
      const refused = await post(
        `/me/conversations/${room}/messages/${id}/removal`,
        { reason: 'Tidying up.' },
        owner,
      );
      expect(refused.statusCode).toBe(409);
    });

    it('refuses the queue actions to a member', async () => {
      const { slug } = await group();
      expect((await get(`/admin/moderation/groups/${slug}`, member)).statusCode).toBe(403);
      expect(
        (await post(`/admin/moderation/groups/${slug}/close`, { reason: 'x' }, member)).statusCode,
      ).toBe(403);
    });
  },
);
