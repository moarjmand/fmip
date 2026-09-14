import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConversationsResponse, Group } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SocialModule } from '../social/social.module';
import { GroupsModule } from './groups.module';

/**
 * The acceptance criterion for T-245: **membership changes take effect on the
 * conversation immediately.**
 *
 * "Immediately" here means *with nothing to synchronise*. A group conversation's
 * membership is the group's — `conversation_participant` holds the read position
 * and the mute and no authority at all — so joining, leaving and being removed
 * land on the conversation in the same statement that changes the group. These
 * tests do the membership change and then immediately ask the conversation,
 * with no step in between, because a step in between is exactly what a mirrored
 * membership would have needed.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('a group conversation', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const ada = `gc_${RUN}a`;
  const bo = `gc_${RUN}b`;
  const cass = `gc_${RUN}c`;
  const stranger = `gc_${RUN}s`;
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

  /** A public group and its conversation, as the product makes them. */
  const group = async (who: string): Promise<{ slug: string; room: string }> => {
    await pool.query(`DELETE FROM rate_window WHERE user_id = $1 AND action = 'group_create'`, [
      ids.get(who) ?? '',
    ]);
    made += 1;
    const slug = `gc-${RUN}-${made}`.toLowerCase();
    expect(
      (await post('/groups', { slug, name: `Room ${made}`, visibility: 'public' }, who)).statusCode,
    ).toBe(201);
    const body = (await get(`/groups/${slug}`, who)).json() as { group: Group };
    expect(body.group.conversation_id).not.toBeNull();
    return { slug, room: body.group.conversation_id as string };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, GroupsModule, ConversationsModule, SocialModule],
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

    for (const username of [ada, bo, cass, stranger]) await register(username);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
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
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gc_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('exists from the moment the group does, and says which group it is', async () => {
    const { slug, room } = await group(ada);
    const page = (await get(`/me/conversations/${room}`, ada)).json() as {
      conversation: {
        kind: string;
        group: { slug: string; name: string } | null;
        members: unknown[];
      };
    };
    expect(page.conversation.kind).toBe('group');
    expect(page.conversation.group).toMatchObject({ slug });
    // Not a conversation *with* particular people: its membership is the
    // group's, and `group` being non-null is exactly when `members` is empty.
    expect(page.conversation.members).toEqual([]);
  });

  it('is closed to somebody who is not in the group, and does not admit it exists', async () => {
    const { room } = await group(ada);
    expect((await get(`/me/conversations/${room}`, stranger)).statusCode).toBe(404);
    expect(
      (await post(`/me/conversations/${room}/messages`, { body: 'let me in' }, stranger))
        .statusCode,
    ).toBe(404);
  });

  describe('a membership change lands on the conversation with nothing in between', () => {
    it('opens the moment somebody joins', async () => {
      const { slug, room } = await group(ada);
      expect((await get(`/me/conversations/${room}`, bo)).statusCode).toBe(404);

      expect((await post(`/groups/${slug}/members`, null, bo)).statusCode).toBe(204);

      // No second write anywhere: the next request simply finds them in it.
      expect((await get(`/me/conversations/${room}`, bo)).statusCode).toBe(200);
      expect(
        (await post(`/me/conversations/${room}/messages`, { body: 'hello everyone' }, bo))
          .statusCode,
      ).toBe(201);
    });

    it('closes the moment somebody leaves', async () => {
      const { slug, room } = await group(ada);
      await post(`/groups/${slug}/members`, null, bo);
      expect(
        (await post(`/me/conversations/${room}/messages`, { body: 'while I am here' }, bo))
          .statusCode,
      ).toBe(201);

      expect((await del(`/groups/${slug}/members/me`, bo)).statusCode).toBe(204);

      expect((await get(`/me/conversations/${room}`, bo)).statusCode).toBe(404);
      expect(
        (await post(`/me/conversations/${room}/messages`, { body: 'and after' }, bo)).statusCode,
      ).toBe(404);
    });

    it('closes the moment an owner removes somebody', async () => {
      const { slug, room } = await group(ada);
      await post(`/groups/${slug}/members`, null, cass);
      expect((await get(`/me/conversations/${room}`, cass)).statusCode).toBe(200);

      expect((await del(`/groups/${slug}/members/${cass}`, ada)).statusCode).toBe(204);

      expect((await get(`/me/conversations/${room}`, cass)).statusCode).toBe(404);
    });

    it('shows and hides it in the list of conversations the same way', async () => {
      const { slug, room } = await group(ada);
      const before = (await get('/me/conversations', bo)).json() as ConversationsResponse;
      expect(before.conversations.map((c) => c.id)).not.toContain(room);

      await post(`/groups/${slug}/members`, null, bo);
      const during = (await get('/me/conversations', bo)).json() as ConversationsResponse;
      expect(during.conversations.map((c) => c.id)).toContain(room);

      await del(`/groups/${slug}/members/me`, bo);
      const after = (await get('/me/conversations', bo)).json() as ConversationsResponse;
      expect(after.conversations.map((c) => c.id)).not.toContain(room);
    });
  });

  it('is left by leaving the group, and says so rather than doing nothing', async () => {
    // `left_at` on a group conversation would change nothing and report
    // success, which is a silent no-op wearing the shape of a result.
    const { slug, room } = await group(ada);
    await post(`/groups/${slug}/members`, null, bo);
    const refused = await post(`/me/conversations/${room}/leave`, null, bo);
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { message: string }).message).toMatch(/leave the group/i);
    // And they are still in it.
    expect((await get(`/me/conversations/${room}`, bo)).statusCode).toBe(200);
  });

  it('remembers a read position and a mute for somebody who never had a row', async () => {
    // A group member gets no `conversation_participant` row when they join —
    // that row is a read position and a mute, not a membership — so the first
    // mute has to write one rather than update nothing.
    const { slug, room } = await group(ada);
    await post(`/groups/${slug}/members`, null, cass);
    expect((await post(`/me/conversations/${room}/mute`, null, cass)).statusCode).toBe(204);

    const page = (await get(`/me/conversations/${room}`, cass)).json() as {
      conversation: { muted: boolean; left: boolean };
    };
    expect(page.conversation.muted).toBe(true);
    // Never "left": a group conversation has no such state, and a missing row
    // must not be read as one.
    expect(page.conversation.left).toBe(false);
  });

  it('holds two members who have blocked each other, and lets both speak', async () => {
    // The case the mention guard of T-225 was built for, finally reachable: a
    // block stops them reaching *each other*, not sharing a room.
    const { slug, room } = await group(ada);
    await post(`/groups/${slug}/members`, null, bo);
    await post(`/groups/${slug}/members`, null, cass);
    expect((await post(`/me/blocks/${cass}`, null, bo)).statusCode).toBe(204);

    for (const who of [bo, cass]) {
      expect(
        (await post(`/me/conversations/${room}/messages`, { body: `said by ${who}` }, who))
          .statusCode,
      ).toBe(201);
    }

    // The mention does not go through, and the message still does.
    const mentioning = await post(
      `/me/conversations/${room}/messages`,
      { body: `what do you think @${cass}` },
      bo,
    );
    expect(mentioning.statusCode).toBe(201);
    expect((mentioning.json() as { message: { mentions: string[] } }).message.mentions).toEqual([]);

    await del(`/me/blocks/${cass}`, bo);
  });
});
