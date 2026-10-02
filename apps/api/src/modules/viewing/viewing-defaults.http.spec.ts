import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  BroadcasterResponse,
  MatchViewing,
  ViewingBulkResponse,
  ViewingCompetitionsResponse,
  ViewingDefaultResponse,
  ViewingDefaultsResponse,
  ViewingUpcomingResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ViewingModule } from './viewing.module';

/**
 * Defaults and bulk listing (T-1360, D-181), through the API: a default lists
 * the covered upcoming matches of its competition and nothing else; applying
 * again adds nothing; a removed listing is an exception it never re-creates;
 * removing the default takes its future listings and keeps the ones already
 * true; bulk listing refuses a match nobody covered and reports what was
 * already listed; only an editor does any of it.
 *
 * Everything here is this file's own: two competitions, their seasons,
 * fixtures, teams and broadcasters, so applying never touches another
 * suite's rows and the cleanup deletes only what this file wrote.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
// Territories no other viewing spec touches.
const NL = 'NL';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('viewing defaults', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `vd_${RUN}e`;
  const member = `vd_${RUN}m`;

  const competition = randomUUID();
  const elsewhere = randomUUID();
  const season = randomUUID();
  const lastSeason = randomUUID();
  const elsewhereSeason = randomUUID();
  const teams = [randomUUID(), randomUUID()];
  const f = {
    soon: randomUUID(),
    later: randomUUID(),
    live: randomUUID(),
    played: randomUUID(),
    stale: randomUUID(),
    postponed: randomUUID(),
    uncovered: randomUUID(),
    otherCompetition: randomUUID(),
  };
  const broadcasters: string[] = [];
  let defaultId = '';

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

  const as = (username: string) => ({ cookie: `fmip_session=${cookies.get(username) ?? ''}` });

  const declare = (seasonId: string) =>
    app.inject({
      method: 'PUT',
      url: '/admin/viewing/coverage',
      headers: as(editor),
      payload: {
        season_id: seasonId,
        territory: NL,
        module: 'viewing',
        state: 'available',
        note: `schedule ${RUN}`,
      },
    });

  const broadcaster = async (name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/viewing/broadcasters',
      headers: as(editor),
      payload: { name: `${name} ${RUN}`, homepage_url: null, kind: 'tv' },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json<BroadcasterResponse>().broadcaster.id;
    broadcasters.push(id);
    return id;
  };

  const listed = async (): Promise<
    { fixture_id: string; broadcaster_id: string; default_id: string | null }[]
  > => {
    const { rows } = await pool.query<{
      fixture_id: string;
      broadcaster_id: string;
      default_id: string | null;
    }>(
      `SELECT fixture_id, broadcaster_id, default_id FROM viewing_option
        WHERE fixture_id = ANY($1::uuid[]) ORDER BY fixture_id, broadcaster_id`,
      [Object.values(f)],
    );
    return rows;
  };

  const reapply = async (): Promise<number> => {
    const { rows } = await pool.query<{ created: number }>(
      `SELECT created FROM viewing_apply_defaults($1::uuid)`,
      [defaultId],
    );
    return rows[0]?.created ?? 0;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ViewingModule] })
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
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the viewing defaults test')`,
      [ids.get(editor)],
    );
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, $3, 'cup', 'international', 'men'), ($2, $4, 'cup', 'international', 'men')`,
      [competition, elsewhere, `Defaults Cup ${RUN}`, `Other Cup ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $4, '2026', '2026-01-01', '2026-12-31', true),
              ($2, $4, '2025', '2025-01-01', '2025-12-31', false),
              ($3, $5, '2026', '2026-01-01', '2026-12-31', true)`,
      [season, lastSeason, elsewhereSeason, competition, elsewhere],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status) VALUES
         ($1, $9, 'Round 1', now() + interval '1 day', 'scheduled'),
         ($2, $9, 'Round 2', now() + interval '2 days', 'scheduled'),
         ($3, $9, 'Round 1', now() - interval '1 hour', 'live'),
         ($4, $9, 'Round 0', now() - interval '2 days', 'finished'),
         ($5, $9, 'Round 0', now() - interval '5 hours', 'scheduled'),
         ($6, $9, 'Round 2', now() + interval '4 days', 'postponed'),
         ($7, $10, 'Round 9', now() + interval '26 hours', 'scheduled'),
         ($8, $11, 'Round 1', now() + interval '1 day', 'scheduled')`,
      [
        f.soon,
        f.later,
        f.live,
        f.played,
        f.stale,
        f.postponed,
        f.uncovered,
        f.otherCompetition,
        season,
        lastSeason,
        elsewhereSeason,
      ],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [teams[0], teams[1], `Home ${RUN}`, `Away ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [f.later, teams[0], teams[1]],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // The audit log is immutable by design; a test's own rows go with the triggers off.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [
        [ids.get(editor), ids.get(member)],
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    // Options and skips go with their fixtures; coverage goes with its seasons.
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [Object.values(f)]);
    await pool.query(`DELETE FROM viewing_default WHERE competition_id = ANY($1::uuid[])`, [
      [competition, elsewhere],
    ]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
      [season, lastSeason, elsewhereSeason],
    ]);
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
      [competition, elsewhere],
    ]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    if (broadcasters.length > 0) {
      await pool.query(`DELETE FROM broadcaster WHERE id = ANY($1::uuid[])`, [broadcasters]);
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`vd_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('refuses a guest and a member who is not an editor', async () => {
    const reads = ['/admin/viewing/defaults', `/admin/viewing/competitions?territory=${NL}`];
    for (const url of reads) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: as(member) })).statusCode).toBe(403);
    }
    const write = await app.inject({
      method: 'POST',
      url: '/admin/viewing/bulk-options',
      headers: as(member),
      payload: {
        territory: NL,
        broadcaster_id: randomUUID(),
        access: 'free',
        url: 'https://x.test',
        fixture_ids: [f.soon],
      },
    });
    expect(write.statusCode).toBe(403);
    const create = await app.inject({
      method: 'POST',
      url: '/admin/viewing/defaults',
      headers: as(member),
      payload: {},
    });
    expect(create.statusCode).toBe(403);
  });

  it('creates a default only on a covered season, and lists the covered upcoming matches of that competition only', async () => {
    const tv = await broadcaster('Default TV');
    const body = {
      competition_id: competition,
      territory: NL,
      broadcaster_id: tv,
      access: 'subscription',
      url: 'https://tv.test/live',
      note: `the published schedule ${RUN}`,
    };
    const early = await app.inject({
      method: 'POST',
      url: '/admin/viewing/defaults',
      headers: as(editor),
      payload: body,
    });
    expect(early.statusCode).toBe(400);
    expect(early.json<{ message: string }>().message).toMatch(/coverage/);
    const noNote = await app.inject({
      method: 'POST',
      url: '/admin/viewing/defaults',
      headers: as(editor),
      payload: { ...body, note: ' ' },
    });
    expect(noNote.statusCode).toBe(400);

    expect((await declare(season)).statusCode).toBe(204);
    expect((await declare(elsewhereSeason)).statusCode).toBe(204);
    const created = await app.inject({
      method: 'POST',
      url: '/admin/viewing/defaults',
      headers: as(editor),
      payload: body,
    });
    expect(created.statusCode).toBe(201);
    const answer = created.json<ViewingDefaultResponse>();
    defaultId = answer.default.id;
    // The two upcoming matches and the one under way; not the played, the stale, the
    // postponed, last season's (not covered) or the other competition's.
    expect(answer.applied).toBe(3);
    expect(answer.default).toMatchObject({
      competition: { id: competition, name: `Defaults Cup ${RUN}` },
      territory: NL,
      broadcaster: { id: tv },
      access: 'subscription',
      listings: 3,
    });
    expect((await listed()).map((r) => r.fixture_id).sort()).toEqual(
      [f.soon, f.later, f.live].sort(),
    );
    expect((await listed()).every((r) => r.default_id === defaultId)).toBe(true);

    const twice = await app.inject({
      method: 'POST',
      url: '/admin/viewing/defaults',
      headers: as(editor),
      payload: body,
    });
    expect(twice.statusCode).toBe(400);

    const viewing = await app.inject({
      method: 'GET',
      url: `/fixtures/${f.soon}/viewing?territory=${NL}`,
    });
    const match = viewing.json<MatchViewing>();
    expect(match.options.coverage).toBe('available');
    expect(match.options.data).toHaveLength(1);
    expect(match.options.data![0]!.from_default).toBe(true);

    const audit = await pool.query<{ next: { default_id: string; applied: number } }>(
      `SELECT next FROM audit_log
        WHERE actor_id = $1 AND action = 'viewing.default_set' AND target_id = $2`,
      [ids.get(editor), competition],
    );
    expect(audit.rows.map((r) => r.next)).toMatchObject([{ default_id: defaultId, applied: 3 }]);
  });

  it('adds nothing when applied again, and never re-creates a listing an editor removed', async () => {
    expect(await reapply()).toBe(0);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM viewing_option WHERE fixture_id = $1 AND default_id = $2`,
      [f.soon, defaultId],
    );
    const removed = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${f.soon}/viewing-options/${rows[0]!.id}/remove`,
      headers: as(editor),
      payload: { reason: 'this one is on another channel' },
    });
    expect(removed.statusCode).toBe(204);
    const skip = await pool.query(
      `SELECT reason FROM viewing_default_skip WHERE default_id = $1 AND fixture_id = $2`,
      [defaultId, f.soon],
    );
    expect(skip.rows).toEqual([{ reason: 'this one is on another channel' }]);
    expect(await reapply()).toBe(0);
    expect((await listed()).some((r) => r.fixture_id === f.soon)).toBe(false);
  });

  it('shows the desk the upcoming matches, their listings, the coverage and the defaults', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/admin/viewing/upcoming?competition=${competition}&territory=nl&days=3`,
      headers: as(editor),
    });
    expect(response.statusCode).toBe(200);
    const upcoming = response.json<ViewingUpcomingResponse>();
    expect(upcoming).toMatchObject({
      competition: { id: competition },
      territory: NL,
      days: 3,
      season: { id: season, label: '2026' },
      coverage: 'available',
    });
    expect(upcoming.defaults.map((d) => d.id)).toEqual([defaultId]);
    // From three hours ago: not the played match or the stale one.
    expect(upcoming.fixtures.map((x) => x.id)).toEqual([f.live, f.soon, f.uncovered, f.later]);
    const later = upcoming.fixtures.find((x) => x.id === f.later)!;
    expect(later.home).toEqual({ id: teams[0], name: `Home ${RUN}` });
    expect(later.away).toEqual({ id: teams[1], name: `Away ${RUN}` });
    expect(later.covered).toBe(true);
    expect(later.options.map((o) => o.from_default)).toEqual([true]);
    expect(upcoming.fixtures.find((x) => x.id === f.uncovered)!.covered).toBe(false);
    expect(upcoming.fixtures.find((x) => x.id === f.soon)!.options).toEqual([]);

    const wide = await app.inject({
      method: 'GET',
      url: `/admin/viewing/upcoming?competition=${competition}&territory=NL&days=22`,
      headers: as(editor),
    });
    expect(wide.statusCode).toBe(400);

    const competitions = await app.inject({
      method: 'GET',
      url: `/admin/viewing/competitions?territory=${NL}`,
      headers: as(editor),
    });
    const mine = competitions
      .json<ViewingCompetitionsResponse>()
      .competitions.find((c) => c.id === competition);
    expect(mine).toMatchObject({
      season: { id: season, label: '2026' },
      coverage: 'available',
      defaults: 1,
    });

    const defaults = await app.inject({
      method: 'GET',
      url: `/admin/viewing/defaults?competition=${competition}&territory=${NL}`,
      headers: as(editor),
    });
    expect(defaults.json<ViewingDefaultsResponse>().defaults).toMatchObject([
      { id: defaultId, listings: 2 },
    ]);
  });

  it('lists one service on many matches, reports those already listed, and refuses an uncovered match whole', async () => {
    const radio = await broadcaster('Bulk Radio');
    const bulk = (fixtureIds: string[]) =>
      app.inject({
        method: 'POST',
        url: '/admin/viewing/bulk-options',
        headers: as(editor),
        payload: {
          territory: NL,
          broadcaster_id: radio,
          access: 'free',
          url: 'https://radio.test/live',
          fixture_ids: fixtureIds,
        },
      });
    const first = await bulk([f.soon, f.later]);
    expect(first.statusCode).toBe(201);
    expect(first.json<ViewingBulkResponse>()).toEqual({ created: 2, skipped: [] });
    const again = await bulk([f.soon, f.later, f.live]);
    expect(again.json<ViewingBulkResponse>()).toEqual({ created: 1, skipped: [f.soon, f.later] });

    const refused = await bulk([f.played, f.uncovered]);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ message: string }>().message).toContain(f.uncovered);
    expect((await listed()).some((r) => r.fixture_id === f.played)).toBe(false);
    expect((await bulk([])).statusCode).toBe(400);

    const audits = await pool.query(
      `SELECT 1 FROM audit_log WHERE actor_id = $1 AND action = 'viewing.list'
          AND next->>'broadcaster_id' = $2`,
      [ids.get(editor), radio],
    );
    expect(audits.rowCount).toBe(3);
  });

  it('removing the default takes its future listings and keeps the one already under way', async () => {
    const removed = await app.inject({
      method: 'POST',
      url: `/admin/viewing/defaults/${defaultId}/remove`,
      headers: as(editor),
      payload: { reason: 'the rights moved' },
    });
    expect(removed.statusCode).toBe(204);
    const fromDefault = (await listed()).filter((r) => r.default_id === defaultId);
    expect(fromDefault.map((r) => r.fixture_id)).toEqual([f.live]);
    // Hand-entered and bulk listings are not the default's.
    expect((await listed()).filter((r) => r.default_id === null)).toHaveLength(3);
    expect(await reapply()).toBe(0);

    const again = await app.inject({
      method: 'POST',
      url: `/admin/viewing/defaults/${defaultId}/remove`,
      headers: as(editor),
      payload: { reason: 'twice' },
    });
    expect(again.statusCode).toBe(404);
    const audit = await pool.query<{ reason: string; next: { deleted_listings: number } }>(
      `SELECT reason, next FROM audit_log
        WHERE actor_id = $1 AND action = 'viewing.default_removed' AND target_id = $2`,
      [ids.get(editor), competition],
    );
    expect(audit.rows).toMatchObject([
      { reason: 'the rights moved', next: { deleted_listings: 1 } },
    ]);
  });
});
