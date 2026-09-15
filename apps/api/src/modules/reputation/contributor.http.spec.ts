import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  ContributorGrant,
  ContributorListResponse,
  ContributorStatusResponse,
  EligibilityResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ReputationModule } from './reputation.module';

/**
 * Contributor eligibility and contributor approval over HTTP (T-250).
 *
 * The acceptance criterion is two clauses and they are tested as two:
 * **eligibility is computed and never grants**, and **approval names its
 * approver and reason**. So the interesting assertions are not the status
 * codes. They are that a granted member's eligibility answer does not change,
 * that a qualifying member still cannot post, and that every write leaves a row
 * in `audit_log` carrying the actor, the reason and what the standing was
 * before (rule 10, D-046).
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'contributor approval over HTTP',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const approver = `cg${RUN}mod`;
    const rising = `cg${RUN}up`;
    const quiet = `cg${RUN}new`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();

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

    const auditFor = (username: string) =>
      pool
        .query<{
          action: string;
          reason: string;
          previous: Record<string, unknown> | null;
          next: Record<string, unknown>;
          actor: string;
        }>(
          `SELECT a.action, a.reason, a.previous, a.next, actor.username AS actor
             FROM audit_log a JOIN user_account actor ON actor.id = a.actor_id
            WHERE a.target_id = $1 ORDER BY a.created_at, a.action`,
          [ids.get(username)],
        )
        .then(({ rows }) => rows);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, ReputationModule],
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

      for (const username of [approver, rising, quiet]) await register(username);
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'moderator', $1, 'the contributor approval test')`,
        [ids.get(approver)],
      );
      // `rising` meets every measurable requirement. `quiet` meets none.
      await pool.query(
        `INSERT INTO rating_snapshot
           (user_id, formula_version, settled_count, rating, components, provisional,
            established, inputs_hash)
         VALUES ($1, 'performance-rating@1.0.0', 200, 88, '{}'::jsonb, false, true, $2)`,
        [ids.get(rising), `cg-${RUN}`],
      );
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        // One session with triggers off, rather than `ALTER TABLE ... DISABLE
        // TRIGGER`, which is global: while that is off, a suite running in
        // parallel that asserts a row is immutable passes without testing
        // anything.
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM contributor_grant_event WHERE grant_id IN
             (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.end();
      await app.close();
    });

    describe('what a member is told about themselves', () => {
      it('needs a session', async () => {
        expect((await get('/me/contributor')).statusCode).toBe(401);
      });

      it('names what is missing, and says plainly that nobody has decided', async () => {
        const body = (await get('/me/contributor', quiet)).json() as ContributorStatusResponse;
        expect(body.eligibility.qualifies).toBe(false);
        expect(body.eligibility.shortfalls.map((s) => s.requirement)).toEqual([
          'settled',
          'rating',
        ]);
        expect(body.eligibility.rating).toBeNull();
        // Null, not a withdrawn grant. "Never considered" and "was approved and
        // then stopped" are different facts and only the second is owed an
        // explanation (rule 3).
        expect(body.grant).toBeNull();
      });

      it('says a qualifying member qualifies, and still gives them no grant', async () => {
        const body = (await get('/me/contributor', rising)).json() as ContributorStatusResponse;
        expect(body.eligibility.qualifies).toBe(true);
        expect(body.eligibility.shortfalls).toEqual([]);
        expect(body.eligibility.rating).toBe(88);
        // The whole of blueprint 10.2's fifth requirement, in one line: every
        // number says yes and nobody may post.
        expect(body.grant).toBeNull();
      });

      it('answers `GET /me/eligibility` from the same computation rather than a second one', async () => {
        const full = (await get('/me/contributor', quiet)).json() as ContributorStatusResponse;
        const older = (await get('/me/eligibility', quiet)).json() as EligibilityResponse;
        expect(older.eligibility.eligible).toBe(full.eligibility.qualifies);
        expect(older.eligibility.reasons).toEqual(
          full.eligibility.shortfalls.map((s) => s.message),
        );
        expect(older.eligibility.rules_version).toBe(full.eligibility.rules_version);
      });
    });

    describe('who may approve', () => {
      it('refuses a member without the role, and refuses the list too', async () => {
        expect((await get('/admin/contributors', rising)).statusCode).toBe(403);
        expect(
          (await post('/admin/contributors', { username: quiet, reason: 'why not' }, rising))
            .statusCode,
        ).toBe(403);
      });

      it('shows an approver who is worth deciding about', async () => {
        const body = (await get('/admin/contributors', approver)).json() as ContributorListResponse;
        const names = body.entries.map((e) => e.username);
        expect(names).toContain(rising);
        // `quiet` has settled nothing and holds no grant: there is nothing for a
        // reviewer to decide about them yet.
        expect(names).not.toContain(quiet);
      });
    });

    describe('approving names its approver and its reason', () => {
      it('refuses a blank reason, because the member is told it', async () => {
        const response = await post(
          '/admin/contributors',
          { username: rising, reason: '   ' },
          approver,
        );
        expect(response.statusCode).toBe(400);
      });

      it('refuses an unknown member with 404 rather than inventing one', async () => {
        expect(
          (
            await post(
              '/admin/contributors',
              { username: `nobody${RUN}`, reason: 'a reason' },
              approver,
            )
          ).statusCode,
        ).toBe(404);
      });

      it('grants, and the grant carries the approver, the reason and the rules version', async () => {
        const response = await post(
          '/admin/contributors',
          { username: rising, reason: 'reads the game well and argues it politely' },
          approver,
        );
        expect(response.statusCode).toBe(201);
        const grant = response.json() as ContributorGrant;
        expect(grant.username).toBe(rising);
        expect(grant.granted_by).toBe(approver);
        expect(grant.reason).toBe('reads the game well and argues it politely');
        expect(grant.standing).toBe('active');
        // Not taken from the caller: the server knows which rules are current.
        expect(grant.rules_version).toBe('contributor-rules@1.0.0');
        expect(grant.history).toEqual([]);
      });

      it('writes the audit row in the same act', async () => {
        const rows = await auditFor(rising);
        const granted = rows.find((r) => r.action === 'contributor.grant');
        expect(granted?.actor).toBe(approver);
        expect(granted?.reason).toBe('reads the game well and argues it politely');
        expect(granted?.next).toMatchObject({ standing: 'active' });
      });

      it('does not change what eligibility says about them', async () => {
        // The other direction of "eligibility never grants": a grant does not
        // grant eligibility either. They are two answers to two questions and
        // neither moves the other.
        const body = (await get('/me/contributor', rising)).json() as ContributorStatusResponse;
        expect(body.eligibility.qualifies).toBe(true);
        expect(body.eligibility.rules_version).toBe('privilege-eligibility@1.1.0');
        expect(body.grant?.standing).toBe('active');
      });

      it('refuses a second live grant', async () => {
        const response = await post(
          '/admin/contributors',
          { username: rising, reason: 'again' },
          approver,
        );
        expect(response.statusCode).toBe(400);
      });
    });

    describe('pausing, resuming and withdrawing', () => {
      it('pauses with a reason the member can read', async () => {
        const response = await post(
          `/admin/contributors/${rising}/pause`,
          { reason: 'an unresolved dispute about a post' },
          approver,
        );
        expect(response.statusCode).toBe(200);
        const grant = response.json() as ContributorGrant;
        expect(grant.standing).toBe('paused');
        expect(grant.history).toEqual([
          {
            kind: 'paused',
            actor: approver,
            reason: 'an unresolved dispute about a post',
            at: expect.any(String) as unknown as string,
          },
        ]);
      });

      it('records what the standing was before, not only what it is now', async () => {
        const paused = (await auditFor(rising)).find((r) => r.action === 'contributor.pause');
        // Rule 10 asks for the previous value, and "paused" with no "was active"
        // beside it does not say what changed.
        expect(paused?.previous).toMatchObject({ standing: 'active' });
        expect(paused?.next).toMatchObject({ standing: 'paused' });
      });

      it('refuses a second pause and says which refusal it was', async () => {
        const response = await post(
          `/admin/contributors/${rising}/pause`,
          { reason: 'again' },
          approver,
        );
        expect(response.statusCode).toBe(400);
        expect((response.json() as { message: string }).message).toMatch(/already paused/i);
      });

      it('resumes', async () => {
        const response = await post(
          `/admin/contributors/${rising}/resume`,
          { reason: 'the dispute was resolved' },
          approver,
        );
        expect(response.statusCode).toBe(200);
        expect((response.json() as ContributorGrant).standing).toBe('active');
      });

      it('refuses a pause, a resume or a withdrawal for somebody who holds nothing', async () => {
        const response = await post(
          `/admin/contributors/${quiet}/withdraw`,
          { reason: 'nothing to withdraw' },
          approver,
        );
        expect(response.statusCode).toBe(404);
      });

      it('withdraws, and the withdrawal is terminal', async () => {
        const withdrawn = await post(
          `/admin/contributors/${rising}/withdraw`,
          { reason: 'stopped posting to the rules they accepted' },
          approver,
        );
        expect(withdrawn.statusCode).toBe(200);
        expect((withdrawn.json() as ContributorGrant).standing).toBe('withdrawn');

        const resumed = await post(
          `/admin/contributors/${rising}/resume`,
          { reason: 'reconsidered' },
          approver,
        );
        // 404, not 400: `liveGrantId` finds nothing, because a withdrawn grant
        // is not a grant that can be acted on any more.
        expect(resumed.statusCode).toBe(404);
      });

      it('keeps the whole story where the member can read it', async () => {
        const body = (await get('/me/contributor', rising)).json() as ContributorStatusResponse;
        expect(body.grant?.standing).toBe('withdrawn');
        expect(body.grant?.history.map((e) => e.kind)).toEqual(['paused', 'resumed', 'withdrawn']);
        expect(body.grant?.history.map((e) => e.reason)).toEqual([
          'an unresolved dispute about a post',
          'the dispute was resolved',
          'stopped posting to the rules they accepted',
        ]);
      });

      it('allows a new approval afterwards, as a new grant with its own reason', async () => {
        const response = await post(
          '/admin/contributors',
          { username: rising, reason: 'a year later, and asked again' },
          approver,
        );
        expect(response.statusCode).toBe(201);
        const grant = response.json() as ContributorGrant;
        expect(grant.standing).toBe('active');
        expect(grant.history).toEqual([]);
        // The withdrawn one is still in the table, still naming who ended it.
        const { rows } = await pool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM contributor_grant WHERE user_id = $1`,
          [ids.get(rising)],
        );
        expect(rows[0]?.count).toBe('2');
      });

      it('has an audit row for every act, in order', async () => {
        const actions = (await auditFor(rising)).map((r) => r.action);
        expect(actions).toEqual([
          'contributor.grant',
          'contributor.pause',
          'contributor.resume',
          'contributor.withdraw',
          'contributor.grant',
        ]);
      });
    });
  },
);
