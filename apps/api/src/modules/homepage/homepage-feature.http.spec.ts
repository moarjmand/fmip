import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FeaturedMatchesResponse, HomepageFeatureListResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { HomepageModule } from './homepage.module';

/**
 * Featured matches on the homepage (T-1161, D-153): only an editor or an
 * administrator features, with a note and a window; a guest reads what is
 * featured; an expired feature is gone at the next read with no job; clearing
 * early takes a reason; a finished match cannot be featured; every feature
 * and clear is an audit row with what was there before (rule 10).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('homepage features', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `hf_${RUN}e`;
  const admin = `hf_${RUN}a`;
  const member = `hf_${RUN}m`;
  const teams = [randomUUID(), randomUUID()];
  const upcoming = randomUUID();
  const finished = randomUUID();

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
    ids.set(username, rows[0]!.id);
  }

  const as = (username: string | null) =>
    username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` };
  const post = (fixture: string, path: string, who: string | null, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/${path}`,
      headers: as(who),
      payload: payload as Record<string, unknown>,
    });
  const featured = async () =>
    (await app.inject({ method: 'GET', url: '/featured-matches' })).json<FeaturedMatchesResponse>();
  const ours = async () => (await featured()).features.find((f) => f.fixture_id === upcoming);
  const audits = async () =>
    (
      await pool.query<{
        action: string;
        actor_id: string;
        reason: string;
        previous: Record<string, unknown> | null;
      }>(
        `SELECT action, actor_id, reason, previous FROM audit_log
          WHERE target_type = 'fixture' AND target_id = $1 ORDER BY created_at, id`,
        [upcoming],
      )
    ).rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, HomepageModule] })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
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

    await register(editor);
    await register(admin);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the homepage feature test'),
              ($2, 'admin', $2, 'the homepage feature test')`,
      [ids.get(editor), ids.get(admin)],
    );
    for (const [index, id] of teams.entries()) {
      await pool.query(
        `INSERT INTO team (id, country_id, name, short_name, kind, gender)
         VALUES ($1, $2, $3, $4, 'club', 'men')`,
        [id, ENGLAND, `Feature ${index}${RUN}`, `HF${index}`],
      );
    }
    for (const [id, when, status] of [
      [upcoming, `now() + interval '2 days'`, 'scheduled'],
      [finished, `now() - interval '2 days'`, 'finished'],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', ${when}, $4)`,
        [id, PL_2025, REGULAR_SEASON, status],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, teams[0], teams[1]],
      );
    }
  });

  afterAll(async () => {
    const fixtures = [upcoming, finished];
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'fixture' AND target_id = ANY($1::text[])`,
        [fixtures],
      );
    });
    await pool.query(`DELETE FROM homepage_feature WHERE fixture_id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      fixtures,
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`hf_${RUN}%`]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.end();
    await app.close();
  });

  it('lets only an editor or an administrator feature, and insists on the note and the window', async () => {
    const body = { note: 'Title decider.', hours: 24 };
    expect((await post(upcoming, 'feature', null, body)).statusCode).toBe(401);
    const refused = await post(upcoming, 'feature', member, body);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({
      error: 'forbidden',
      message: 'This needs the editor or administrator role.',
    });
    expect((await post(upcoming, 'feature', editor, { hours: 24 })).statusCode).toBe(400);
    for (const hours of [0, 1.5, 24 * 14 + 1, '24'])
      expect((await post(upcoming, 'feature', editor, { note: 'x', hours })).statusCode).toBe(400);
    expect(await ours()).toBeUndefined();
    expect(await audits()).toEqual([]);
  });

  it('refuses a match that is over, and one that does not exist', async () => {
    const over = await post(finished, 'feature', editor, { note: 'Too late.', hours: 5 });
    expect(over.statusCode).toBe(400);
    expect(over.json<{ message: string }>().message).toContain('finished');
    expect((await post(randomUUID(), 'feature', editor, { note: 'x', hours: 5 })).statusCode).toBe(
      404,
    );
  });

  it('features for the window, a guest sees it, and a second feature is refused', async () => {
    expect(
      (await post(upcoming, 'feature', editor, { note: 'Title decider.', hours: 24 })).statusCode,
    ).toBe(204);
    const feature = await ours();
    expect(feature?.note).toBe('Title decider.');
    const hours = (Date.parse(feature!.ends_at) - Date.parse(feature!.featured_at)) / 3_600_000;
    expect(hours).toBeCloseTo(24, 3);
    expect((await post(upcoming, 'feature', admin, { note: 'Again.', hours: 2 })).statusCode).toBe(
      400,
    );
    const [row] = await audits();
    expect(row).toMatchObject({
      action: 'homepage_feature.feature',
      actor_id: ids.get(editor),
      reason: 'Title decider.',
      previous: null,
    });
  });

  it('lists features for an editor, not for a member', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/admin/homepage-features', headers: as(member) }))
        .statusCode,
    ).toBe(403);
    const list = (
      await app.inject({ method: 'GET', url: '/admin/homepage-features', headers: as(editor) })
    ).json<HomepageFeatureListResponse>();
    const mine = list.features.find((f) => f.fixture_id === upcoming);
    expect(mine).toMatchObject({
      state: 'live',
      featured_by: editor,
      home: `Feature 0${RUN}`,
      away: `Feature 1${RUN}`,
    });
  });

  it('clears early only with a reason, and records what was there', async () => {
    expect((await post(upcoming, 'feature/clear', editor, {})).statusCode).toBe(400);
    expect((await post(upcoming, 'feature/clear', member, { reason: 'x' })).statusCode).toBe(403);
    expect(
      (await post(upcoming, 'feature/clear', admin, { reason: 'Postponed rumours.' })).statusCode,
    ).toBe(204);
    expect(await ours()).toBeUndefined();
    expect((await post(upcoming, 'feature/clear', admin, { reason: 'Again.' })).statusCode).toBe(
      404,
    );
    const rows = await audits();
    expect(rows[1]).toMatchObject({
      action: 'homepage_feature.clear',
      actor_id: ids.get(admin),
      reason: 'Postponed rumours.',
      previous: expect.objectContaining({ note: 'Title decider.' }),
    });
  });

  it('drops an expired feature at the next read, and lets the match be featured again', async () => {
    expect(
      (await post(upcoming, 'feature', editor, { note: 'Back on.', hours: 1 })).statusCode,
    ).toBe(204);
    expect((await ours())?.note).toBe('Back on.');
    // The window runs out: every feature of the match moved two hours into
    // the past in the database's own clock, so their order is kept.
    await pool.query(
      `UPDATE homepage_feature
          SET featured_at = featured_at - interval '2 hours', ends_at = ends_at - interval '2 hours'
        WHERE fixture_id = $1`,
      [upcoming],
    );
    expect(await ours()).toBeUndefined();
    const list = (
      await app.inject({ method: 'GET', url: '/admin/homepage-features', headers: as(editor) })
    ).json<HomepageFeatureListResponse>();
    expect(list.features.filter((f) => f.fixture_id === upcoming).map((f) => f.state)).toEqual([
      'expired',
      'cleared',
    ]);
    expect(
      (await post(upcoming, 'feature', editor, { note: 'Once more.', hours: 3 })).statusCode,
    ).toBe(204);
    const last = (await audits()).at(-1);
    expect(last?.previous).toMatchObject({ note: 'Back on.', cleared_at: null });
  });
});
