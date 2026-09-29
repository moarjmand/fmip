import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  FollowInviteLinkResponse,
  GroupInviteLinkResponse,
  GroupInviteLinksResponse,
  InviteLinkPreviewResponse,
} from '@fmip/contracts';
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
import { withTriggersOff } from '../../testing/cleanup';
import { hashToken } from './group-invite-links.service';
import { GroupsModule } from './groups.module';

/**
 * Invite links over HTTP, against the real schema (T-1021, D-132).
 *
 * The acceptance criterion: **only the token's hash is stored**; a revoked,
 * expired or exhausted link **says which**, and an invite-only group behind a
 * dead link **stays 404**; blocks, `groups` sanctions and the verified-e-mail
 * gate apply as to a direct invitation; making links has a ceiling.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('invite links over HTTP', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const owner = `gl_${RUN}o`;
  const mod = `gl_${RUN}m`;
  const member = `gl_${RUN}e`;
  const guest = `gl_${RUN}g`;
  const other = `gl_${RUN}x`;
  const unverified = `gl_${RUN}u`;
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

  /** A group with a moderator and a member, the ceilings cleared: here it is scenery. */
  const group = async (visibility: string): Promise<string> => {
    await pool.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [
      [...ids.values()],
    ]);
    made += 1;
    const slug = `gl-${RUN}-${made}`.toLowerCase();
    const response = await post('/groups', { slug, name: `Group ${made}`, visibility }, owner);
    expect(response.statusCode).toBe(201);
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM user_group WHERE slug = $1`, [
      slug,
    ]);
    const groupId = rows[0]?.id ?? '';
    await pool.query(
      `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'moderator'), ($1, $3, 'member')`,
      [groupId, ids.get(mod), ids.get(member)],
    );
    return slug;
  };

  const link = async (slug: string, who = owner, body: unknown = {}) => {
    const response = await post(`/groups/${slug}/invite-links`, body, who);
    expect(response.statusCode).toBe(201);
    return (response.json() as GroupInviteLinkResponse).link;
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

    for (const username of [owner, mod, member, guest, other]) await register(username);
    await register(unverified, false);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        everyone,
      ]);
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`gl_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('stores only the hash of the token, and shows the token once', async () => {
    const slug = await group('invite_only');
    const made = await link(slug, owner, { expires_in_hours: 2, max_uses: 3 });
    expect(made.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(made).toMatchObject({ max_uses: 3, uses: 0, state: 'live', created_by: owner });

    const { rows } = await pool.query<{ token_hash: string }>(
      `SELECT token_hash FROM group_invite_link WHERE id = $1`,
      [made.id],
    );
    expect(rows[0]?.token_hash).toBe(hashToken(made.token));
    const stored = await pool.query(
      `SELECT 1 FROM group_invite_link l WHERE l::text LIKE '%' || $1 || '%'`,
      [made.token],
    );
    expect(stored.rowCount).toBe(0);

    const listed = (
      await get(`/groups/${slug}/invite-links`, owner)
    ).json() as GroupInviteLinksResponse;
    expect(listed.links.map((l) => l.id)).toEqual([made.id]);
    expect(JSON.stringify(listed)).not.toContain(made.token);
  });

  it('lets the holder into an invite-only group, and counts the use', async () => {
    const slug = await group('invite_only');
    const made = await link(slug);
    const preview = await get(`/group-invite-links/${made.token}`, guest);
    expect(preview.statusCode).toBe(200);
    expect((preview.json() as InviteLinkPreviewResponse).preview).toMatchObject({
      state: 'live',
      follow: 'join',
      member: false,
    });

    const followed = await post(`/group-invite-links/${made.token}`, null, guest);
    expect(followed.statusCode).toBe(201);
    expect((followed.json() as FollowInviteLinkResponse).outcome).toBe('joined');
    expect((await get(`/groups/${slug}`, guest)).statusCode).toBe(200);
    expect((await post(`/group-invite-links/${made.token}`, null, guest)).statusCode).toBe(409);

    const listed = (
      await get(`/groups/${slug}/invite-links`, owner)
    ).json() as GroupInviteLinksResponse;
    expect(listed.links[0]?.uses).toBe(1);
  });

  it('files a join request for a discoverable group rather than letting the holder in', async () => {
    const slug = await group('discoverable');
    const made = await link(slug);
    const followed = await post(`/group-invite-links/${made.token}`, null, guest);
    expect(followed.statusCode).toBe(201);
    expect((followed.json() as FollowInviteLinkResponse).outcome).toBe('requested');
    const requests = (await get(`/groups/${slug}/requests`, owner)).json() as {
      requests: { username: string }[];
    };
    expect(requests.requests.map((r) => r.username)).toEqual([guest]);
  });

  it('says which kind of dead a link is, for a group that can be found', async () => {
    const slug = await group('public');
    const revoked = await link(slug);
    expect((await del(`/groups/${slug}/invite-links/${revoked.id}`, owner)).statusCode).toBe(204);
    const r = await post(`/group-invite-links/${revoked.token}`, null, guest);
    expect(r.statusCode).toBe(410);
    expect((r.json() as { message: string }).message).toBe('This invite link was revoked.');

    const once = await link(slug, owner, { max_uses: 1 });
    expect((await post(`/group-invite-links/${once.token}`, null, guest)).statusCode).toBe(201);
    const used = await post(`/group-invite-links/${once.token}`, null, other);
    expect(used.statusCode).toBe(410);
    expect((used.json() as { message: string }).message).toMatch(/used as many times/);

    const late = await link(slug);
    // A link made three hours ago that lasted two: moved back in time with the
    // guards off for this session only, since a link is never rewritten.
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `UPDATE group_invite_link SET created_at = now() - interval '3 hours',
                                      expires_at = now() - interval '1 hour' WHERE id = $1`,
        [late.id],
      );
    });
    const expired = await post(`/group-invite-links/${late.token}`, null, other);
    expect(expired.statusCode).toBe(410);
    expect((expired.json() as { message: string }).message).toBe('This invite link has expired.');
    const preview = (
      await get(`/group-invite-links/${late.token}`, other)
    ).json() as InviteLinkPreviewResponse;
    expect(preview.preview.state).toBe('expired');
  });

  it('keeps an invite-only group behind a dead link at 404', async () => {
    const slug = await group('invite_only');
    const made = await link(slug);
    await del(`/groups/${slug}/invite-links/${made.id}`, owner);
    expect((await get(`/group-invite-links/${made.token}`, guest)).statusCode).toBe(404);
    expect((await post(`/group-invite-links/${made.token}`, null, guest)).statusCode).toBe(404);
    expect((await get(`/group-invite-links/${'x'.repeat(43)}`, guest)).statusCode).toBe(404);
  });

  it('applies the invite policy when a link is made and when it is followed', async () => {
    const slug = await group('public');
    // The default lets a moderator make one, and not a member.
    const byMod = await link(slug, mod);
    const refused = await post(`/groups/${slug}/invite-links`, {}, member);
    expect(refused.statusCode).toBe(403);
    expect((refused.json() as { message: string }).message).toMatch(/owner and moderators/);

    await put(`/groups/${slug}/invite-policy`, { invite_policy: 'owner' }, owner);
    const orphaned = await post(`/group-invite-links/${byMod.token}`, null, guest);
    expect(orphaned.statusCode).toBe(410);
    expect((orphaned.json() as { message: string }).message).toMatch(/can no longer invite/);
  });

  it('needs a verified e-mail to make one, as a direct invitation does', async () => {
    const slug = await group('public');
    await pool.query(
      `INSERT INTO group_member (group_id, user_id) SELECT id, $2 FROM user_group WHERE slug = $1`,
      [slug, ids.get(unverified)],
    );
    await put(`/groups/${slug}/invite-policy`, { invite_policy: 'members' }, owner);
    expect((await post(`/groups/${slug}/invite-links`, {}, unverified)).statusCode).toBe(403);
  });

  it('refuses a follow across a block, without saying a block is why', async () => {
    const slug = await group('public');
    const made = await link(slug);
    await post(`/me/blocks/${owner}`, null, other);
    const refused = await post(`/group-invite-links/${made.token}`, null, other);
    expect(refused.statusCode).toBe(409);
    expect(JSON.stringify(refused.json())).not.toMatch(/block/i);
    await del(`/me/blocks/${owner}`, other);
  });

  it('refuses a follower under a groups sanction', async () => {
    const slug = await group('invite_only');
    const made = await link(slug);
    await pool.query(
      `WITH d AS (
         INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
         VALUES ($2, 'member', $1::text, 'sanctioned', 'test') RETURNING id
       )
       INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
       SELECT $1::uuid, d.id, 'groups', now() + interval '1 day', false FROM d`,
      [ids.get(guest), ids.get(owner)],
    );
    const refused = await post(`/group-invite-links/${made.token}`, null, guest);
    expect(refused.statusCode).toBe(409);
    expect((refused.json() as { message: string }).message).toMatch(/restriction/);
  });

  it("lets a maker revoke their own link and nobody else's; the owner any", async () => {
    const slug = await group('public');
    const mine = await link(slug, mod);
    const owners = await link(slug, owner);
    await put(`/groups/${slug}/members/${mod}/role`, { role: 'member' }, owner);
    await put(`/groups/${slug}/invite-policy`, { invite_policy: 'members' }, owner);
    expect((await del(`/groups/${slug}/invite-links/${owners.id}`, mod)).statusCode).toBe(404);
    expect((await del(`/groups/${slug}/invite-links/${mine.id}`, mod)).statusCode).toBe(204);
    expect((await del(`/groups/${slug}/invite-links/${mine.id}`, owner)).statusCode).toBe(404);
    const seen = (
      await get(`/groups/${slug}/invite-links`, mod)
    ).json() as GroupInviteLinksResponse;
    expect(seen.links.map((l) => l.id)).toEqual([mine.id]);
  });

  it('validates the expiry and the use cap, and refuses a rewritten link', async () => {
    const slug = await group('public');
    const bad = await post(
      `/groups/${slug}/invite-links`,
      { expires_in_hours: 0, max_uses: 501 },
      owner,
    );
    expect(bad.statusCode).toBe(400);
    expect(Object.keys((bad.json() as { fields: object }).fields).sort()).toEqual([
      'expires_in_hours',
      'max_uses',
    ]);
    const made = await link(slug);
    await expect(
      pool.query(`UPDATE group_invite_link SET max_uses = 400 WHERE id = $1`, [made.id]),
    ).rejects.toMatchObject({ code: 'PL007' });
  });

  it('serves the ceiling on making links as 429', async () => {
    const slug = await group('public');
    await pool.query(
      `INSERT INTO rate_window (user_id, action, window_start, count)
       VALUES ($1, 'group_invite_link', date_trunc('hour', now()), 1000)
       ON CONFLICT (user_id, action, window_start) DO UPDATE SET count = 1000`,
      [ids.get(owner)],
    );
    const over = await post(`/groups/${slug}/invite-links`, {}, owner);
    expect(over.statusCode).toBe(429);
  });

  it('tells a guest to sign in', async () => {
    expect((await get(`/group-invite-links/${'x'.repeat(43)}`)).statusCode).toBe(401);
    expect((await post(`/group-invite-links/${'x'.repeat(43)}`, null)).statusCode).toBe(401);
  });
});
