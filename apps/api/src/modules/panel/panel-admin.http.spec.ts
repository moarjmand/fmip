import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { MatchPanelPage, PanelListResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PanelModule } from './panel.module';

/**
 * Opening and closing a match panel (T-253).
 *
 * The acceptance criterion is **an operator decides, with an audit row**, so
 * these do not stop at the status code: every write is followed by a read of
 * `audit_log`, checking the actor, the reason and what the state was before
 * (rule 10, D-046).
 *
 * The other half is who may do it. A member without the role is refused, and so
 * is an approved contributor — being trusted to *write* on a panel is not being
 * trusted to decide that one exists.
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
  'opening and closing a match panel',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const operator = `mp${RUN}o`;
    const writer = `mp${RUN}w`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    const teams = [randomUUID(), randomUUID()];
    const fixtures: string[] = [];

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

    const open = (fixtureId: string, reason: string, who = operator) =>
      post(`/admin/fixtures/${fixtureId}/panel`, { reason }, who);
    const close = (fixtureId: string, reason: string, who = operator) =>
      post(`/admin/fixtures/${fixtureId}/panel/close`, { reason }, who);

    const auditFor = (fixtureId: string) =>
      pool
        .query<{
          action: string;
          reason: string;
          previous: Record<string, unknown> | null;
          next: Record<string, unknown>;
          actor: string;
          target_type: string;
        }>(
          `SELECT a.action, a.reason, a.previous, a.next, a.target_type, actor.username AS actor
             FROM audit_log a JOIN user_account actor ON actor.id = a.actor_id
            WHERE a.target_id = $1 ORDER BY a.created_at, a.action`,
          [fixtureId],
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

    async function fixture(): Promise<string> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() + interval '2 days', 'scheduled')`,
        [id, PL_2025, REGULAR_SEASON],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
      return id;
    }

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

      for (const username of [operator, writer]) await register(username);
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'moderator', $1, 'the panel opening test')`,
        [ids.get(operator)],
      );
      for (const [index, id] of teams.entries()) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, short_name, kind, gender)
           VALUES ($1, $2, $3, $4, 'club', 'men')`,
          [id, ENGLAND, `Opening HTTP ${index}${RUN}`, `OH${index}`],
        );
      }
      // An approved contributor, to prove that writing on a panel is not
      // deciding that one exists.
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the panel opening test', 'contributor-rules@1.0.0', now())`,
        [ids.get(writer), ids.get(operator)],
      );
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM panel_post WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
        await client.query(`DELETE FROM match_panel WHERE fixture_id = ANY($1::uuid[])`, [
          fixtures,
        ]);
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
      await app.close();
    });

    describe('an operator decides, and nobody else', () => {
      it('needs a session and then a role', async () => {
        const match = await fixture();
        // Called through `post` rather than `open`, because passing `undefined`
        // to a defaulted parameter is the operator, not a guest -- which is how
        // this assertion passed while testing nothing.
        expect(
          (await post(`/admin/fixtures/${match}/panel`, { reason: 'a reason' })).statusCode,
        ).toBe(401);
        // An approved contributor is refused. Being trusted to write on a panel
        // is not being trusted to decide that one exists.
        expect((await open(match, 'a reason', writer)).statusCode).toBe(403);
        expect((await get('/admin/panels', writer)).statusCode).toBe(403);
      });

      it('refuses a decision with no reason', async () => {
        const match = await fixture();
        expect((await open(match, '   ')).statusCode).toBe(400);
      });

      it('says an unknown match is unknown', async () => {
        expect((await open(randomUUID(), 'a reason')).statusCode).toBe(404);
      });
    });

    describe('opening, with an audit row', () => {
      it('opens the discussion and records who and why in the same act', async () => {
        const match = await fixture();
        expect((await open(match, 'a derby worth arguing about')).statusCode).toBe(204);

        const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
        expect(page.state).toBe('open');

        const rows = await auditFor(match);
        const opened = rows.find((r) => r.action === 'panel.open');
        expect(opened?.actor).toBe(operator);
        expect(opened?.reason).toBe('a derby worth arguing about');
        expect(opened?.next).toMatchObject({ state: 'open' });
        // Filed against the match, not the operator: "who opened the discussion
        // on this match" is the only question anybody asks of this row.
        expect(opened?.target_type).toBe('fixture');
        // Nothing before it, because there was no panel.
        expect(opened?.previous).toBeNull();
      });

      it('refuses opening one that is already open', async () => {
        const match = await fixture();
        await open(match, 'first');
        const again = await open(match, 'again');
        expect(again.statusCode).toBe(400);
        expect((again.json() as { message: string }).message).toMatch(/already has an open/i);
      });

      it('lets an approved contributor post once it exists, and not before', async () => {
        const match = await fixture();
        const write = () =>
          post(`/fixtures/${match}/panel`, { body: 'Both full-backs are doubtful.' }, writer);

        const before = await write();
        expect(before.statusCode).toBe(403);
        expect((before.json() as { message: string }).message).toMatch(/no public discussion/i);

        await open(match, 'worth a panel');
        expect((await write()).statusCode).toBe(201);
      });
    });

    describe('closing, which keeps the words', () => {
      it('closes it, records the previous state, and leaves the posts readable', async () => {
        const match = await fixture();
        await open(match, 'worth a panel');
        await post(
          `/fixtures/${match}/panel`,
          { body: 'Something said while it was open.' },
          writer,
        );

        expect((await close(match, 'the argument ran out')).statusCode).toBe(204);

        const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
        expect(page.state).toBe('closed');
        // Still there. Taking the words down when the argument ends would
        // rewrite a record people were told was public.
        expect(page.posts[0]?.body).toBe('Something said while it was open.');

        const closed = (await auditFor(match)).find((r) => r.action === 'panel.close');
        expect(closed?.actor).toBe(operator);
        expect(closed?.reason).toBe('the argument ran out');
        // Rule 10 asks for the previous value, and "closed" with no "was open"
        // beside it does not say what changed.
        expect(closed?.previous).toMatchObject({ state: 'open' });
        expect(closed?.next).toMatchObject({ state: 'closed' });
      });

      it('refuses new posts once closed', async () => {
        const match = await fixture();
        await open(match, 'worth a panel');
        await close(match, 'done');
        const refused = await post(`/fixtures/${match}/panel`, { body: 'one more' }, writer);
        expect(refused.statusCode).toBe(403);
      });

      it('says there is nothing to close when there is not', async () => {
        const never = await fixture();
        expect((await close(never, 'nothing here')).statusCode).toBe(404);
        const already = await fixture();
        await open(already, 'worth a panel');
        await close(already, 'done');
        expect((await close(already, 'again')).statusCode).toBe(404);
      });

      it('reopens a closed one, and the audit row says what it was', async () => {
        const match = await fixture();
        await open(match, 'worth a panel');
        await close(match, 'done');
        expect((await open(match, 'the fixture was rescheduled')).statusCode).toBe(204);

        const page = (await get(`/fixtures/${match}/panel`)).json() as MatchPanelPage;
        expect(page.state).toBe('open');

        const opens = (await auditFor(match)).filter((r) => r.action === 'panel.open');
        const reopen = opens.at(-1);
        // The reopening says why it is open *now*, and the row keeps what it was
        // before beside it.
        expect(reopen?.reason).toBe('the fixture was rescheduled');
        expect(reopen?.previous).toMatchObject({ state: 'closed' });
      });
    });

    describe('the list an operator decides from', () => {
      it('names the match and counts what is on it', async () => {
        const match = await fixture();
        await open(match, 'a list entry');
        await post(`/fixtures/${match}/panel`, { body: 'One post on it.' }, writer);

        const body = (await get('/admin/panels', operator)).json() as PanelListResponse;
        const entry = body.panels.find((p) => p.fixture_id === match);
        expect(entry?.opened_by).toBe(operator);
        expect(entry?.reason).toBe('a list entry');
        // A panel an operator cannot recognise is one they cannot decide about.
        expect(entry?.home).toMatch(/Opening HTTP 0/);
        expect(entry?.away).toMatch(/Opening HTTP 1/);
        // The number weighed before closing one: forty posts is a different
        // decision from none.
        expect(entry?.posts).toBe(1);
        expect(entry?.closed_at).toBeNull();
      });

      it('filters by state, and reads an unknown filter as all', async () => {
        const closedOne = await fixture();
        await open(closedOne, 'to be closed');
        await close(closedOne, 'closed for the list test');

        const onlyOpen = (
          await get('/admin/panels?state=open', operator)
        ).json() as PanelListResponse;
        expect(onlyOpen.panels.some((p) => p.fixture_id === closedOne)).toBe(false);

        const onlyClosed = (
          await get('/admin/panels?state=closed', operator)
        ).json() as PanelListResponse;
        const entry = onlyClosed.panels.find((p) => p.fixture_id === closedOne);
        expect(entry?.closed_by).toBe(operator);
        expect(entry?.close_reason).toBe('closed for the list test');

        // A mistyped query string shows everything rather than an error page.
        const mistyped = (
          await get('/admin/panels?state=opne', operator)
        ).json() as PanelListResponse;
        expect(mistyped.panels.some((p) => p.fixture_id === closedOne)).toBe(true);
      });
    });
  },
);
