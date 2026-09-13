import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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
import { ProfileModule } from '../profile/profile.module';
import { SocialModule } from './social.module';

/**
 * The acceptance criterion for T-201, over HTTP with real sessions and the real
 * schema: request, cancel, accept, decline, remove, block, unblock — and a
 * friends-only profile visible to a friend, which is the half of this task that
 * lives in somebody else's module.
 *
 * `ProfileModule` is here for exactly that reason. It is the reader of the
 * friendship, and until this task its `FriendshipOracle` answered no, so a
 * member who chose "friends only" had chosen nobody.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the social graph', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  // Ada and Bo are the pair; Cleo is the third member the mutual-friend count
  // and the "a block is about one pair" case need. Dev is deliberately left
  // unverified.
  const ada = `so_${RUN}a`;
  const bo = `so_${RUN}b`;
  const cleo = `so_${RUN}c`;
  const dev = `so_${RUN}d`;
  const cookies = new Map<string, string>();

  const register = async (username: string, verify = true) => {
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
    if (verify) {
      await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE username = $1`, [
        username,
      ]);
    }
    cookies.set(username, cookieValue(response.headers['set-cookie']));
  };

  const as = (username?: string) =>
    username === undefined ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` };

  const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
  const post = (url: string, who?: string) => app.inject({ method: 'POST', url, headers: as(who) });
  const del = (url: string, who?: string) =>
    app.inject({ method: 'DELETE', url, headers: as(who) });
  const patch = (url: string, payload: unknown, who: string) =>
    app.inject({
      method: 'PATCH',
      url,
      payload: payload as Record<string, unknown>,
      headers: as(who),
    });

  const statusOf = async (viewer: string, other: string): Promise<string> =>
    (await get(`/me/friend-status/${other}`, viewer)).json().status;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, SocialModule, ProfileModule],
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

    await register(ada);
    await register(bo);
    await register(cleo);
    await register(dev, false);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`so_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('tells a guest to sign in, on every route', async () => {
    for (const response of await Promise.all([
      get('/me/friends'),
      get('/me/friend-requests'),
      get('/me/blocks'),
      post(`/me/friend-requests/${ada}`),
      del(`/me/friends/${ada}`),
    ])) {
      expect(response.statusCode).toBe(401);
    }
  });

  it('refuses every verb aimed at yourself, and at nobody', async () => {
    // Including the ones where operating on yourself would simply do nothing.
    // "Nothing to do" and "you asked the wrong question" look identical from
    // outside, which is how a test of this suite passed while withdrawing a
    // request between a member and themselves.
    for (const response of await Promise.all([
      post(`/me/friend-requests/${ada}`, ada),
      post(`/me/friend-requests/${ada}/accept`, ada),
      del(`/me/friend-requests/${ada}`, ada),
      del(`/me/friends/${ada}`, ada),
      post(`/me/blocks/${ada}`, ada),
      del(`/me/blocks/${ada}`, ada),
    ])) {
      expect(response.statusCode).toBe(400);
    }
    expect((await post(`/me/friend-requests/nobody_${RUN}`, ada)).statusCode).toBe(404);
    expect((await get(`/me/friend-status/nobody_${RUN}`, ada)).statusCode).toBe(404);
  });

  it('gates reaching a member on a verified e-mail, and never gates getting away from one', async () => {
    const reaching = await post(`/me/friend-requests/${ada}`, dev);
    expect(reaching.statusCode).toBe(403);
    expect(reaching.json().error).toBe('email_unverified');

    // The same unverified member can block. A product that made somebody verify
    // an e-mail before they could stop another member contacting them would
    // have built the gate backwards.
    expect((await post(`/me/blocks/${ada}`, dev)).statusCode).toBe(204);
    expect((await del(`/me/blocks/${ada}`, dev)).statusCode).toBe(204);
  });

  it('sends, shows and accepts a request', async () => {
    expect((await post(`/me/friend-requests/${bo}`, ada)).statusCode).toBe(204);
    // Asking twice is one open offer, not an error.
    expect((await post(`/me/friend-requests/${bo}`, ada)).statusCode).toBe(204);

    expect(await statusOf(ada, bo)).toBe('request_sent');
    expect(await statusOf(bo, ada)).toBe('request_received');

    const mine = (await get('/me/friend-requests', ada)).json();
    expect(mine.outgoing.map((r: { member: { username: string } }) => r.member.username)).toEqual([
      bo,
    ]);
    expect(mine.incoming).toEqual([]);

    const theirs = (await get('/me/friend-requests', bo)).json();
    expect(theirs.incoming[0].member).toEqual({ username: ada, display_name: `Member ${ada}` });

    expect((await post(`/me/friend-requests/${ada}/accept`, bo)).statusCode).toBe(204);

    expect(await statusOf(ada, bo)).toBe('friends');
    expect(await statusOf(bo, ada)).toBe('friends');
    // Accepting clears the request in the same transaction: a pair who are
    // friends and still have a request outstanding would show up as a member
    // being asked to befriend somebody they already have.
    expect((await get('/me/friend-requests', bo)).json().incoming).toEqual([]);
    expect((await get('/me/friend-requests', ada)).json().outgoing).toEqual([]);

    const friends = (await get('/me/friends', ada)).json().friends;
    expect(friends).toHaveLength(1);
    expect(friends[0].member.username).toBe(bo);
    expect(friends[0].mutual_friends).toBe(0);
  });

  it('counts the friends two members have in common', async () => {
    // Cleo befriends both Ada and Bo, who are already friends with each other.
    for (const other of [ada, bo]) {
      expect((await post(`/me/friend-requests/${other}`, cleo)).statusCode).toBe(204);
      expect((await post(`/me/friend-requests/${cleo}/accept`, other)).statusCode).toBe(204);
    }

    const friends: { member: { username: string }; mutual_friends: number }[] = (
      await get('/me/friends', cleo)
    ).json().friends;
    // From Cleo's side, Ada and Bo share exactly one friend with her: each
    // other. The count is built from Cleo's own friend list, so it is never a
    // window into somebody else's.
    expect(friends.map((f) => [f.member.username, f.mutual_friends]).sort()).toEqual([
      [ada, 1],
      [bo, 1],
    ]);
  });

  it('makes a friends-only profile visible to a friend, and to nobody else', async () => {
    expect((await patch('/me/privacy', { profile_visibility: 'friends' }, ada)).statusCode).toBe(
      200,
    );

    // The acceptance criterion. Before T-201 this said `restricted` to
    // everybody, including Ada's friends, because the oracle answered no.
    expect((await get(`/profiles/${ada}`, bo)).json().kind).toBe('visible');
    expect((await get(`/profiles/${ada}`, dev)).json().kind).toBe('restricted');
    expect((await get(`/profiles/${ada}`)).json()).toMatchObject({
      kind: 'restricted',
      visibility: 'friends',
    });
    expect((await get(`/profiles/${ada}`, ada)).json().kind).toBe('visible');

    await patch('/me/privacy', { profile_visibility: 'public' }, ada);
  });

  it('withdraws a request from either end, and removes a friend', async () => {
    expect((await post(`/me/friend-requests/${dev}`, ada)).statusCode).toBe(204);
    // Declining and cancelling are the same row and the same outcome.
    expect((await del(`/me/friend-requests/${ada}`, dev)).statusCode).toBe(204);
    expect(await statusOf(ada, dev)).toBe('none');

    expect((await del(`/me/friends/${cleo}`, ada)).statusCode).toBe(204);
    expect(await statusOf(ada, cleo)).toBe('none');
    // Removing a friend is not a block: Cleo may ask again.
    expect((await post(`/me/friend-requests/${ada}`, cleo)).statusCode).toBe(204);
    expect((await del(`/me/friend-requests/${ada}`, cleo)).statusCode).toBe(204);
  });

  it('blocks: the friendship ends, the requests go, and the other member is not told why', async () => {
    expect(await statusOf(ada, bo)).toBe('friends');
    expect((await post(`/me/friend-requests/${cleo}`, bo)).statusCode).toBe(204);

    expect((await post(`/me/blocks/${bo}`, ada)).statusCode).toBe(204);

    expect(await statusOf(ada, bo)).toBe('blocked');
    // Bo is told only that a request cannot be sent. Naming the block would
    // turn this endpoint into a detector for it, which is the one thing a
    // block has to stop.
    expect(await statusOf(bo, ada)).toBe('unavailable');

    const refused = await post(`/me/friend-requests/${ada}`, bo);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({
      error: 'conflict',
      message: 'This member is not accepting friend requests.',
    });

    expect((await get('/me/friends', ada)).json().friends).toEqual([]);
    // Bo's unrelated request to Cleo is untouched: a block is about one pair.
    expect((await get('/me/friend-requests', bo)).json().outgoing).toHaveLength(1);

    const blocked = (await get('/me/blocks', ada)).json().blocked;
    expect(blocked).toHaveLength(1);
    expect(blocked[0].member.username).toBe(bo);
  });

  it('lifts a block without restoring what it ended', async () => {
    expect((await del(`/me/blocks/${bo}`, ada)).statusCode).toBe(204);

    expect((await get('/me/blocks', ada)).json().blocked).toEqual([]);
    // Contact is possible again; the friendship is not back. Reinstating it
    // would put Ada in touch with a member she had removed, without either of
    // them asking.
    expect(await statusOf(ada, bo)).toBe('none');
    expect((await post(`/me/friend-requests/${ada}`, bo)).statusCode).toBe(204);
  });
});
