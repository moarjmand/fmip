import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CoverageService } from './coverage.service';
import { IngestionJobsService } from './ingestion-jobs.service';
import { IngestionModule } from './ingestion.module';

// The scheduled jobs against the real schema, on the replay source (D-049):
// the real API-Football adapter, its committed recordings, the real entity
// resolver and the real writers, with no key and no network.
//
// The acceptance criterion for T-026 is "jobs are idempotent; a replay changes
// nothing", and that is what the second run of every job asserts: itemsWritten
// must be zero, because every upsert carries a WHERE ... IS DISTINCT FROM.
const DATABASE_URL = process.env.DATABASE_URL;

// The recordings are the 2023/24 Premier League opening weekend. Burnley v
// Manchester City (fixture 1035037) is the one with a lineup and a detail.
const SEASON_LABEL = '2023/24';
const KICKOFF = '2023-08-11T19:00:00Z';
const AFTER_KICKOFF = new Date('2023-08-11T20:00:00Z');

const SEASON = randomUUID();
const STAGE = randomUUID();
const VENUE = randomUUID();
const BURNLEY = randomUUID();
const CITY = randomUUID();
const HAALAND = randomUUID();
const RODRI = randomUUID();
const DE_BRUYNE = randomUUID();

/** The provider ids in the recordings, and the rows we map them to. */
const TEAM_IDS: [string, string][] = [
  ['44', BURNLEY],
  ['50', CITY],
];
const PERSON_IDS: [string, string][] = [
  ['1100', HAALAND],
  ['44', RODRI],
  ['629', DE_BRUYNE],
];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('ingestion jobs', () => {
  let pool: Pool;
  let jobs: IngestionJobsService;
  let coverage: CoverageService;
  let close: () => Promise<void>;
  let competitionId: string;
  const mappings: string[] = [];
  const startedAt = new Date();

  beforeAll(async () => {
    process.env.INGESTION_SOURCE = 'replay';
    delete process.env.INGESTION_SCHEDULE;

    pool = new Pool({ connectionString: DATABASE_URL });

    // The seed maps API-Football's league 39 to the Premier League row; the
    // recordings are for that league, so the job polls what the seed declared.
    const { rows } = await pool.query<{ internal_id: string }>(
      `SELECT internal_id FROM provider_mapping
        WHERE provider = 'api_football' AND entity_type = 'competition' AND external_id = '39'`,
    );
    competitionId = rows[0]?.internal_id ?? '';
    expect(competitionId, 'the development seed must be loaded').not.toBe('');

    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, $3, '2023-08-11', '2024-05-19', false)`,
      [SEASON, competitionId, SEASON_LABEL],
    );
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order)
       VALUES ($1, $2, 'Regular Season', 'league', 1)`,
      [STAGE, SEASON],
    );
    await pool.query(`INSERT INTO venue (id, name, city) VALUES ($1, 'Turf Moor', 'Burnley')`, [
      VENUE,
    ]);
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Burnley', 'club', 'men'),
                                                       ($2, 'Manchester City', 'club', 'men')`,
      [BURNLEY, CITY],
    );
    await pool.query(
      `INSERT INTO person (id, full_name) VALUES ($1, 'Erling Haaland'), ($2, 'Rodri'), ($3, 'Kevin De Bruyne')`,
      [HAALAND, RODRI, DE_BRUYNE],
    );

    const map = async (
      entityType: string,
      externalId: string,
      internalId: string,
    ): Promise<void> => {
      const id = randomUUID();
      mappings.push(id);
      await pool.query(
        `INSERT INTO provider_mapping (id, provider, entity_type, external_id, internal_id)
         VALUES ($1, 'api_football', $2, $3, $4)`,
        [id, entityType, externalId, internalId],
      );
    };
    await map('venue', '512', VENUE);
    for (const [externalId, internalId] of TEAM_IDS) await map('team', externalId, internalId);
    for (const [externalId, internalId] of PERSON_IDS) await map('person', externalId, internalId);

    // No HTTP surface here: the jobs are driven directly. `init()` still runs
    // the lifecycle hooks, which is how the scheduler proves it stays off.
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IngestionModule],
    }).compile();
    await moduleRef.init();
    jobs = moduleRef.get(IngestionJobsService);
    coverage = moduleRef.get(CoverageService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM coverage_profile WHERE season_id = $1`, [SEASON]);
    await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [SEASON]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE id = ANY($1::uuid[])
          OR (provider = 'api_football' AND entity_type = 'fixture')`,
      [mappings],
    );
    // Everything this run queued, and nothing else: `ingestion.spec.ts` runs in
    // another worker against the same database and owns the id 9999.
    await pool.query(
      `DELETE FROM unresolved_entity
        WHERE provider = 'api_football' AND external_id <> '9999' AND first_seen_at >= $1`,
      [startedAt],
    );
    await pool.query(`DELETE FROM ingest_run WHERE provider = 'api_football'`);
    await pool.query(`DELETE FROM stage WHERE id = $1`, [STAGE]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
      [HAALAND, RODRI, DE_BRUYNE],
    ]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[BURNLEY, CITY]]);
    await pool.query(`DELETE FROM venue WHERE id = $1`, [VENUE]);
    await pool.end();
    await close?.();
  });

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }

  it('writes the fixtures it can resolve, queues the ids it cannot, and writes nothing twice', async () => {
    const first = await jobs.fixtures();
    expect(first.provider).toBe('api_football');
    expect(first.itemsSeen).toBe(10);
    expect(first.itemsWritten).toBeGreaterThan(0);
    // Only Burnley v Manchester City has both teams mapped. The other nine are
    // not invented: their provider ids go to the review queue and are named.
    expect(first.partial).toContain('have no mapping and are queued for review');

    const fixtures = await count(`SELECT count(*)::text AS n FROM fixture WHERE season_id = $1`, [
      SEASON,
    ]);
    expect(fixtures).toBe(1);

    const { rows } = await pool.query<{
      id: string;
      status: string;
      kickoff_at: Date;
      round: string;
      stage_id: string;
      venue_id: string;
    }>(
      `SELECT id, status, kickoff_at, round, stage_id, venue_id FROM fixture WHERE season_id = $1`,
      [SEASON],
    );
    expect(rows[0]).toMatchObject({ status: 'finished', stage_id: STAGE, venue_id: VENUE });
    expect(rows[0]?.kickoff_at.toISOString()).toBe(new Date(KICKOFF).toISOString());

    expect(
      await count(`SELECT count(*)::text AS n FROM fixture_participant WHERE fixture_id = $1`, [
        rows[0]?.id,
      ]),
    ).toBe(2);
    const scores = await pool.query<{ kind: string; home: number; away: number }>(
      `SELECT kind, home, away FROM fixture_score WHERE fixture_id = $1 ORDER BY kind`,
      [rows[0]?.id],
    );
    expect(scores.rows).toEqual(expect.arrayContaining([{ kind: 'full_time', home: 0, away: 3 }]));

    // The mapping for the new fixture exists, so the next run recognises it.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM provider_mapping
          WHERE provider = 'api_football' AND entity_type = 'fixture' AND external_id = '1035037'`,
      ),
    ).toBe(1);

    // The acceptance criterion: the same recording, replayed, changes nothing.
    const second = await jobs.fixtures();
    expect(second.itemsSeen).toBe(10);
    expect(second.itemsWritten).toBe(0);
    expect(
      await count(`SELECT count(*)::text AS n FROM fixture WHERE season_id = $1`, [SEASON]),
    ).toBe(1);
  });

  it('writes incidents, statistics, periods and the formation after the whistle, once', async () => {
    const first = await jobs.postMatch(AFTER_KICKOFF);
    expect(first.itemsSeen).toBe(1);
    expect(first.itemsWritten).toBeGreaterThan(0);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM fixture WHERE season_id = $1`,
      [SEASON],
    );
    const fixtureId = rows[0]?.id;

    // Haaland's opener is there, credited to Manchester City, with Rodri's assist.
    const goals = await pool.query<{ minute: number; kind: string }>(
      `SELECT i.minute, i.kind FROM incident i WHERE i.fixture_id = $1 AND i.person_id = $2`,
      [fixtureId, HAALAND],
    );
    expect(goals.rows.length).toBeGreaterThan(0);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM incident WHERE fixture_id = $1 AND related_person_id = $2`,
        [fixtureId, RODRI],
      ),
    ).toBe(1);

    expect(
      await count(`SELECT count(*)::text AS n FROM fixture_period WHERE fixture_id = $1`, [
        fixtureId,
      ]),
    ).toBe(2);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM fixture_stat s
           JOIN fixture_participant p ON p.id = s.participant_id
          WHERE p.fixture_id = $1`,
        [fixtureId],
      ),
    ).toBeGreaterThan(0);

    const formations = await pool.query<{ formation: string | null }>(
      `SELECT formation FROM fixture_participant WHERE fixture_id = $1 ORDER BY side`,
      [fixtureId],
    );
    expect(formations.rows.every((r) => r.formation !== null)).toBe(true);

    // Players we have never identified are not written as blanks: only the three
    // mapped people appear in the line-up.
    expect(
      await count(
        `SELECT count(*)::text AS n FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
          WHERE p.fixture_id = $1`,
        [fixtureId],
      ),
    ).toBe(PERSON_IDS.length);

    const second = await jobs.postMatch(AFTER_KICKOFF);
    expect(second.itemsSeen).toBe(1);
    expect(second.itemsWritten).toBe(0);
  });

  it('records a coverage state for every module, computed from what arrived (T-027)', async () => {
    const { rows } = await pool.query<{ module: string; state: string; provider: string | null }>(
      `SELECT module, state, provider FROM coverage_profile WHERE season_id = $1 ORDER BY module`,
      [SEASON],
    );
    // Every module the contract names has a row: a module with no row is
    // unknown coverage, and unknown is what rule 3 will not have.
    expect(rows.map((r) => r.module)).toEqual([
      'advanced_statistics',
      'availability',
      'incidents',
      'lineups',
      'scores',
      'standings',
      'statistics',
    ]);

    const state = new Map(rows.map((r) => [r.module, r.state]));
    // One finished fixture, and the post-match job filled it, so the modules it
    // covers are complete for this season.
    expect(state.get('scores')).toBe('available');
    expect(state.get('incidents')).toBe('available');
    expect(state.get('lineups')).toBe('available');
    expect(state.get('statistics')).toBe('available');
    expect(state.get('standings')).toBe('available');
    // Nothing supplies where to watch, and the profile says so rather than
    // leaving an empty module to look populated.
    expect(state.get('availability')).toBe('not_supplied');

    // Supplied data names where it came from; an absence names nobody.
    const byModule = new Map(rows.map((r) => [r.module, r.provider]));
    expect(byModule.get('scores')).toBe('api_football');
    expect(byModule.get('availability')).toBeNull();

    const notes = await pool.query<{ note: string }>(
      `SELECT note FROM coverage_profile WHERE season_id = $1 AND module = 'scores'`,
      [SEASON],
    );
    expect(notes.rows[0]?.note).toContain('fixtures');

    // Freshness comes from the rows themselves, not from a job's clock, so a
    // poll that found nothing cannot make a match look fresh.
    const freshness = await coverage.freshness(SEASON);
    expect(freshness.scores).toBeTypeOf('string');
    expect(freshness.lineups).toBeTypeOf('string');
    expect(freshness.standings).toBe(freshness.scores);
    expect(freshness.availability).toBeUndefined();

    // And recomputing changes nothing, like every other writer here.
    expect((await coverage.recompute(SEASON)).changed).toBe(0);
  });

  it('asks about live matches by id, so a match nobody follows costs nothing', async () => {
    // The recording is "everything live right now" on the day it was made, and
    // none of those matches is ours; the adapter filters to the ids we asked for.
    const report = await jobs.live(AFTER_KICKOFF);
    expect(report.itemsSeen).toBe(0);
    expect(report.itemsWritten).toBe(0);
  });

  it('reads the provider table as a check on ours and names what is behind', async () => {
    const report = await jobs.run('standings');
    expect(report.itemsWritten).toBe(0);
    expect(report.itemsSeen).toBeGreaterThan(0);
    // We hold one match of a 38-match season, so every count disagrees, and the
    // two clubs we have identified are the ones it can say it about by name.
    // Teams nobody has mapped are counted rather than dropped — the same gap
    // from the other end. A silent gap is what this job exists to prevent.
    expect(report.partial).toContain('Manchester City: provider 38 played');
    expect(report.partial).toContain("teams in the provider's table have no mapping");
  });

  it('records every run in ingest_run, so a failure is visible without SSH', async () => {
    const { rows } = await pool.query<{ job: string; status: string }>(
      `SELECT job, status FROM ingest_run WHERE provider = 'api_football' ORDER BY started_at`,
    );
    const byJob = new Set(rows.map((r) => r.job));
    expect([...byJob].sort()).toEqual(['fixtures', 'live', 'post_match', 'standings']);
    expect(rows.every((r) => r.status !== 'running')).toBe(true);
  });
});
