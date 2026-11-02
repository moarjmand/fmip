import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  OwnPredictionShareResponse,
  PredictionShareResponse,
  PublicPredictionShareResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';

/**
 * A public link to one correct prediction's card (T-1723, D-351): made only
 * by its owner, for a correct settled pick only, revocable, and nothing is
 * public without it. Needs the real schema (CI has it).
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const HOME_TEAM = randomUUID();
const AWAY_TEAM = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Prediction share links', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let owner = { id: '', cookie: '', username: '' };
  let other = { id: '', cookie: '', username: '' };
  let admin = '';
  const fixtures: string[] = [];
  let calledId = '';
  let wrongId = '';

  const inject = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      payload: payload as Record<string, unknown> | undefined,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  async function register(username: string) {
    const registered = await inject('POST', '/auth/register', undefined, {
      username,
      display_name: username,
      email: `${username}@example.test`,
      password: 'correct horse battery staple',
      country_id: ENGLAND,
      preferred_language: 'en',
      timezone: 'Europe/London',
      accept_rules: true,
    });
    const id = (registered.json() as { user: { id: string } }).user.id;
    await pool.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [id]);
    return { id, cookie: cookieValue(registered.headers['set-cookie']), username };
  }

  /** A match the member predicts, then finishes 0-1 and is settled. */
  async function settledMatch(cookie: string, outcome: 'home' | 'away'): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now() + interval '1 day', 'scheduled')`,
      [id, PL_2025],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, HOME_TEAM, AWAY_TEAM],
    );
    const put = await inject('PUT', `/fixtures/${id}/prediction`, cookie, {
      outcome,
      confidence: 3,
    });
    expect(put.statusCode).toBe(200);
    const predictionId = (put.json() as { prediction: { id: string } }).prediction.id;
    await pool.query(`UPDATE fixture SET status = 'finished', kickoff_at = now() WHERE id = $1`, [
      id,
    ]);
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 0, 1)`,
      [id],
    );
    expect((await inject('POST', `/fixtures/${id}/settle`, admin)).statusCode).toBe(200);
    return predictionId;
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
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [HOME_TEAM, AWAY_TEAM, `Share Home ${RUN}`, `Share Away ${RUN}`],
    );
    owner = await register(`psh_${RUN}o`);
    other = await register(`psh_${RUN}v`);
    const adm = await register(`psh_${RUN}a`);
    admin = adm.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'share test')`,
      [adm.id],
    );
    // The owner keeps their predictions private: a card is public only by its link.
    await pool.query(
      `INSERT INTO privacy_setting (user_id, prediction_history_visibility)
       VALUES ($1, 'private')
       ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = 'private'`,
      [owner.id],
    );
    calledId = await settledMatch(owner.cookie, 'away');
    wrongId = await settledMatch(owner.cookie, 'home');
  });

  afterAll(async () => {
    const accounts = `psh_${RUN}%`;
    try {
      // Not final any more, so a settlement pass running in a parallel suite
      // (`POST /settlements/run`) cannot settle these again mid-cleanup and
      // leave a run row that keeps the fixture from being deleted.
      await pool.query(`UPDATE fixture SET status = 'scheduled' WHERE id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        for (const table of ['points_transaction', 'rating_snapshot']) {
          await client.query(
            `DELETE FROM ${table} WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
            [accounts],
          );
        }
        await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
        await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
          fixtures,
        ]);
        await client.query(
          `DELETE FROM prediction_version WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
          [fixtures],
        );
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [accounts]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME_TEAM, AWAY_TEAM]]);
    } finally {
      await pool.end();
      await app.close();
    }
  });

  it('tells the owner of a correct pick, once, with the way to its card', async () => {
    const { rows } = await pool.query<{ kind: string; subject_id: string }>(
      `SELECT kind, subject_id FROM notification WHERE user_id = $1 AND kind = 'prediction_settled'`,
      [owner.id],
    );
    // The wrong pick is not told: it has nothing to share.
    expect(rows).toEqual([{ kind: 'prediction_settled', subject_id: calledId }]);
  });

  it('shows the owner their card before anything is public, and nothing to anybody else', async () => {
    const own = await inject('GET', `/me/predictions/${calledId}/share`, owner.cookie);
    expect(own.statusCode).toBe(200);
    const body = own.json() as OwnPredictionShareResponse;
    expect(body.kind).toBe('called');
    if (body.kind !== 'called') return;
    expect(body.share).toBeNull();
    expect(body.card).toMatchObject({
      actual: { home: 0, away: 1 },
      pick: { outcome: 'away', score: null },
      exact: false,
      username: owner.username,
    });

    expect((await inject('GET', `/me/predictions/${calledId}/share`)).statusCode).toBe(401);
    // Somebody else's prediction answers as one that does not exist.
    expect(
      (await inject('GET', `/me/predictions/${calledId}/share`, other.cookie)).statusCode,
    ).toBe(404);
    expect((await inject('GET', `/me/predictions/${wrongId}/share`, owner.cookie)).json()).toEqual({
      kind: 'not_called',
      reason: 'wrong',
    });
  });

  it('refuses a link to somebody else’s prediction and to a wrong pick', async () => {
    expect((await inject('POST', `/me/predictions/${calledId}/share`)).statusCode).toBe(401);
    expect(
      (await inject('POST', `/me/predictions/${calledId}/share`, other.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await inject('POST', `/me/predictions/${wrongId}/share`, owner.cookie)).statusCode,
    ).toBe(409);
    expect(
      (await inject('DELETE', `/me/predictions/${calledId}/share`, other.cookie)).statusCode,
    ).toBe(404);
    const { rows } = await pool.query(`SELECT 1 FROM prediction_share WHERE prediction_id = $1`, [
      calledId,
    ]);
    expect(rows).toEqual([]);
  });

  it('the schema too refuses a link made in another member’s name', async () => {
    await expect(
      pool.query(
        `INSERT INTO prediction_share (token, prediction_id, user_id) VALUES ($1, $2, $3)`,
        ['AAAAAAAAAAAAAAAAAAAAAA', calledId, other.id],
      ),
    ).rejects.toMatchObject({ code: 'PL006' });
  });

  it('opens nothing without a live token: none, unknown, then made, then revoked', async () => {
    expect((await inject('GET', '/prediction-shares/not-a-token')).statusCode).toBe(404);
    expect((await inject('GET', '/prediction-shares/AAAAAAAAAAAAAAAAAAAAAA')).statusCode).toBe(404);

    const made = await inject('POST', `/me/predictions/${calledId}/share`, owner.cookie);
    expect(made.statusCode).toBe(200);
    const { share } = made.json() as PredictionShareResponse;
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Pressing Share again is the same link.
    const again = await inject('POST', `/me/predictions/${calledId}/share`, owner.cookie);
    expect((again.json() as PredictionShareResponse).share.token).toBe(share.token);

    const shown = await inject('GET', `/prediction-shares/${share.token}`);
    expect(shown.statusCode).toBe(200);
    expect((shown.json() as PublicPredictionShareResponse).card).toMatchObject({
      fixture_id: fixtures[0],
      actual: { home: 0, away: 1 },
      pick: { outcome: 'away', score: null },
      username: owner.username,
    });
    // The private history stays private: the link opens one card, not the list.
    expect((await inject('GET', `/users/${owner.username}/predictions`)).json()).toMatchObject({
      kind: 'restricted',
    });

    expect(
      (await inject('DELETE', `/me/predictions/${calledId}/share`, owner.cookie)).statusCode,
    ).toBe(204);
    expect((await inject('GET', `/prediction-shares/${share.token}`)).statusCode).toBe(404);
    // Revoked once; a revoked link is never brought back.
    await expect(
      pool.query(`UPDATE prediction_share SET revoked_at = NULL WHERE token = $1`, [share.token]),
    ).rejects.toMatchObject({ code: 'PL007' });

    // A new press makes a new link; the old one stays dead.
    const fresh = (
      (
        await inject('POST', `/me/predictions/${calledId}/share`, owner.cookie)
      ).json() as PredictionShareResponse
    ).share;
    expect(fresh.token).not.toBe(share.token);
    expect((await inject('GET', `/prediction-shares/${fresh.token}`)).statusCode).toBe(200);
    expect((await inject('GET', `/prediction-shares/${share.token}`)).statusCode).toBe(404);
  });

  it('opens nothing once the member has left', async () => {
    const { share } = (
      await inject('POST', `/me/predictions/${calledId}/share`, owner.cookie)
    ).json() as PredictionShareResponse;
    await pool.query(`UPDATE user_account SET status = 'suspended' WHERE id = $1`, [owner.id]);
    try {
      expect((await inject('GET', `/prediction-shares/${share.token}`)).statusCode).toBe(404);
    } finally {
      await pool.query(`UPDATE user_account SET status = 'active' WHERE id = $1`, [owner.id]);
    }
  });
});
