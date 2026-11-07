import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, PendingPickResponse, PredictionResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { PendingPickService } from './pending-pick.service';
import { PredictionsModule } from './predictions.module';

// T-1740, D-361: a pick made before the e-mail address is confirmed, against
// the real schema and through the real confirmation -- the token from the
// mail the API wrote, spent on `POST /auth/verify-email`. What the database
// refuses on its own clock, and that a prediction exists only once the address
// is confirmed before kick-off, cannot be shown without it.
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PASSWORD = 'correct horse battery staple';

// Open far into the future; one that will have kicked off by the time its
// member confirms; one that kicked off long ago.
const OPEN = randomUUID();
const SOON = randomUUID();
const PAST = randomUUID();

type Name = 'early' | 'late' | 'other' | 'busy';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  '/fixtures/:id/pending-pick',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const mailer = new CaptureMailer();
    const members = {} as Record<Name, { id: string; email: string; cookie: string }>;

    const call = (
      method: 'GET' | 'PUT' | 'DELETE' | 'POST',
      url: string,
      name: Name | null,
      payload?: unknown,
    ) =>
      app.inject({
        method,
        url,
        ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
        headers: name === null ? {} : { cookie: `fmip_session=${members[name].cookie}` },
      });
    const pick = (name: Name | null, fixtureId: string, outcome: string) =>
      call('PUT', `/fixtures/${fixtureId}/pending-pick`, name, { outcome });
    const standing = async (name: Name, fixtureId: string) =>
      (
        (
          await call('GET', `/fixtures/${fixtureId}/pending-pick`, name)
        ).json() as PendingPickResponse
      ).pending_pick;
    /** Every pending pick of a member on a match, oldest first: outcome and stored status. */
    const stored = async (name: Name, fixtureId: string) =>
      (
        await pool.query<{ outcome: string; status: string }>(
          `SELECT outcome, status FROM pending_pick
            WHERE user_id = $1 AND fixture_id = $2 ORDER BY created_at, id`,
          [members[name].id, fixtureId],
        )
      ).rows.map((row) => `${row.outcome}:${row.status}`);
    const versions = async (name: Name, fixtureId: string) =>
      (
        await pool.query<{
          version_number: number;
          outcome: string;
          confidence: number;
          home_goals: number | null;
          reason_tags: string[];
          explanation: string | null;
          submitted_at: Date;
        }>(
          `SELECT v.version_number, v.outcome, v.confidence, v.home_goals, v.reason_tags,
                  v.explanation, v.submitted_at
             FROM prediction_version v JOIN user_prediction p ON p.id = v.prediction_id
            WHERE p.user_id = $1 AND p.fixture_id = $2 ORDER BY v.version_number`,
          [members[name].id, fixtureId],
        )
      ).rows;
    /** Confirms the member's address with the token from the mail the API wrote. */
    const confirm = async (name: Name) => {
      const mail = mailer.sent.find((sent) => sent.to === members[name].email);
      const token = /token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1] ?? '';
      return call('POST', '/auth/verify-email', null, { token });
    };

    async function register(name: Name): Promise<void> {
      const username = `pp_${RUN}${name.slice(0, 3)}`;
      const email = `${username}@example.test`;
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          username,
          display_name: `Pending ${name}`,
          email,
          password: PASSWORD,
          country_id: ENGLAND,
          preferred_language: 'en',
          timezone: 'Europe/London',
          accept_rules: true,
        },
      });
      expect(response.statusCode).toBe(201);
      members[name] = {
        id: (response.json() as { user: { id: string } }).user.id,
        email,
        cookie: cookieValue(response.headers['set-cookie']),
      };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, PredictionsModule],
      })
        .overrideProvider(IDENTITY_OPTIONS)
        .useValue({
          ...DEFAULT_IDENTITY_OPTIONS,
          sessionSecret: 'test-secret-'.repeat(4),
          webBaseUrl: 'http://web.test',
          cookieSecure: false,
        })
        .overrideProvider(MAILER)
        .useValue(mailer)
        .compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
         ($1, $4, TIMESTAMPTZ '2088-04-04 15:00:00+00', 'scheduled'),
         ($2, $4, TIMESTAMPTZ '2088-04-05 15:00:00+00', 'scheduled'),
         ($3, $4, TIMESTAMPTZ '2025-09-01 15:00:00+00', 'finished')`,
        [OPEN, SOON, PAST, PL_2025],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $4, 'home'), ($1, $5, 'away'), ($2, $5, 'home'), ($2, $4, 'away'),
         ($3, $5, 'home'), ($3, $4, 'away')`,
        [OPEN, SOON, PAST, LIVERPOOL, MAN_UNITED],
      );
      for (const name of ['early', 'late', 'other', 'busy'] as const) await register(name);
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const ids = Object.values(members).map((m) => m.id);
      // Versions refuse DELETE, so they go first on a session of their own;
      // the accounts' cascade takes the predictions and the pending picks.
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM prediction_version WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
          [ids],
        );
      });
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[OPEN, SOON, PAST]]);
      await pool.end();
      await app.close();
    });

    it('blocks guests on every verb', async () => {
      expect((await pick(null, OPEN, 'home')).statusCode).toBe(401);
      expect((await call('GET', `/fixtures/${OPEN}/pending-pick`, null)).statusCode).toBe(401);
      expect((await call('DELETE', `/fixtures/${OPEN}/pending-pick`, null)).statusCode).toBe(401);
    });

    it('answers null before a pick, and 404 for a match that is not one', async () => {
      expect(await standing('early', OPEN)).toBeNull();
      expect((await pick('early', randomUUID(), 'home')).statusCode).toBe(404);
      expect((await pick('early', 'not-a-uuid', 'home')).statusCode).toBe(404);
    });

    it('saves the pick of a member whose address is not confirmed, and it is not a prediction', async () => {
      const response = await pick('early', OPEN, 'home');
      expect(response.statusCode).toBe(200);
      expect((response.json() as PendingPickResponse).pending_pick).toMatchObject({
        fixture_id: OPEN,
        outcome: 'home',
        status: 'pending',
        resolved_at: null,
        counts_before: '2088-04-04T15:00:00.000Z',
      });
      // Nothing in the prediction's tables, so nothing in a consensus, a
      // settlement or a rating; the prediction route still says there is none.
      expect(await versions('early', OPEN)).toEqual([]);
      expect((await call('GET', `/fixtures/${OPEN}/prediction`, 'early')).statusCode).toBe(404);
      // And the prediction route still refuses the member, as before.
      const predicting = await call('PUT', `/fixtures/${OPEN}/prediction`, 'early', {
        outcome: 'home',
        confidence: 3,
      });
      expect(predicting.statusCode).toBe(403);
      expect(predicting.json() as ApiError).toMatchObject({ error: 'email_unverified' });
    });

    it('names what is not part of a pick', async () => {
      const response = await pick('early', OPEN, 'win');
      expect(response.statusCode).toBe(400);
      expect(response.json() as ApiError).toMatchObject({
        error: 'validation',
        fields: { outcome: 'must be home, draw or away' },
      });
      const detailed = await call('PUT', `/fixtures/${OPEN}/pending-pick`, 'early', {
        outcome: 'home',
        confidence: 5,
      });
      expect(detailed.statusCode).toBe(400);
      expect((detailed.json() as ApiError).fields).toEqual({
        confidence: 'is not part of a pending pick',
      });
    });

    it('replaces the waiting pick when the member chooses again, keeping what it was', async () => {
      expect((await pick('early', OPEN, 'away')).statusCode).toBe(200);
      expect(await stored('early', OPEN)).toEqual(['home:replaced', 'away:pending']);
      // The same outcome again adds nothing.
      expect((await pick('early', OPEN, 'away')).statusCode).toBe(200);
      expect(await stored('early', OPEN)).toEqual(['home:replaced', 'away:pending']);
      expect(await standing('early', OPEN)).toMatchObject({ outcome: 'away', status: 'pending' });
    });

    it('shows a pick to its owner and to nobody else', async () => {
      expect(await standing('other', OPEN)).toBeNull();
      // Another member's own pick on the same match is theirs alone.
      expect((await pick('other', OPEN, 'draw')).statusCode).toBe(200);
      expect(await standing('early', OPEN)).toMatchObject({ outcome: 'away' });
      expect(await standing('other', OPEN)).toMatchObject({ outcome: 'draw' });
    });

    it('lets the member take a waiting pick back, once', async () => {
      expect((await call('DELETE', `/fixtures/${OPEN}/pending-pick`, 'other')).statusCode).toBe(
        204,
      );
      expect(await stored('other', OPEN)).toEqual(['draw:withdrawn']);
      expect(await standing('other', OPEN)).toMatchObject({ status: 'withdrawn' });
      expect((await call('DELETE', `/fixtures/${OPEN}/pending-pick`, 'other')).statusCode).toBe(
        404,
      );
    });

    it('refuses a pick after kick-off, here and in the database', async () => {
      const response = await pick('early', PAST, 'home');
      expect(response.statusCode).toBe(409);
      expect(response.json() as ApiError).toMatchObject({ error: 'locked' });
      // A caller that skipped the API's clock meets the schema's.
      await expect(
        pool.query(
          `INSERT INTO pending_pick (user_id, fixture_id, outcome) VALUES ($1, $2, 'home')`,
          [members.early.id, PAST],
        ),
      ).rejects.toMatchObject({ code: 'PL023', hint: 'kickoff' });
      expect(await stored('early', PAST)).toEqual([]);
    });

    it('keeps what was chosen as it was chosen: the schema refuses a rewrite', async () => {
      await expect(
        pool.query(
          `UPDATE pending_pick SET outcome = 'draw'
            WHERE user_id = $1 AND fixture_id = $2 AND status = 'pending'`,
          [members.early.id, OPEN],
        ),
      ).rejects.toMatchObject({ code: 'PL007' });
      await expect(
        pool.query(
          `UPDATE pending_pick SET status = 'converted'
            WHERE user_id = $1 AND fixture_id = $2 AND status = 'replaced'`,
          [members.early.id, OPEN],
        ),
      ).rejects.toMatchObject({ code: 'PL007' });
      // One pick waiting per member per match.
      await expect(
        pool.query(
          `INSERT INTO pending_pick (user_id, fixture_id, outcome) VALUES ($1, $2, 'home')`,
          [members.early.id, OPEN],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      // And none is made already resolved.
      await expect(
        pool.query(
          `INSERT INTO pending_pick (user_id, fixture_id, outcome, status, resolved_at)
           VALUES ($1, $2, 'home', 'converted', now())`,
          [members.early.id, SOON],
        ),
      ).rejects.toMatchObject({ code: 'PL023', hint: 'status' });
    });

    describe('confirming the address before kick-off', () => {
      let before: Date;
      let after: Date;

      beforeAll(async () => {
        before = (await pool.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
        const response = await confirm('early');
        expect(response.statusCode).toBe(200);
        after = (await pool.query<{ now: Date }>(`SELECT clock_timestamp() AS now`)).rows[0]!.now;
      });

      it('writes exactly one ordinary first version, timed at the confirmation', async () => {
        const rows = await versions('early', OPEN);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          version_number: 1,
          // The pick that was waiting, not the one it replaced.
          outcome: 'away',
          confidence: 3,
          home_goals: null,
          reason_tags: [],
          explanation: null,
        });
        // Nothing is back-dated: the version is of the moment of confirmation,
        // not of the tap that chose it.
        const submitted = rows[0]!.submitted_at.getTime();
        expect(submitted).toBeGreaterThanOrEqual(before.getTime());
        expect(submitted).toBeLessThanOrEqual(after.getTime());
        const chosen = await pool.query<{ created_at: Date }>(
          `SELECT created_at FROM pending_pick
            WHERE user_id = $1 AND fixture_id = $2 AND outcome = 'away'`,
          [members.early.id, OPEN],
        );
        expect(submitted).toBeGreaterThan(chosen.rows[0]!.created_at.getTime());
      });

      it('records what became of each pick', async () => {
        expect(await stored('early', OPEN)).toEqual(['home:replaced', 'away:converted']);
        expect(await standing('early', OPEN)).toMatchObject({ status: 'converted' });
      });

      it('is the member’s prediction from then on, by the prediction’s own routes', async () => {
        const own = await call('GET', `/fixtures/${OPEN}/prediction`, 'early');
        expect(own.statusCode).toBe(200);
        const { prediction } = own.json() as PredictionResponse;
        expect(prediction.latest).toMatchObject({ version_number: 1, outcome: 'away' });
        expect(prediction.versions).toHaveLength(1);
        // Changing it is an ordinary second version.
        const changed = await call('PUT', `/fixtures/${OPEN}/prediction`, 'early', {
          outcome: 'home',
          confidence: 4,
        });
        expect(changed.statusCode).toBe(200);
        expect((await versions('early', OPEN)).map((v) => v.version_number)).toEqual([1, 2]);
      });

      it('is safe to run twice: a second confirmation or a second run writes nothing', async () => {
        // The link works once.
        expect((await confirm('early')).statusCode).toBe(400);
        expect(await app.get(PendingPickService).convertFor(members.early.id)).toEqual({
          converted: 0,
          expired: 0,
          left: 0,
        });
        expect((await versions('early', OPEN)).map((v) => v.version_number)).toEqual([1, 2]);
      });

      it('refuses a pending pick from a member whose address is confirmed', async () => {
        const response = await pick('early', SOON, 'home');
        expect(response.statusCode).toBe(409);
        expect(response.json() as ApiError).toMatchObject({ error: 'conflict' });
        // The schema says the same to a caller that skipped the API.
        await expect(
          pool.query(
            `INSERT INTO pending_pick (user_id, fixture_id, outcome) VALUES ($1, $2, 'home')`,
            [members.early.id, SOON],
          ),
        ).rejects.toMatchObject({ code: 'PL023', hint: 'verified' });
        expect(await stored('early', SOON)).toEqual([]);
      });
    });

    describe('confirming the address after kick-off', () => {
      beforeAll(async () => {
        expect((await pick('late', SOON, 'draw')).statusCode).toBe(200);
        // The match kicks off before the member confirms.
        await pool.query(
          `UPDATE fixture SET kickoff_at = now() - interval '1 minute' WHERE id = $1`,
          [SOON],
        );
      });

      it('reads as expired from kick-off on, before anything has recorded it', async () => {
        expect(await stored('late', SOON)).toEqual(['draw:pending']);
        expect(await standing('late', SOON)).toMatchObject({ outcome: 'draw', status: 'expired' });
        // Saved, not counted: it is kept, not taken back.
        const withdrawn = await call('DELETE', `/fixtures/${SOON}/pending-pick`, 'late');
        expect(withdrawn.statusCode).toBe(409);
        expect(withdrawn.json() as ApiError).toMatchObject({ error: 'locked' });
      });

      it('confirms the address all the same, writes no prediction and leaves the pick expired', async () => {
        expect((await confirm('late')).statusCode).toBe(200);
        const me = await call('GET', '/auth/me', 'late');
        expect((me.json() as { user: { email_verified: boolean } }).user.email_verified).toBe(true);
        expect(await versions('late', SOON)).toEqual([]);
        expect(
          (
            await pool.query(
              `SELECT 1 FROM user_prediction WHERE user_id = $1 AND fixture_id = $2`,
              [members.late.id, SOON],
            )
          ).rowCount,
        ).toBe(0);
        expect(await stored('late', SOON)).toEqual(['draw:expired']);
        expect(await standing('late', SOON)).toMatchObject({ outcome: 'draw', status: 'expired' });
        expect((await call('GET', `/fixtures/${SOON}/prediction`, 'late')).statusCode).toBe(404);
      });
    });

    it('holds a member to the ceiling on choosing', async () => {
      const { rows } = await pool.query<{ per_hour: number }>(
        `SELECT per_hour FROM rate_limit WHERE action = 'pending_pick'`,
      );
      const ceiling = rows[0]?.per_hour ?? 0;
      expect(ceiling).toBe(60);
      // Each change of mind is a row; the one past the ceiling is refused.
      for (let n = 0; n < ceiling; n += 1) {
        const response = await pick('busy', OPEN, n % 2 === 0 ? 'home' : 'away');
        expect(response.statusCode, `pick ${n + 1}`).toBe(200);
      }
      const refused = await pick('busy', OPEN, 'draw');
      expect(refused.statusCode).toBe(429);
      expect(refused.json() as ApiError).toMatchObject({ error: 'rate_limited' });
      // The refused change left the waiting pick as it was.
      expect(await standing('busy', OPEN)).toMatchObject({ outcome: 'away', status: 'pending' });
    });
  },
);
