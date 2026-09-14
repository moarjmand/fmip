import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, PredictionHistoryResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PredictionsModule } from './predictions.module';

// A member's prediction history: the version that stands, its time, how it
// settled, and who may see it. Needs the real schema (CI has it).
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('Prediction history', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let owner = { id: '', cookie: '', username: '' };
  let other = { id: '', cookie: '', username: '' };
  let admin = '';
  const fixtures: string[] = [];
  let settledFixture = '';
  let openFixture = '';

  const inject = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

  async function register(username: string, displayName: string) {
    const registered = await inject('POST', '/auth/register', undefined, {
      username,
      display_name: displayName,
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

  async function fixture(kickoff: string): Promise<string> {
    const id = randomUUID();
    fixtures.push(id);
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now() + $3::interval, 'scheduled')`,
      [id, PL_2025, kickoff],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, HOME_TEAM, AWAY_TEAM],
    );
    return id;
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
      [HOME_TEAM, AWAY_TEAM, `Test Home ${RUN}`, `Test Away ${RUN}`],
    );
    owner = await register(`ph_${RUN}o`, 'History Owner');
    other = await register(`ph_${RUN}v`, 'History Viewer');
    const adm = await register(`ph_${RUN}a`, 'History Admin');
    admin = adm.cookie;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'history test')`,
      [adm.id],
    );

    // One match kicks off and gets settled; one is next week and stays open.
    settledFixture = await fixture('1 day');
    openFixture = await fixture('7 days');
    expect(
      (
        await inject('PUT', `/fixtures/${settledFixture}/prediction`, owner.cookie, {
          outcome: 'away',
          confidence: 2,
        })
      ).statusCode,
    ).toBe(200);
    // A second version before kick-off: this is the one that stands.
    expect(
      (
        await inject('PUT', `/fixtures/${settledFixture}/prediction`, owner.cookie, {
          outcome: 'home',
          score: { home: 2, away: 1 },
          confidence: 4,
          reason_tags: ['form'],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await inject('PUT', `/fixtures/${openFixture}/prediction`, owner.cookie, {
          outcome: 'draw',
          confidence: 3,
        })
      ).statusCode,
    ).toBe(200);
    // Kick-off moves back to the database's own `now()` once both versions are
    // in: they were written before this statement, so they stay earlier than
    // the lock, and every later read sees a match that has started. Sleeping
    // out a real kick-off instead raced the host clock against the database's,
    // which is not the thing under test -- and loses whenever the two drift.
    await pool.query(`UPDATE fixture SET status = 'finished', kickoff_at = now() WHERE id = $1`, [
      settledFixture,
    ]);
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 2, 1)`,
      [settledFixture],
    );
    expect((await inject('POST', `/fixtures/${settledFixture}/settle`, admin)).statusCode).toBe(
      200,
    );
  });

  afterAll(async () => {
    // Everything that references this run's accounts goes, whether or not the
    // tests passed, and no step undoes an earlier one. `rating_snapshot` and
    // `points_transaction` reference `user_account` with ON DELETE RESTRICT, so
    // leaving one behind makes the account delete fail for good: the run after
    // it inherits the account and fails too, until somebody clears the database
    // by hand. Neither table is written by anything in this file -- whoever
    // recomputes a recently settled member writes them, and `POST
    // /ratings/recompute` covers every such member, not only its own fixtures.
    const accounts = `ph_${RUN}%`;
    try {
      // One dedicated connection with `session_replication_role = 'replica'`,
      // which is scoped to this session: the rows a cascade cannot reach are
      // the immutable ones, and `ALTER TABLE ... DISABLE TRIGGER` would turn
      // their guard off for every suite running in parallel (03-project-map.md).
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM points_transaction WHERE user_id IN
             (SELECT id FROM user_account WHERE username LIKE $1)`,
          [accounts],
        );
        await client.query(
          `DELETE FROM rating_snapshot WHERE user_id IN
             (SELECT id FROM user_account WHERE username LIKE $1)`,
          [accounts],
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
      } finally {
        // Back to 'origin' before the accounts go: `replica` turns off
        // foreign-key triggers too, so the cascade that takes the credentials,
        // sessions, roles and predictions with them would not run.
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

  it('shows the version that stands, its time and the settlement, newest kick-off first', async () => {
    const response = await inject('GET', `/users/${owner.username}/predictions`);
    expect(response.statusCode).toBe(200);
    const history = response.json() as PredictionHistoryResponse;
    expect(history.kind).toBe('visible');
    if (history.kind !== 'visible') return;
    expect(history.is_self).toBe(false);
    expect(history.total).toBe(2);
    expect(history.items.map((i) => i.fixture.id)).toEqual([openFixture, settledFixture]);

    const [open, settled] = history.items as [
      (typeof history.items)[number],
      (typeof history.items)[number],
    ];
    expect(open.fixture.home.name).toBe(`Test Home ${RUN}`);
    expect(open.fixture.away.name).toBe(`Test Away ${RUN}`);
    expect(open.fixture.competition.name).toBeTruthy();
    expect(open.fixture.score).toBeNull();
    expect(open.prediction.locked).toBe(false);
    expect(open.prediction.settlement).toBeNull();
    expect(open.prediction.latest).toMatchObject({ version_number: 1, outcome: 'draw' });

    expect(settled.fixture.status).toBe('finished');
    expect(settled.fixture.score).toEqual({ home: 2, away: 1 });
    expect(settled.prediction.locked).toBe(true);
    expect(settled.prediction.versions).toHaveLength(2);
    expect(settled.prediction.latest).toMatchObject({
      version_number: 2,
      outcome: 'home',
      score: { home: 2, away: 1 },
      confidence: 4,
    });
    expect(Date.parse(settled.prediction.latest.submitted_at)).toBeLessThan(
      Date.parse(settled.prediction.locks_at),
    );
    expect(settled.prediction.settlement).toMatchObject({
      status: 'settled',
      outcome_correct: true,
      score_correct: true,
      version_number: 2,
      actual: { home: 2, away: 1 },
    });
  });

  it('pages, and refuses a page outside the limits', async () => {
    const page = (
      await inject('GET', `/users/${owner.username}/predictions?limit=1&offset=1`)
    ).json() as PredictionHistoryResponse;
    expect(page.kind).toBe('visible');
    if (page.kind !== 'visible') return;
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.fixture.id)).toEqual([settledFixture]);

    const bad = await inject('GET', `/users/${owner.username}/predictions?limit=500`);
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as ApiError).fields?.limit).toBeTruthy();

    expect((await inject('GET', `/users/nobody_${RUN}/predictions`)).statusCode).toBe(404);
  });

  it('follows the history visibility setting: owner always, others as allowed', async () => {
    expect(
      (
        await inject('PATCH', '/me/privacy', owner.cookie, {
          prediction_history_visibility: 'private',
        })
      ).statusCode,
    ).toBe(200);

    const asGuest = (
      await inject('GET', `/users/${owner.username}/predictions`)
    ).json() as PredictionHistoryResponse;
    expect(asGuest).toEqual({
      kind: 'restricted',
      username: owner.username,
      visibility: 'private',
    });

    const asOther = (
      await inject('GET', `/users/${owner.username}/predictions`, other.cookie)
    ).json() as PredictionHistoryResponse;
    expect(asOther.kind).toBe('restricted');

    const asOwner = (
      await inject('GET', `/users/${owner.username}/predictions`, owner.cookie)
    ).json() as PredictionHistoryResponse;
    expect(asOwner.kind).toBe('visible');
    if (asOwner.kind === 'visible') expect(asOwner.is_self).toBe(true);

    const mine = (
      await inject('GET', '/me/predictions', owner.cookie)
    ).json() as PredictionHistoryResponse;
    expect(mine.kind).toBe('visible');
    if (mine.kind === 'visible') expect(mine.total).toBe(2);
    expect((await inject('GET', '/me/predictions')).statusCode).toBe(401);

    // Friends-only: no friendships exist yet, so it is the owner alone (D-0xx in profile).
    await inject('PATCH', '/me/privacy', owner.cookie, {
      prediction_history_visibility: 'friends',
    });
    const friendsOnly = (
      await inject('GET', `/users/${owner.username}/predictions`, other.cookie)
    ).json() as PredictionHistoryResponse;
    expect(friendsOnly).toEqual({
      kind: 'restricted',
      username: owner.username,
      visibility: 'friends',
    });
  });
});
