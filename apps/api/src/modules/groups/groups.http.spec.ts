import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Group, GroupInvitesResponse, GroupsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
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
 * Groups over HTTP, against the real schema (T-241).
 *
 * The acceptance criterion in two halves: **every refusal the schema makes is
 * explained rather than returned as a 500**, and **a group nobody may see is
 * 404 rather than 403**.
 *
 * `SocialModule` is here because a block is what stops an invitation, and the
 * two boundaries meet on that verb.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('groups over HTTP', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const ada = `gh_${RUN}a`;
  const bo = `gh_${RUN}b`;
  const cass = `gh_${RUN}c`;
  const stranger = `gh_${RUN}s`;
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
  const put = (url: string, payload: unknown, who?: string) =>
    app.inject({
      method: 'PUT',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });
  const del = (url: string, who?: string) =>
    app.inject({ method: 'DELETE', url, headers: as(who) });

  const register = async (username: string, verify = true) => {
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
      verify
        ? `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`
        : `SELECT id FROM user_account WHERE username = $1`,
      [username],
    );
    ids.set(username, rows[0]?.id ?? '');
  };

  /**
   * A group, created the way the product creates one.
   *
   * The ceiling is five an hour and this suite makes far more than five, so the
   * window is cleared first: here a group is a fixture. The ceiling has a test
   * of its own below, where it is the subject rather than the scenery.
   */
  const group = async (who: string, visibility: string): Promise<string> => {
    await pool.query(`DELETE FROM rate_window WHERE user_id = $1 AND action = 'group_create'`, [
      ids.get(who) ?? '',
    ]);
    made += 1;
    const slug = `gh-${RUN}-${made}`.toLowerCase();
    const response = await post(
      '/groups',
      { slug, name: `Group ${made}`, visibility, description: 'a test group' },
      who,
    );
    expect(response.statusCode).toBe(201);
    return slug;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, GroupsModule, SocialModule],
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
      // The owner rule is a deferred constraint trigger, so it is a user trigger
      // like the rest and one session-scoped setting takes the lot. Restored
      // before the accounts go, or the foreign keys that clean up credentials
      // and sessions are switched off too (03-project-map.md).
      await client.query(`SET session_replication_role = 'replica'`);
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gh_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('tells a guest to sign in for anything of their own', async () => {
    for (const response of await Promise.all([
      get('/me/groups'),
      get('/me/group-invites'),
      post('/groups', { slug: 'x-y-z', name: 'No', visibility: 'public' }),
    ])) {
      expect(response.statusCode).toBe(401);
    }
    // The directory is not one of them: finding a group is what public means.
    expect((await get('/groups')).statusCode).toBe(200);
  });

  it('makes whoever creates a group its owner', async () => {
    const slug = await group(ada, 'public');
    const body = (await get(`/groups/${slug}`, ada)).json() as { group: Group };
    expect(body.group.standing).toBe('owner');
    expect(body.group.member_count).toBe(1);
    expect(body.group.members?.map((m) => m.username)).toEqual([ada]);
    expect(body.group.pending).toEqual({ invites: 0, requests: 0 });
  });

  it('says what is wrong with a handle rather than failing on the constraint', async () => {
    const bad = await post(
      '/groups',
      { slug: 'No Spaces', name: 'Fine', visibility: 'public' },
      ada,
    );
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { fields?: Record<string, string> }).fields?.slug).toBeTruthy();

    const taken = await group(ada, 'public');
    const again = await post('/groups', { slug: taken, name: 'Second', visibility: 'public' }, bo);
    expect(again.statusCode).toBe(409);
  });

  describe('what a stranger is shown', () => {
    it('answers 404 for an invite-only group, never 403', async () => {
      // 403 would confirm it exists, which is the one thing this visibility is
      // for. The same rule as a conversation somebody is not in (T-221).
      const slug = await group(ada, 'invite_only');
      expect((await get(`/groups/${slug}`, stranger)).statusCode).toBe(404);
      const listed = (await get('/groups')).json() as GroupsResponse;
      expect(listed.groups.map((g) => g.slug)).not.toContain(slug);
    });

    it('shows a discoverable group without showing who is in it', async () => {
      const slug = await group(ada, 'discoverable');
      const body = (await get(`/groups/${slug}`, stranger)).json() as { group: Group };
      expect(body.group.standing).toBe('may_ask');
      // Found, not read. An empty array would have said "nobody is in it",
      // which of a group is never true.
      expect(body.group.members).toBeNull();
      expect(body.group.pending).toBeNull();
      expect(body.group.member_count).toBe(1);
      const listed = (await get('/groups')).json() as GroupsResponse;
      expect(listed.groups.map((g) => g.slug)).toContain(slug);
    });
  });

  describe('how you get in follows from the visibility', () => {
    it('lets anybody into a public group', async () => {
      const slug = await group(ada, 'public');
      expect((await post(`/groups/${slug}/members`, null, bo)).statusCode).toBe(204);
      const body = (await get(`/groups/${slug}`, bo)).json() as { group: Group };
      expect(body.group.standing).toBe('member');
    });

    it('refuses the wrong door in both directions, and says so', async () => {
      const open = await group(ada, 'public');
      const closed = await group(ada, 'discoverable');
      // Asking an open group: join it.
      expect((await post(`/groups/${open}/requests`, null, bo)).statusCode).toBe(409);
      // Walking into one that asks: knock.
      expect((await post(`/groups/${closed}/members`, null, bo)).statusCode).toBe(409);
    });

    it('takes a request, shows it to whoever decides, and lets them accept it', async () => {
      const slug = await group(ada, 'discoverable');
      expect(
        (await post(`/groups/${slug}/requests`, { note: 'I follow this league' }, bo)).statusCode,
      ).toBe(204);

      // The asker's own view says what they have done.
      const asking = (await get(`/groups/${slug}`, bo)).json() as { group: Group };
      expect(asking.group.standing).toBe('requested');

      // Nobody but the people who run it may read the queue.
      expect((await get(`/groups/${slug}/requests`, bo)).statusCode).toBe(403);
      const queue = (await get(`/groups/${slug}/requests`, ada)).json() as {
        requests: { username: string; note: string | null }[];
      };
      expect(queue.requests).toHaveLength(1);
      expect(queue.requests[0]).toMatchObject({ username: bo, note: 'I follow this league' });

      expect((await post(`/groups/${slug}/requests/${bo}/accept`, null, ada)).statusCode).toBe(204);
      const now = (await get(`/groups/${slug}`, bo)).json() as { group: Group };
      expect(now.group.standing).toBe('member');
      expect(now.group.members).not.toBeNull();
    });

    it('is the only way into an invite-only group', async () => {
      const slug = await group(ada, 'invite_only');
      // Neither door exists for somebody who has not been asked, and neither
      // answer admits the group is there.
      expect((await post(`/groups/${slug}/members`, null, bo)).statusCode).toBe(404);
      expect((await post(`/groups/${slug}/requests`, null, bo)).statusCode).toBe(404);

      expect((await post(`/groups/${slug}/invites/${bo}`, null, ada)).statusCode).toBe(204);
      const invites = (await get('/me/group-invites', bo)).json() as GroupInvitesResponse;
      expect(invites.invites.map((i) => i.group.slug)).toContain(slug);
      expect(invites.invites[0]?.invited_by).toBe(ada);

      // The invitation is what makes it visible, and accepting it is what gets
      // them in.
      expect((await get(`/groups/${slug}`, bo)).json()).toMatchObject({
        group: { standing: 'invited' },
      });
      expect((await post(`/me/group-invites/${slug}/accept`, null, bo)).statusCode).toBe(204);
      expect((await get(`/groups/${slug}`, bo)).json()).toMatchObject({
        group: { standing: 'member' },
      });
    });

    it('refuses an invitation across a block without saying a block is why', async () => {
      const slug = await group(ada, 'invite_only');
      await post(`/me/blocks/${ada}`, null, cass);
      const refused = await post(`/groups/${slug}/invites/${cass}`, null, ada);
      expect(refused.statusCode).toBe(409);
      expect(JSON.stringify(refused.json())).not.toMatch(/block/i);
      await del(`/me/blocks/${cass}`, cass);
    });
  });

  describe('a group always has exactly one owner', () => {
    it('refuses to let the last owner walk out, and says what to do instead', async () => {
      const slug = await group(ada, 'public');
      const refused = await del(`/groups/${slug}/members/me`, ada);
      expect(refused.statusCode).toBe(409);
      expect((refused.json() as { message: string }).message).toMatch(/owner/i);
    });

    it('hands the group over in one move, then lets the old owner leave', async () => {
      const slug = await group(ada, 'public');
      expect((await post(`/groups/${slug}/members`, null, bo)).statusCode).toBe(204);
      expect(
        (await put(`/groups/${slug}/members/${bo}/role`, { role: 'owner' }, ada)).statusCode,
      ).toBe(204);

      const body = (await get(`/groups/${slug}`, bo)).json() as { group: Group };
      expect(body.group.standing).toBe('owner');
      expect(body.group.members?.filter((m) => m.role === 'owner')).toHaveLength(1);
      // Now there is somebody to leave behind.
      expect((await del(`/groups/${slug}/members/me`, ada)).statusCode).toBe(204);
    });

    it('will not let an owner demote themselves into an empty chair', async () => {
      const slug = await group(ada, 'public');
      await post(`/groups/${slug}/members`, null, bo);
      const refused = await put(`/groups/${slug}/members/${ada}/role`, { role: 'member' }, ada);
      expect(refused.statusCode).toBe(409);
    });
  });

  describe('what a moderator may do, and what only an owner may', () => {
    it('lets a moderator invite and remove, but not end the group', async () => {
      const slug = await group(ada, 'public');
      await post(`/groups/${slug}/members`, null, bo);
      await post(`/groups/${slug}/members`, null, cass);
      expect(
        (await put(`/groups/${slug}/members/${bo}/role`, { role: 'moderator' }, ada)).statusCode,
      ).toBe(204);

      expect(
        (await patch(`/groups/${slug}`, { name: 'Renamed by a moderator' }, bo)).statusCode,
      ).toBe(204);
      expect((await del(`/groups/${slug}/members/${cass}`, bo)).statusCode).toBe(204);
      // Running a group is not ending one.
      expect((await del(`/groups/${slug}`, bo)).statusCode).toBe(403);
      expect((await del(`/groups/${slug}`, ada)).statusCode).toBe(204);
    });

    it('refuses a member who runs nothing, and a stranger who is nobody', async () => {
      const slug = await group(ada, 'public');
      await post(`/groups/${slug}/members`, null, bo);
      expect((await patch(`/groups/${slug}`, { name: 'Not yours' }, bo)).statusCode).toBe(403);
      expect((await get(`/groups/${slug}/requests`, stranger)).statusCode).toBe(403);
      expect((await post(`/groups/${slug}/invites/${cass}`, null, bo)).statusCode).toBe(403);
    });

    it('never renames the handle, whatever is sent', async () => {
      const slug = await group(ada, 'public');
      // The contract has no slug to change; the database would refuse it too
      // (PL008). What a rename changes is the name.
      expect(
        (await patch(`/groups/${slug}`, { slug: 'a-new-handle', name: 'A new name' }, ada))
          .statusCode,
      ).toBe(204);
      expect((await get(`/groups/${slug}`, ada)).statusCode).toBe(200);
      expect((await get('/groups/a-new-handle', ada)).statusCode).toBe(404);
    });
  });

  it('lets somebody take back their own asking without asking anybody', async () => {
    // Getting out never needs a privilege, the same as everywhere else here.
    const slug = await group(ada, 'discoverable');
    expect((await post(`/groups/${slug}/requests`, null, bo)).statusCode).toBe(204);
    expect((await del(`/me/group-requests/${slug}`, bo)).statusCode).toBe(204);
    const body = (await get(`/groups/${slug}`, bo)).json() as { group: Group };
    expect(body.group.standing).toBe('may_ask');
  });

  it('serves the ceiling as 429, not as a stack trace', async () => {
    // Its own member, so the window it spends belongs to this test alone.
    const busy = `gh_${RUN}x`;
    await register(busy);
    for (let n = 0; n < 5; n += 1) {
      made += 1;
      expect(
        (
          await post(
            '/groups',
            {
              slug: `gh-${RUN}-x${made}`.toLowerCase(),
              name: `Busy ${made}`,
              visibility: 'public',
            },
            busy,
          )
        ).statusCode,
      ).toBe(201);
    }
    made += 1;
    const over = await post(
      '/groups',
      { slug: `gh-${RUN}-x${made}`.toLowerCase(), name: 'One too many', visibility: 'public' },
      busy,
    );
    expect(over.statusCode).toBe(429);
    expect((over.json() as { error: string }).error).toBe('rate_limited');
  });

  it('answers a group that is not there with 404 on every verb', async () => {
    for (const response of await Promise.all([
      get('/groups/nothing-is-here', ada),
      post('/groups/nothing-is-here/members', null, ada),
      post('/groups/nothing-is-here/requests', null, ada),
      del('/groups/nothing-is-here/members/me', ada),
      del('/groups/nothing-is-here', ada),
    ])) {
      expect(response.statusCode).toBe(404);
    }
  });
});
