import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CareerPointsResponse, EligibilityResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ReputationModule } from './reputation.module';

// Career Points are a ledger over settlements: the acceptance criterion is
// that they cannot by themselves unlock privileges, and that re-awarding
// writes nothing new. Needs the real schema (CI has it).
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 20_000 });

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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Career Points', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let member = { id: '', cookie: '', username: '' };
  let admin = '';
  const fixtures: string[] = [];

  const inject = (
    method: 'GET' | 'POST' | 'PUT',
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
      display_name: 'Points Tester',
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
      // Never called here; the module needs one to boot.
      .overrideProvider(MODEL_CLIENT)
      .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [HOME_TEAM, AWAY_TEAM, `Test Home ${RUN}`, `Test Away ${RUN}`],
    );
    member = await register(`cp_${RUN}m`);
    const adm = await register(`cp_${RUN}a`);
    admin = adm.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'points test')`,
      [adm.id],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [table, trigger] of [
        ['points_transaction', 'points_transaction_immutable'],
        ['rating_snapshot', 'rating_snapshot_immutable'],
        ['settlement', 'settlement_immutable'],
        ['settlement_run', 'settlement_run_immutable'],
        ['prediction_version', 'prediction_version_immutable'],
      ]) {
        await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      await client.query(
        `DELETE FROM points_transaction WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
        [`cp_${RUN}%`],
      );
      await client.query(
        `DELETE FROM rating_snapshot WHERE user_id IN (SELECT id FROM user_account WHERE username LIKE $1)`,
        [`cp_${RUN}%`],
      );
      await client.query(`DELETE FROM settlement WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM settlement_run WHERE fixture_id = ANY($1::uuid[])`, [
        fixtures,
      ]);
      await client.query(
        `DELETE FROM prediction_version WHERE prediction_id IN
           (SELECT id FROM user_prediction WHERE fixture_id = ANY($1::uuid[]))`,
        [fixtures],
      );
      for (const [table, trigger] of [
        ['prediction_version', 'prediction_version_immutable'],
        ['settlement_run', 'settlement_run_immutable'],
        ['settlement', 'settlement_immutable'],
        ['rating_snapshot', 'rating_snapshot_immutable'],
        ['points_transaction', 'points_transaction_immutable'],
      ]) {
        await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
      await client.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cp_${RUN}%`]);
      await client.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await client.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME_TEAM, AWAY_TEAM]]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await pool.end();
    await app.close();
  });

  it('starts at zero and needs a session', async () => {
    expect((await inject('GET', '/me/points')).statusCode).toBe(401);
    const mine = (await inject('GET', '/me/points', member.cookie)).json() as CareerPointsResponse;
    expect(mine.points).toMatchObject({
      total: 0,
      settled_predictions: 0,
      current_streak: 0,
      recent: [],
    });
  });

  it('awards points from settlements once, and a second pass writes nothing', async () => {
    // Three matches predicted before kick-off: right with the exact score, right, wrong.
    const plan: [
      outcome: 'home' | 'away',
      score: { home: number; away: number } | null,
      result: [number, number],
    ][] = [
      ['home', { home: 2, away: 0 }, [2, 0]],
      ['home', null, [1, 0]],
      ['away', null, [3, 1]],
    ];
    const ids: string[] = [];
    for (const [outcome, score] of plan) {
      const id = randomUUID();
      fixtures.push(id);
      ids.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now() + interval '6 seconds', 'scheduled')`,
        [id, PL_2025],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, HOME_TEAM, AWAY_TEAM],
      );
      expect(
        (
          await inject('PUT', `/fixtures/${id}/prediction`, member.cookie, {
            outcome,
            score,
            confidence: 3,
          })
        ).statusCode,
      ).toBe(200);
    }
    await new Promise((resolve) => setTimeout(resolve, 7_000));
    for (const [index, [, , [home, away]]] of plan.entries()) {
      const id = ids[index]!;
      await pool.query(`UPDATE fixture SET status = 'finished' WHERE id = $1`, [id]);
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, home, away],
      );
      expect((await inject('POST', `/fixtures/${id}/settle`, admin)).statusCode).toBe(200);
    }

    const first = (
      await inject('POST', '/me/points/award', member.cookie)
    ).json() as CareerPointsResponse;
    // settled 3 × 1, correct 2 × 3, exact 1 × 5 = 14
    expect(first.points).toMatchObject({
      total: 14,
      settled_predictions: 3,
      correct_outcomes: 2,
      exact_scores: 1,
      current_streak: 0,
      rules_version: 'career-points@1.0.0',
    });
    expect(first.added).toBe(6);

    const second = (
      await inject('POST', '/me/points/award', member.cookie)
    ).json() as CareerPointsResponse;
    expect(second.added).toBe(0);
    expect(second.points.total).toBe(14);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM points_transaction WHERE user_id = $1`,
      [member.id],
    );
    expect(rows[0]?.n).toBe('6');

    const theirs = (
      await inject('GET', `/users/${member.username}/points`)
    ).json() as CareerPointsResponse;
    expect(theirs.points.total).toBe(14);
    expect(theirs.points.recent.map((t) => t.reason).sort()).toEqual(
      ['correct_outcome', 'correct_outcome', 'exact_score', 'settled', 'settled', 'settled'].sort(),
    );
  });

  it('cannot by itself unlock privileges: points are not an input to eligibility', async () => {
    // The member holds points but has three settled predictions and, at most, a
    // provisional rating: not eligible, and the reasons name rating and sample, never points.
    const before = (
      await inject('GET', '/me/eligibility', member.cookie)
    ).json() as EligibilityResponse;
    expect(before.eligibility.eligible).toBe(false);
    expect(before.eligibility.reasons.join(' ')).not.toMatch(/point/i);
    expect(before.eligibility.reasons.some((r) => r.includes('settle at least 50'))).toBe(true);

    // Even a ledger stuffed by hand changes nothing about eligibility.
    const { rows } = await pool.query<{ id: string }>(
      `SELECT s.id FROM settlement s JOIN user_prediction p ON p.id = s.prediction_id WHERE p.user_id = $1 LIMIT 1`,
      [member.id],
    );
    await pool.query(
      `INSERT INTO points_transaction (user_id, settlement_id, reason, points, rule_version)
       VALUES ($1, $2, 'streak_10', 1000000, 'career-points@1.0.0')`,
      [member.id, rows[0]?.id],
    );
    const after = (
      await inject('GET', '/me/eligibility', member.cookie)
    ).json() as EligibilityResponse;
    expect((await inject('GET', '/me/points', member.cookie)).json()).toMatchObject({
      points: { total: 1000014 },
    });
    expect(after.eligibility).toEqual(before.eligibility);
    await expect(
      pool.query(`UPDATE points_transaction SET points = 1 WHERE user_id = $1`, [member.id]),
    ).rejects.toMatchObject({ code: '23001' });
  });
});
