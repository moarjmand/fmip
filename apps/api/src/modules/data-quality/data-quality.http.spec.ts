import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DataQualityReport } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { DataQualityModule } from './data-quality.module';
import { DataQualityService } from './data-quality.service';

// The checks against the real schema: every statement the sweep runs is valid
// SQL over the feed's tables, a problem is one row however many sweeps see
// it, and a problem that goes away is resolved rather than deleted.
//
// Every fixture here is in a competition and season of the spec's own, and
// every sweep is narrowed to that season. A sweep over every stored fixture
// would judge -- and write findings pointing at -- the fixtures other suites
// are creating and deleting at the same moment in CI's shared database: one
// deleted between the sweep's read and its write made the insert fail on its
// foreign key and took the whole sweep with it. The seeded season was shared
// too, with the standings job in ingestion-jobs.spec.ts, whose table
// comparison resolves that season's table findings.
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
/** A second season of the same competition, which no sweep here is narrowed to. */
const OTHER_SEASON = randomUUID();
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const UNITED = '00000000-0000-4000-8000-000000000601';
const MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';
const PEOPLE = [
  '00000000-0000-4000-8000-000000000701',
  '00000000-0000-4000-8000-000000000702',
  '00000000-0000-4000-8000-000000000703',
];

interface Row {
  check_kind: string;
  subject_key: string;
  fixture_id: string | null;
  related_fixture_id: string | null;
  team_id: string | null;
  competition_id: string | null;
  detail: string;
  first_seen_at: Date;
  last_seen_at: Date;
  resolved_at: Date | null;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('data-quality checks', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let dataQuality: DataQualityService;
  let admin = { id: '', cookie: '' };
  let member = { id: '', cookie: '' };

  async function register(username: string): Promise<{ id: string; cookie: string }> {
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: 'Data Quality Tester',
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    const id = (registered.json() as { user: { id: string } }).user.id;
    const header = registered.headers['set-cookie'];
    const raw = Array.isArray(header) ? header[0] : header;
    return { id, cookie: /^fmip_session=([^;]*)/.exec(raw ?? '')?.[1] ?? '' };
  }

  const get = (cookie?: string) =>
    app.inject({
      method: 'GET',
      url: '/admin/data-quality',
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
  const review = (id: number | string, reason: unknown, cookie = admin.cookie) =>
    app.inject({
      method: 'POST',
      url: `/admin/data-quality/${id}/review`,
      headers: { cookie: `fmip_session=${cookie}` },
      payload: { reason },
    });
  const fixtures: Record<string, string> = {};

  /** A fixture of this spec's season (or `season`), far from every other fixture of the same pair. */
  async function fixture(
    name: string,
    home: string,
    away: string,
    kickoff: string,
    status: string,
    season = SEASON,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO fixture (season_id, kickoff_at, status, round)
       VALUES ($1, $2::timestamptz, $3, $4) RETURNING id`,
      [season, kickoff, status, `dq-${RUN}`],
    );
    const id = rows[0]!.id;
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [id, home, away],
    );
    fixtures[name] = id;
    return id;
  }

  const mine = async (): Promise<Row[]> => {
    const ids = Object.values(fixtures);
    const { rows } = await pool.query<Row>(
      `SELECT * FROM data_quality_finding
        WHERE fixture_id = ANY($1::uuid[]) OR related_fixture_id = ANY($1::uuid[])
        ORDER BY check_kind, subject_key, id`,
      [ids],
    );
    return rows;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, DataQualityModule],
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
    dataQuality = app.get(DataQualityService);
    pool = new Pool({ connectionString: DATABASE_URL });
    admin = await register(`dq_${RUN}a`);
    member = await register(`dq_${RUN}m`);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'data-quality test')`,
      [admin.id],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender, age_group, tier)
       VALUES ($1, $2, $3, 'league', 'domestic', 'men', 'senior', 9)`,
      [COMPETITION, ENGLAND, `Data Quality League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $3, '2030/31', DATE '2030-08-01', DATE '2031-06-30', false),
              ($2, $3, '2031/32', DATE '2031-08-01', DATE '2032-06-30', false)`,
      [SEASON, OTHER_SEASON, COMPETITION],
    );

    // Kick-offs in 2031, ten days apart, so no two of these are one match
    // stored twice unless the test means them to be.
    await fixture('noScore', LIVERPOOL, UNITED, '2031-01-01T15:00:00Z', 'finished');
    const goals = await fixture('goals', UNITED, LIVERPOOL, '2031-01-11T15:00:00Z', 'finished');
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away)
       VALUES ($1, 'full_time', 1, 0), ($1, 'current', 1, 0)`,
      [goals],
    );
    await pool.query(
      `INSERT INTO incident (fixture_id, participant_id, person_id, kind, minute, sequence)
       SELECT $1, p.id, $2, 'yellow_card', 20, 1 FROM fixture_participant p
        WHERE p.fixture_id = $1 AND p.side = 'home'`,
      [goals, PEOPLE[0]],
    );
    await fixture(
      'overrun',
      MADRID,
      PERSEPOLIS,
      new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      'live',
    );
    const lineup = await fixture('lineup', LIVERPOOL, MADRID, '2031-01-21T15:00:00Z', 'finished');
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 0, 0)`,
      [lineup],
    );
    await pool.query(
      `INSERT INTO lineup (participant_id, person_id, role)
       SELECT p.id, person, 'starter' FROM fixture_participant p, unnest($2::uuid[]) AS person
        WHERE p.fixture_id = $1 AND p.side = 'home'`,
      [lineup, PEOPLE],
    );
    // One match stored twice: a postponed one and its rearrangement a day later.
    await fixture('first', PERSEPOLIS, UNITED, '2031-02-01T15:00:00Z', 'postponed');
    await fixture('second', PERSEPOLIS, UNITED, '2031-02-02T19:00:00Z', 'scheduled');
    // Finished with no score, but in the season no sweep here is narrowed to:
    // a narrowed sweep neither reads it nor names it.
    await fixture('outside', MADRID, LIVERPOOL, '2031-09-01T15:00:00Z', 'finished', OTHER_SEASON);
    // A fixture carrying two ids from one provider.
    await pool.query(
      `INSERT INTO provider_mapping (provider, external_id, entity_type, internal_id)
       VALUES ('api_football', $2, 'fixture', $1), ('api_football', $3, 'fixture', $1)`,
      [fixtures.first, `dq-${RUN}-a`, `dq-${RUN}-b`],
    );
  });

  afterAll(async () => {
    const accounts = [admin.id, member.id].filter((id) => id !== '');
    // Audit rows are immutable and hold their actor; they go first, alone.
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [accounts]);
    });
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [accounts]);
    await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [`dq-${RUN}-%`]);
    // Findings on a fixture or a season go with it (ON DELETE CASCADE).
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [Object.values(fixtures)]);
    await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [[SEASON, OTHER_SEASON]]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.end();
    await app.close();
  });

  it('a sweep names each problem once, on the fixture and in its competition', async () => {
    const outcome = await dataQuality.sweep(new Date(), SEASON);
    expect(outcome.opened).toBeGreaterThanOrEqual(6);
    const rows = await mine();
    expect(rows.map((r) => [r.check_kind, r.fixture_id, r.detail])).toEqual([
      [
        'duplicate_fixture',
        [fixtures.first, fixtures.second].sort()[0],
        'the same home and away teams twice within 3 days (postponed, then scheduled)',
      ],
      ['finished_without_score', fixtures.noScore, 'finished with no score stored at all'],
      ['fixture_mapped_twice', fixtures.first, '2 ids from api_football point at this fixture'],
      ['goals_disagree', fixtures.goals, 'the timeline has 0-0, the score is 1-0'],
      ['lineup_not_eleven', fixtures.lineup, 'the home line-up has 3 starters'],
      [
        'live_overrun',
        fixtures.overrun,
        'still live more than 4 hours after kick-off (no minute stored)',
      ],
    ]);
    expect(rows.every((r) => r.resolved_at === null && r.competition_id !== null)).toBe(true);
    expect(rows.find((r) => r.check_kind === 'duplicate_fixture')?.related_fixture_id).toBe(
      [fixtures.first, fixtures.second].sort()[1],
    );
    expect(rows.find((r) => r.check_kind === 'lineup_not_eleven')?.team_id).toBe(LIVERPOOL);
  });

  it('a sweep stamps every swept check as run, and not the table it did not compare', async () => {
    const { rows } = await pool.query<{ check_kind: string }>(
      `SELECT check_kind FROM data_quality_check_run WHERE checked_at >= now() - interval '1 hour'`,
    );
    expect(rows.map((r) => r.check_kind).sort()).toEqual(
      expect.arrayContaining([
        'duplicate_fixture',
        'finished_without_score',
        'fixture_mapped_twice',
        'goals_disagree',
        'lineup_not_eleven',
        'live_overrun',
      ]),
    );
  });

  it('a second sweep writes no second row, and moves last_seen_at on at most hourly', async () => {
    const before = await mine();
    await dataQuality.sweep(new Date(Date.now() + 5 * 60_000), SEASON);
    const soon = await mine();
    expect(soon.map((r) => r.subject_key)).toEqual(before.map((r) => r.subject_key));
    expect(soon.map((r) => r.last_seen_at)).toEqual(before.map((r) => r.last_seen_at));

    await dataQuality.sweep(new Date(Date.now() + 61 * 60_000), SEASON);
    const after = await mine();
    expect(after.map((r) => r.subject_key)).toEqual(before.map((r) => r.subject_key));
    for (const row of after) {
      const was = before.find((b) => b.subject_key === row.subject_key)!;
      expect(row.first_seen_at).toEqual(was.first_seen_at);
      expect(row.last_seen_at.getTime()).toBeGreaterThan(was.last_seen_at.getTime());
    }
  });

  it('a problem that goes away is resolved, not deleted, and nothing was corrected for it', async () => {
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 2, 2)`,
      [fixtures.noScore],
    );
    const outcome = await dataQuality.sweep(new Date(Date.now() + 70 * 60_000), SEASON);
    expect(outcome.resolved).toBeGreaterThanOrEqual(1);
    const rows = await mine();
    const noScore = rows.filter((r) => r.fixture_id === fixtures.noScore);
    expect(noScore).toHaveLength(1);
    expect(noScore[0]?.resolved_at).not.toBeNull();
    // The rest are still open, and the live match is still live: a check never writes the feed.
    expect(rows.filter((r) => r.resolved_at === null)).toHaveLength(5);
    const { rows: live } = await pool.query<{ status: string }>(
      `SELECT status FROM fixture WHERE id = $1`,
      [fixtures.overrun],
    );
    expect(live[0]?.status).toBe('live');
  });

  it('the same subject found again after it was resolved is a new row', async () => {
    await pool.query(`DELETE FROM fixture_score WHERE fixture_id = $1`, [fixtures.noScore]);
    await dataQuality.sweep(new Date(Date.now() + 75 * 60_000), SEASON);
    const noScore = (await mine()).filter((r) => r.fixture_id === fixtures.noScore);
    expect(noScore.map((r) => r.resolved_at === null)).toEqual([false, true]);
  });

  it("the standings job's comparison is findings for that season, resolved by the next agreeing one", async () => {
    const now = new Date();
    const first = await dataQuality.recordTable(
      SEASON,
      [
        { teamId: UNITED, providerPlayed: 5, ourPlayed: 4 },
        { teamId: LIVERPOOL, providerPlayed: 5, ourPlayed: 5 },
      ],
      1,
      now,
    );
    expect(first).toMatchObject({ opened: 2, resolved: 0 });
    const open = async () =>
      (
        await pool.query<Row>(
          `SELECT * FROM data_quality_finding
            WHERE check_kind = 'table_disagrees' AND season_id = $1 AND resolved_at IS NULL
            ORDER BY subject_key`,
          [SEASON],
        )
      ).rows;
    expect((await open()).map((r) => [r.team_id, r.detail])).toEqual([
      [UNITED, "the provider's table has 5 played, ours 4"],
      [null, "1 team in the provider's table has no mapping"],
    ]);
    // A sweep does not touch the table's findings: it did not compare tables.
    await dataQuality.sweep(new Date(now.getTime() + 60_000), SEASON);
    expect(await open()).toHaveLength(2);
    const second = await dataQuality.recordTable(
      SEASON,
      [{ teamId: UNITED, providerPlayed: 5, ourPlayed: 5 }],
      0,
      new Date(now.getTime() + 120_000),
    );
    expect(second).toMatchObject({ opened: 0, resolved: 2 });
    expect(await open()).toEqual([]);
  });

  it('the page is closed to guests and to members without the admin role', async () => {
    expect((await get()).statusCode).toBe(401);
    expect((await get(member.cookie)).statusCode).toBe(403);
    expect((await review(1, 'x', member.cookie)).statusCode).toBe(403);
  });

  it('lists open findings with our names and links, per competition, and when each check ran', async () => {
    const response = await get(admin.cookie);
    expect(response.statusCode).toBe(200);
    const report = response.json() as DataQualityReport;
    const goals = report.findings.find((f) => f.fixture?.id === fixtures.goals);
    expect(goals).toMatchObject({
      check: 'goals_disagree',
      detail: 'the timeline has 0-0, the score is 1-0',
      fixture: {
        id: fixtures.goals,
        home: 'Manchester United',
        away: 'Liverpool',
        kickoff_at: '2031-01-11T15:00:00.000Z',
        status: 'finished',
      },
      season: { id: SEASON },
      reviewed: null,
    });
    expect(goals?.competition?.name).toEqual(expect.any(String));
    const pair = report.findings.find(
      (f) =>
        f.check === 'duplicate_fixture' &&
        [fixtures.first, fixtures.second].includes(f.fixture?.id ?? ''),
    );
    expect(pair?.related_fixture?.home).toBe('Persepolis');
    expect(
      report.findings.find(
        (f) => f.check === 'lineup_not_eleven' && f.fixture?.id === fixtures.lineup,
      )?.team?.name,
    ).toBe('Liverpool');
    expect(report.checks.find((c) => c.check === 'goals_disagree')).toMatchObject({
      freshness: 'current',
    });
    const count = report.counts.find(
      (c) => c.check === 'goals_disagree' && c.competition?.id === goals?.competition?.id,
    );
    expect(count?.open).toBeGreaterThanOrEqual(1);
    expect(report.open_total).toBeGreaterThanOrEqual(6);
    expect(report.resolved_last_day).toBeGreaterThanOrEqual(1);
    // Rule 2: no provider id reaches the page.
    expect(response.body).not.toContain(`dq-${RUN}-`);
  });

  it('a finding is reviewed once, with a reason and an audit row; it stays open, and the watchdog stops counting it', async () => {
    const report = (await get(admin.cookie)).json() as DataQualityReport;
    const overrun = report.findings.find((f) => f.fixture?.id === fixtures.overrun)!;
    const later = new Date(Date.now() + 20 * 60_000);
    const before = await dataQuality.liveContradictions(later);
    expect(before.open).toBeGreaterThanOrEqual(1);

    expect((await review(overrun.id, '  ')).statusCode).toBe(400);
    expect((await review('abc', 'why')).statusCode).toBe(400);
    const why = 'The provider has not closed it; asked them.';
    expect((await review(overrun.id, why)).statusCode).toBe(200);
    expect((await review(overrun.id, 'again')).statusCode).toBe(409);
    expect((await review(9_000_000_000, 'none such')).statusCode).toBe(404);

    const { rows: audit } = await pool.query<{ action: string; reason: string; target_id: string }>(
      `SELECT action, reason, target_id FROM audit_log WHERE actor_id = $1`,
      [admin.id],
    );
    expect(audit).toEqual([
      { action: 'data_quality.review', reason: why, target_id: String(overrun.id) },
    ]);
    const after = (await get(admin.cookie)).json() as DataQualityReport;
    const reviewed = after.findings.find((f) => f.id === overrun.id);
    expect(reviewed?.reviewed).toMatchObject({ by: `dq_${RUN}a`, reason: why });
    expect((await dataQuality.liveContradictions(later)).open).toBe(before.open - 1);
  });
});
