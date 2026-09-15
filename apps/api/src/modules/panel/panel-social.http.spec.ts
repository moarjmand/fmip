import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  FollowStatus,
  FollowedMembersResponse,
  MatchPanelPage,
  PanelPermission,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PanelModule } from './panel.module';
import { SocialModule } from '../social/social.module';

/**
 * Reacting and following over HTTP (T-252).
 *
 * **The criterion is that neither becomes posting access**, and over HTTP that
 * means two things: every one of these routes needs a session and *nothing
 * else*, and having used them changes nothing about posting. The shortest way
 * to break the first is a copied `approver(request)` at the top of a handler,
 * which would pass every other test in this file.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'panel reactions and following over HTTP',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const writer = `pz${RUN}w`;
    const fan = `pz${RUN}f`;
    const other = `pz${RUN}o`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    const teams = [randomUUID(), randomUUID()];
    const match = randomUUID();
    let postId = '';

    const as = (who?: string) =>
      who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
    const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
    const put = (url: string, who?: string) => app.inject({ method: 'PUT', url, headers: as(who) });
    const del = (url: string, who?: string) =>
      app.inject({ method: 'DELETE', url, headers: as(who) });

    const permission = (who?: string) =>
      get(`/fixtures/${match}/panel/permission`, who).then((r) => r.json() as PanelPermission);
    const panel = () => get(`/fixtures/${match}/panel`).then((r) => r.json() as MatchPanelPage);

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
        imports: [DatabaseModule, PanelModule, SocialModule],
      })
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .overrideProvider(MODEL_CLIENT)
        .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
        .compile();

      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      for (const username of [writer, fan, other]) await register(username);
      for (const [index, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
          [id, ENGLAND, `Social HTTP ${index}${RUN}`, `SH${index}`],
        );
      }
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() + interval '2 days', 'scheduled')`,
        [match, PL_2025, REGULAR_SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [match, teams[0], teams[1]],
      );
      // T-253: a fixture has no discussion until an operator opens one.
      await pool.query(
        `INSERT INTO match_panel (fixture_id, opened_by, reason)
         VALUES ($1, $2, 'the suite that needs a panel to write to')`,
        [match, ids.get(other)],
      );
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the panel social suite', 'contributor-rules@1.0.0', now())`,
        [ids.get(writer), ids.get(other)],
      );
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO panel_post (fixture_id, author_id, body)
         VALUES ($1, $2, 'The away side never defends a set piece.') RETURNING id`,
        [match, ids.get(writer)],
      );
      postId = rows[0]?.id ?? '';
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM panel_reaction WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM member_follow WHERE follower_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM user_block WHERE blocker_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [match]);
        await client.query(`DELETE FROM match_panel WHERE fixture_id = $1`, [match]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [match]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [match]);
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
      await app.close();
    });

    describe('reacting is open to members', () => {
      it('lets a member with no grant react, although they cannot post a word', async () => {
        // Both halves in one test. This member is refused by the approval gate
        // and admitted by the reaction route, and both are correct.
        const refused = await app.inject({
          method: 'POST',
          url: `/fixtures/${match}/panel`,
          payload: { body: 'let me in' },
          headers: as(fan),
        });
        expect(refused.statusCode).toBe(403);

        expect((await put(`/panel-posts/${postId}/reactions/agree`, fan)).statusCode).toBe(204);
      });

      it('needs a session, and nothing beyond one', async () => {
        expect((await put(`/panel-posts/${postId}/reactions/agree`)).statusCode).toBe(401);
        // No role and no grant: `other` has neither and is admitted.
        expect((await put(`/panel-posts/${postId}/reactions/laugh`, other)).statusCode).toBe(204);
      });

      it('is idempotent in both directions', async () => {
        expect((await put(`/panel-posts/${postId}/reactions/sad`, other)).statusCode).toBe(204);
        expect((await put(`/panel-posts/${postId}/reactions/sad`, other)).statusCode).toBe(204);
        expect((await del(`/panel-posts/${postId}/reactions/sad`, other)).statusCode).toBe(204);
        // Removing one that is not there is not an error: the end state is what
        // was asked for.
        expect((await del(`/panel-posts/${postId}/reactions/sad`, other)).statusCode).toBe(204);
      });

      it('refuses anything outside the six, and an unknown post', async () => {
        expect((await put(`/panel-posts/${postId}/reactions/fire`, fan)).statusCode).toBe(404);
        expect((await put(`/panel-posts/${randomUUID()}/reactions/agree`, fan)).statusCode).toBe(
          404,
        );
      });

      it('counts them on the public panel, with no session needed to read them', async () => {
        const page = await panel();
        const post = page.posts.find((p) => p.id === postId);
        const agree = post?.reactions.find((r) => r.reaction === 'agree');
        expect(agree?.count).toBe(1);
        // And no `mine` anywhere on the public document: it could only ever be
        // false, which reads as "you have not reacted" when the truth is
        // "nobody asked".
        expect(JSON.stringify(post?.reactions)).not.toContain('mine');
      });

      it('tells a member which reactions are theirs, on the request that already knows who they are', async () => {
        const mine = await permission(fan);
        const onThisPost = mine.my_reactions.find((r) => r.post_id === postId);
        expect(onThisPost?.reactions).toContain('agree');

        // A guest gets an empty list, which is true of them.
        expect((await permission()).my_reactions).toEqual([]);
      });
    });

    describe('it never becomes posting access', () => {
      it('leaves the gate exactly where it was, after reacting and following', async () => {
        await put(`/panel-posts/${postId}/reactions/celebrate`, fan);
        await put(`/members/${writer}/follow`, fan);

        const after = await permission(fan);
        expect(after.may_post).toBe(false);
        expect(after.refusal).toBe('not_approved');

        const refused = await app.inject({
          method: 'POST',
          url: `/fixtures/${match}/panel`,
          payload: { body: 'now?' },
          headers: as(fan),
        });
        expect(refused.statusCode).toBe(403);
      });
    });

    describe('following a contributor', () => {
      it('is one-directional, and the count is public', async () => {
        const theirs = (await get(`/members/${writer}/follow`, fan)).json() as FollowStatus;
        expect(theirs.following).toBe(true);
        expect(theirs.followers).toBeGreaterThanOrEqual(1);

        // The writer does not follow back by having been followed.
        const back = (await get(`/members/${fan}/follow`, writer)).json() as FollowStatus;
        expect(back.following).toBe(false);

        // A guest reads the count, and is told why they cannot follow.
        const guest = (await get(`/members/${writer}/follow`)).json() as FollowStatus;
        expect(guest.followers).toBe(theirs.followers);
        expect(guest.refusal).toBe('not_signed_in');
      });

      it('lists what the viewer follows, with each one standing as it is now', async () => {
        const mine = (await get('/me/followed-members', fan)).json() as FollowedMembersResponse;
        const entry = mine.following.find((f) => f.username === writer);
        expect(entry?.approved).toBe(true);
        // Null, not zero: this contributor has settled nothing and has not been
        // rated badly.
        expect(entry?.rating).toBeNull();
      });

      it('refuses following yourself, and says so plainly', async () => {
        const response = await put(`/members/${fan}/follow`, fan);
        expect(response.statusCode).toBe(403);
        expect((response.json() as { message: string }).message).toMatch(/your own account/i);
      });

      it('is idempotent, and unfollowing is too', async () => {
        expect((await put(`/members/${writer}/follow`, fan)).statusCode).toBe(204);
        expect((await del(`/members/${writer}/follow`, fan)).statusCode).toBe(204);
        expect((await del(`/members/${writer}/follow`, fan)).statusCode).toBe(204);
        expect(
          ((await get(`/members/${writer}/follow`, fan)).json() as FollowStatus).following,
        ).toBe(false);
      });

      it('refuses across a block without saying which way it goes', async () => {
        expect(
          (await app.inject({ method: 'POST', url: `/me/blocks/${other}`, headers: as(fan) }))
            .statusCode,
        ).toBeLessThan(300);

        const blockedWay = await put(`/members/${other}/follow`, fan);
        const otherWay = await put(`/members/${fan}/follow`, other);
        expect(blockedWay.statusCode).toBe(403);
        expect(otherWay.statusCode).toBe(403);
        // The same sentence both ways. Which of them blocked the other is not
        // something either should learn here.
        expect((blockedWay.json() as { message: string }).message).toBe(
          (otherWay.json() as { message: string }).message,
        );
      });

      it('ends an existing follow when a block is created', async () => {
        await put(`/members/${writer}/follow`, other);
        expect(
          ((await get(`/members/${writer}/follow`, other)).json() as FollowStatus).following,
        ).toBe(true);

        expect(
          (await app.inject({ method: 'POST', url: `/me/blocks/${other}`, headers: as(writer) }))
            .statusCode,
        ).toBeLessThan(300);

        // A block that left the follow in place would leave the blocked member
        // still receiving somebody, which is most of what they were stopping.
        expect(
          ((await get(`/members/${writer}/follow`, other)).json() as FollowStatus).following,
        ).toBe(false);
      });

      it('says an unknown member is unknown', async () => {
        expect((await get(`/members/nobody${RUN}/follow`, fan)).statusCode).toBe(404);
        expect((await put(`/members/nobody${RUN}/follow`, fan)).statusCode).toBe(404);
      });
    });
  },
);
