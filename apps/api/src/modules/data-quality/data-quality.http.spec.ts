import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { DataQualityModule } from './data-quality.module';
import { DataQualityService } from './data-quality.service';

// The checks against the real schema: every statement the sweep runs is valid
// SQL over the feed's tables, a problem is one row however many sweeps see
// it, and a problem that goes away is resolved rather than deleted.
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SEASON = '00000000-0000-4000-8000-000000000301';
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
  const fixtures: Record<string, string> = {};

  /** A fixture of the seeded season, far from every other fixture of the same pair. */
  async function fixture(
    name: string,
    home: string,
    away: string,
    kickoff: string,
    status: string,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO fixture (season_id, kickoff_at, status, round)
       VALUES ($1, $2::timestamptz, $3, $4) RETURNING id`,
      [SEASON, kickoff, status, `dq-${RUN}`],
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
      .useValue({ ...DEFAULT_IDENTITY_OPTIONS, sessionSecret: 'test-secret-'.repeat(4) })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    dataQuality = app.get(DataQualityService);
    pool = new Pool({ connectionString: DATABASE_URL });

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
    // A fixture carrying two ids from one provider.
    await pool.query(
      `INSERT INTO provider_mapping (provider, external_id, entity_type, internal_id)
       VALUES ('api_football', $2, 'fixture', $1), ('api_football', $3, 'fixture', $1)`,
      [fixtures.first, `dq-${RUN}-a`, `dq-${RUN}-b`],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [`dq-${RUN}-%`]);
    // Findings on a fixture go with it (ON DELETE CASCADE).
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [Object.values(fixtures)]);
    await pool.query(`DELETE FROM data_quality_finding WHERE subject_key LIKE $1`, [`${SEASON}:%`]);
    await pool.end();
    await app.close();
  });

  it('a sweep names each problem once, on the fixture and in its competition', async () => {
    const outcome = await dataQuality.sweep(new Date());
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

  it('a second sweep writes no second row: it moves last_seen_at on', async () => {
    const before = await mine();
    const later = new Date(Date.now() + 5 * 60_000);
    await dataQuality.sweep(later);
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
    const outcome = await dataQuality.sweep(new Date(Date.now() + 10 * 60_000));
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
    await dataQuality.sweep(new Date(Date.now() + 15 * 60_000));
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
    await dataQuality.sweep(new Date(now.getTime() + 60_000));
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
});
