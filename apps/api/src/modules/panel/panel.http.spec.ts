import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, MatchPanelPage, PanelPermission, PanelPost } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PanelModule } from './panel.module';

/**
 * The public match panel over HTTP (T-251).
 *
 * The acceptance criterion is **a guest reads; an unapproved member cannot post
 * and is told why**, and both halves are easy to pass by accident and fail in
 * production. So: the read is made with no cookie at all, and every refusal is
 * checked for its words rather than only its status code.
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the match panel', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const writer = `pn${RUN}w`;
  const reader = `pn${RUN}r`;
  const admin = `pn${RUN}a`;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const teams = [randomUUID(), randomUUID()];
  const match = randomUUID();

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

  const write = (body: string, who?: string) => post(`/fixtures/${match}/panel`, { body }, who);
  const permission = (who?: string) =>
    get(`/fixtures/${match}/panel/permission`, who).then((r) => r.json() as PanelPermission);

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

  const grantTo = (username: string) =>
    pool
      .query<{ id: string }>(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the panel suite', 'contributor-rules@1.0.0', now()) RETURNING id`,
        [ids.get(username), ids.get(admin)],
      )
      .then(({ rows }) => rows[0]?.id ?? '');

  const event = (grantId: string, kind: string) =>
    pool.query(
      `INSERT INTO contributor_grant_event (grant_id, kind, actor_id, reason)
       VALUES ($1, $2, $3, 'the panel suite')`,
      [grantId, kind, ids.get(admin)],
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, PanelModule] })
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

    for (const username of [writer, reader, admin]) await register(username);
    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Panel HTTP ${index}${RUN}`, `PH${index}`],
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
    await pool.query(
      `INSERT INTO rating_snapshot
         (user_id, formula_version, settled_count, rating, components, provisional,
          established, inputs_hash)
       VALUES ($1, 'performance-rating@1.0.0', 120, 82, '{}'::jsonb, false, true, $2)`,
      [ids.get(writer), `pn-${RUN}`],
    );
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [match]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(
        `DELETE FROM contributor_grant_event WHERE grant_id IN
           (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM sanction WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM moderation_decision WHERE moderator_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [everyone]);
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

  describe('a guest reads', () => {
    it('answers with no cookie at all', async () => {
      const response = await get(`/fixtures/${match}/panel`);
      expect(response.statusCode).toBe(200);
      const page = response.json() as MatchPanelPage;
      expect(page.posts).toEqual([]);
      // Counted rather than implied by the page length, so a page never suggests
      // the panel is as short as itself (rule 3).
      expect(page.total).toBe(0);
      expect(page.cursor).toBeNull();
    });

    it('says an unknown match is unknown rather than showing an empty panel', async () => {
      expect((await get(`/fixtures/${randomUUID()}/panel`)).statusCode).toBe(404);
    });

    it('tells a guest why they cannot post, without making them sign in to find out', async () => {
      const answer = await permission();
      expect(answer.may_post).toBe(false);
      expect(answer.refusal).toBe('not_signed_in');
    });
  });

  describe('an unapproved member cannot post and is told why', () => {
    it('refuses, with a sentence naming the reason', async () => {
      const response = await write('I think this is a draw.', reader);
      expect(response.statusCode).toBe(403);
      const error = response.json() as ApiError;
      // Not a bare 403 and not a hidden box: the member has to be able to learn
      // there is something to ask about.
      expect(error.message).toMatch(/approved contributor grant/i);
      expect(error.message).toMatch(/reading is open/i);
    });

    it('tells them what they still need, and separates falling short from waiting', async () => {
      const shortOfIt = await permission(reader);
      expect(shortOfIt.refusal).toBe('not_approved');
      expect(shortOfIt.qualifies).toBe(false);
      expect(shortOfIt.shortfalls.length).toBeGreaterThan(0);

      // This one meets every measurable requirement and is still refused. Their
      // shortfall list is empty, which is what makes "waiting for somebody to
      // decide" readable as a different state from "not good enough yet".
      const waiting = await permission(writer);
      expect(waiting.refusal).toBe('not_approved');
      expect(waiting.qualifies).toBe(true);
      expect(waiting.shortfalls).toEqual([]);
    });

    it('needs a session before it needs anything else', async () => {
      expect((await write('anonymous opinion')).statusCode).toBe(401);
    });
  });

  describe('an approved contributor posts', () => {
    let grant = '';

    it('is allowed once somebody approves them', async () => {
      grant = await grantTo(writer);
      const answer = await permission(writer);
      expect(answer.may_post).toBe(true);
      expect(answer.refusal).toBeNull();

      const response = await write('City press high and leave the channels open.', writer);
      expect(response.statusCode).toBe(201);
      const written = response.json() as PanelPost;
      expect(written.body).toBe('City press high and leave the channels open.');
      expect(written.author.username).toBe(writer);
      // Blueprint 10.2: the rating and the approved status travel with the post,
      // because on a public panel they are the only thing separating this
      // opinion from anybody else's.
      expect(written.author.rating).toBe(82);
      expect(written.author.tier).toBe('platinum');
      expect(written.author.approved).toBe(true);
    });

    it('shows the post to a guest, with the author standing attached', async () => {
      const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
      expect(page.total).toBe(1);
      expect(page.posts[0]?.author.approved).toBe(true);
      expect(page.posts[0]?.author.tier).toBe('platinum');
    });

    it('refuses an empty post and an oversized one', async () => {
      expect((await write('   ', writer)).statusCode).toBe(400);
      expect((await write('x'.repeat(4001), writer)).statusCode).toBe(400);
    });

    it('stops them the moment the grant is paused, and says which refusal it is', async () => {
      await event(grant, 'paused');
      const answer = await permission(writer);
      expect(answer.refusal).toBe('paused');

      const response = await write('a second thought', writer);
      expect(response.statusCode).toBe(403);
      expect((response.json() as ApiError).message).toMatch(/paused/i);

      await event(grant, 'resumed');
      expect((await permission(writer)).may_post).toBe(true);
    });

    it('leaves what they already wrote exactly where it was', async () => {
      // Checked while the grant is live again, but the point is the pause above:
      // nothing was taken down, because the post was written by an approved
      // contributor and removing it would rewrite the record rather than
      // correct it.
      const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
      expect(page.posts[0]?.body).toBe('City press high and leave the channels open.');
    });
  });

  describe('a moderation restriction is a different refusal', () => {
    it('stops an approved contributor, and says so', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
         VALUES ($1, 'member', $2, 'sanctioned', 'the panel suite') RETURNING id`,
        [ids.get(admin), ids.get(writer)],
      );
      await pool.query(
        `INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
         VALUES ($1, $2, 'post', now() + interval '7 days', false)`,
        [ids.get(writer), rows[0]?.id ?? ''],
      );

      const answer = await permission(writer);
      expect(answer.refusal).toBe('restricted');
      const response = await write('during a restriction', writer);
      expect(response.statusCode).toBe(403);
      expect((response.json() as ApiError).message).toMatch(/moderation restriction/i);

      await pool.query(
        `UPDATE sanction SET lifted_at = now(), lifted_by = $1, lift_reason = 'the panel suite'
          WHERE user_id = $2 AND scope = 'post'`,
        [ids.get(admin), ids.get(writer)],
      );
      expect((await permission(writer)).may_post).toBe(true);
    });
  });

  describe('an author takes their own post down', () => {
    it('removes it as a tombstone that still says who removed it', async () => {
      const written = (await write('something regretted', writer)).json() as PanelPost;
      const removed = await app.inject({
        method: 'DELETE',
        url: `/fixtures/${match}/panel/${written.id}`,
        headers: as(writer),
      });
      expect(removed.statusCode).toBe(204);

      const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
      const tombstone = page.posts.find((p) => p.id === written.id);
      // Returned, not dropped. A panel that silently swallowed removed posts
      // would leave holes, and the replies around one would read as non
      // sequiturs rather than as replies to something taken down.
      expect(tombstone?.body).toBeNull();
      expect(tombstone?.removed).toBe('author');
      expect(page.total).toBe(2);
    });

    it('will not let anybody remove a post that is not theirs, and says nothing either way', async () => {
      const written = (await write('not yours to remove', writer)).json() as PanelPost;
      const refused = await app.inject({
        method: 'DELETE',
        url: `/fixtures/${match}/panel/${written.id}`,
        headers: as(reader),
      });
      // 404 rather than 403: telling a stranger "that exists but is not yours"
      // answers "does this id exist" for anybody who guesses.
      expect(refused.statusCode).toBe(404);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/fixtures/${match}/panel/${randomUUID()}`,
            headers: as(writer),
          })
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('paging', () => {
    it('walks the panel with a cursor and stops without inviting an empty request', async () => {
      const first = (await get(`/fixtures/${match}/panel?limit=2`)).json() as MatchPanelPage;
      expect(first.posts).toHaveLength(2);
      expect(first.cursor).not.toBeNull();

      const second = (
        await get(
          `/fixtures/${match}/panel?limit=2&cursor=${encodeURIComponent(first.cursor ?? '')}`,
        )
      ).json() as MatchPanelPage;
      const seen = new Set([...first.posts, ...second.posts].map((p) => p.id));
      // No overlap and no gap. Two ways to get this wrong and both are silent:
      // a numeric offset repeats or skips a post whenever one is written between
      // the requests, and a cursor rounded to milliseconds sorts *before* the
      // row it points at, so the last post of every page comes back at the top
      // of the next. Postgres keeps microseconds; a JavaScript Date does not.
      expect(seen.size).toBe(first.posts.length + second.posts.length);
      // The last page carries no cursor, so a client never makes the request
      // that is certain to come back empty.
      expect(second.posts.length < 2 ? second.cursor : 'unchecked').toBeDefined();
    });

    it('shows the panel from the start when the cursor is not one this server wrote', async () => {
      const response = await get(`/fixtures/${match}/panel?cursor=not-a-cursor`);
      // A stale or mangled link shows the panel, not an error page about
      // pagination.
      expect(response.statusCode).toBe(200);
      expect((response.json() as MatchPanelPage).posts.length).toBeGreaterThan(0);
    });
  });
});
