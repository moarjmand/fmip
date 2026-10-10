import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { EvaluationService } from './evaluation.service';
import { ForecastTriggersService } from './forecast-triggers.service';
import { MODEL_CLIENT, ForecastService } from './forecast.service';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { PostgresForecastStore } from './internal/forecast-store';
import { ModelClient } from './internal/model-client';
import { PowerIndexService } from './power-index.service';
import { withTriggersOff } from '../../testing/cleanup';

// The triggers against the real schema (T-120). The acceptance criterion is
// "each kind is produced once per fixture and named", so the test runs the
// triggers repeatedly and counts rows: the second run of an unchanged fixture
// must write nothing, and a line-up arriving must produce exactly one more.
//
// The model is deliberately unreachable here. An unavailable forecast is still
// a version — that is T-064's whole point — and it makes the test a statement
// about the triggers rather than about the model service being up.
const DATABASE_URL = process.env.DATABASE_URL;

const COUNTRY = '00000000-0000-4000-8000-000000000101';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FIXTURE = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();
const PLAYER = randomUUID();

const NOW = new Date('2026-01-05T12:00:00Z');
const KICKOFF = new Date('2026-01-07T15:00:00Z');

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'producing forecast versions when they are due',
  () => {
    let pool: Pool;
    let triggers: ForecastTriggersService;
    let close: () => Promise<void>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, 'Trigger Test League', 'league', 'domestic', 'men')`,
        [COMPETITION, COUNTRY],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', '2025-08-01', '2026-05-30', false)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Iota', 'club', 'men'), ($2, 'Kappa', 'club', 'men')`,
        [HOME, AWAY],
      );
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, 'A Player')`, [PLAYER]);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [FIXTURE, SEASON, KICKOFF],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [FIXTURE, HOME, AWAY],
      );

      const unreachable = new ModelClient({
        baseUrl: 'http://model.not-configured.invalid',
        fetchImpl: () => Promise.reject(new Error('no model service in this test')),
      });
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule],
        providers: [
          ForecastTriggersService,
          ForecastService,
          PostgresForecastStore,
          PowerIndexService,
          EvaluationService,
          PostgresEvaluationStore,
          { provide: MODEL_CLIENT, useValue: unreachable },
        ],
      }).compile();
      await moduleRef.init();
      triggers = moduleRef.get(ForecastTriggersService);
      close = () => moduleRef.close();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // All three tables are immutable, so all three deletes go in one block:
      // the setting is the session's, not the table's, so there is nothing to
      // turn off per table.
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM power_index WHERE participant_id IN
             (SELECT id FROM fixture_participant WHERE fixture_id = $1)`,
          [FIXTURE],
        );
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [FIXTURE]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [FIXTURE]);
      });
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [FIXTURE]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM person WHERE id = $1`, [PLAYER]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
      await pool.end();
      await close?.();
    });

    async function kinds(): Promise<string[]> {
      const { rows } = await pool.query<{ kind: string }>(
        `SELECT s.kind FROM forecast f
           JOIN input_snapshot s ON s.id = f.input_snapshot_id
          WHERE f.fixture_id = $1
          ORDER BY f.version_number`,
        [FIXTURE],
      );
      return rows.map((row) => row.kind);
    }

    it('produces the early version once, and nothing on a second pass', async () => {
      const first = await triggers.runDue(NOW);
      expect(first.considered).toBeGreaterThan(0);
      expect(first.computed.early).toBe(1);
      expect(await kinds()).toEqual(['early']);

      const second = await triggers.runDue(NOW);
      expect(second.computed.early ?? 0).toBe(0);
      expect(await kinds()).toEqual(['early']);
      // And it says why it did nothing, rather than being silently idle.
      expect(Object.keys(second.skipped).join(' ')).toContain('early version is recorded');
    });

    it('produces the confirmed version when a line-up arrives, and only then', async () => {
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number)
         VALUES ((SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'),
                 $2, 'starter', 9)`,
        [FIXTURE, PLAYER],
      );

      const third = await triggers.runDue(NOW);
      expect(third.computed.lineups_confirmed).toBe(1);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);

      const fourth = await triggers.runDue(NOW);
      expect(fourth.computed.lineups_confirmed ?? 0).toBe(0);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);
    });

    it('scores nothing while the fixture is unfinished, and never an unavailable version', async () => {
      // Only unavailable versions exist here (the model is unreachable), so
      // even once the match is finished there is nothing to score.
      expect(await triggers.evaluateFinished(NOW)).toEqual({ fixtures: 0, added: 0 });
      await pool.query(`UPDATE fixture SET status = 'finished' WHERE id = $1`, [FIXTURE]);
      const later = new Date(KICKOFF.getTime() + 3 * 60 * 60 * 1000);
      expect(await triggers.evaluateFinished(later)).toEqual({ fixtures: 0, added: 0 });
      await pool.query(`UPDATE fixture SET status = 'scheduled' WHERE id = $1`, [FIXTURE]);
    });

    it('stops once kick-off has passed, rather than adding a version to a live match', async () => {
      const afterKickoff = new Date(KICKOFF.getTime() + 60 * 1000);
      const report = await triggers.runDue(afterKickoff);
      expect(Object.values(report.computed).reduce((sum, n) => sum + n, 0)).toBe(0);
      expect(await kinds()).toEqual(['early', 'lineups_confirmed']);
    });
  },
);

// T-1373, D-191: a new published model version. A fixture inside the window
// whose early version was made by the replaced version gets one more, from the
// new one, as a new row; the old row is untouched (rule 5), and a second pass
// writes nothing. A date of its own, far from every other spec's fixtures, so
// the answering model below forecasts nothing else.
const PROMOTION_NOW = new Date('2031-03-10T12:00:00Z');
const PROMOTION_KICKOFF = new Date('2031-03-12T15:00:00Z');
const REPLACED = 'dixon-coles-elo@0.1.0';
const PUBLISHED = 'dixon-coles-elo@0.6.0';
const ANSWER = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', 'model', 'contract', 'forecast-response.example.json'),
    'utf8',
  ),
) as { inputs: Record<string, unknown> } & Record<string, unknown>;

/**
 * A model service that publishes `published` and answers every question with
 * it, at `clock()`, fitted on the results up to the day before (as the model
 * service does for a match after today).
 */
function answering(published: string, clock: () => Date = () => PROMOTION_NOW): ModelClient {
  return new ModelClient({
    baseUrl: 'http://model.test',
    fetchImpl: (input, init) => {
      const url = String(input);
      if (url.endsWith('/health')) {
        return Promise.resolve(
          Response.json({
            status: 'ok',
            service: 'model',
            model_version: published,
            checked_at: PROMOTION_NOW.toISOString(),
          }),
        );
      }
      if (url.endsWith('/candidates')) return Promise.resolve(Response.json({ candidates: [] }));
      const asked = JSON.parse(String(init?.body)) as { fixture_id: string };
      const at = clock();
      const fitDate = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return Promise.resolve(
        Response.json({
          ...ANSWER,
          fixture_id: asked.fixture_id,
          computed_at: at.toISOString(),
          inputs: { ...ANSWER.inputs, model_version: published, fit_date: fitDate },
        }),
      );
    },
  });
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a new published model version (T-1373)',
  () => {
    const competition = randomUUID();
    const season = randomUUID();
    const fixture = randomUUID();
    const home = randomUUID();
    const away = randomUUID();
    // A European cup's match (D-191): before it, published as
    // `cross_competition` without the model being asked.
    const cup = randomUUID();
    const cupSeason = randomUUID();
    const cupFixture = randomUUID();
    let pool: Pool;
    let triggers: ForecastTriggersService;
    let close: () => Promise<void>;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, football_data_division)
         VALUES ($1, $2, 'Promotion Test League', 'league', 'domestic', 'men', 'Y8')`,
        [competition, COUNTRY],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2030/31', '2030-08-01', '2031-05-30', false)`,
        [season, competition],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'Lambda', 'club', 'men'), ($2, 'Mu', 'club', 'men')`,
        [home, away],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [fixture, season, PROMOTION_KICKOFF],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [fixture, home, away],
      );
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, 'Promotion Test Cup', 'cup', 'continental', 'men')`,
        [cup],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2030/31', '2030-08-01', '2031-05-30', false)`,
        [cupSeason, cup],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [cupFixture, cupSeason, PROMOTION_KICKOFF],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [cupFixture, away, home],
      );

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule],
        providers: [
          ForecastTriggersService,
          ForecastService,
          PostgresForecastStore,
          PowerIndexService,
          EvaluationService,
          PostgresEvaluationStore,
          { provide: MODEL_CLIENT, useValue: answering(PUBLISHED) },
        ],
      }).compile();
      await moduleRef.init();
      triggers = moduleRef.get(ForecastTriggersService);
      close = () => moduleRef.close();

      // The early version the replaced model made a day before the promotion.
      await moduleRef.get(PostgresForecastStore).record({
        fixtureId: fixture,
        kind: 'early',
        modelId: REPLACED,
        request: {
          fixture_id: fixture,
          home_team_id: home,
          away_team_id: away,
          division: 'Y8',
          kickoff_at: PROMOTION_KICKOFF.toISOString(),
        },
        computedAt: new Date(PROMOTION_NOW.getTime() - 24 * 60 * 60 * 1000),
        available: {
          probabilities: { home: 0.25, draw: 0.55, away: 0.2 },
          expectedGoals: { home: 0.5, away: 0.3 },
          mostLikely: [{ home: 0, away: 0, probability: 0.45 }],
          leadingFactors: [],
          inputs: {
            model_version: REPLACED,
            fit_date: '2031-03-08',
            matches_used: 200,
            elo_used: false,
            history_from: '2030-02-01',
            data_completeness: 'limited',
          },
        },
        unavailable: null,
      });
      await moduleRef.get(PostgresForecastStore).record({
        fixtureId: cupFixture,
        kind: 'early',
        modelId: 'none@0.0.0',
        request: {
          fixture_id: cupFixture,
          home_team_id: away,
          away_team_id: home,
          division: '',
          kickoff_at: PROMOTION_KICKOFF.toISOString(),
        },
        computedAt: new Date(PROMOTION_NOW.getTime() - 24 * 60 * 60 * 1000),
        available: null,
        unavailable: { reason: 'cross_competition', detail: 'clubs of different leagues' },
      });
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await withTriggersOff(pool, async (client) => {
        const both = [[fixture, cupFixture]];
        await client.query(
          `DELETE FROM power_index WHERE participant_id IN
             (SELECT id FROM fixture_participant WHERE fixture_id = ANY($1::uuid[]))`,
          both,
        );
        await client.query(`DELETE FROM forecast WHERE fixture_id = ANY($1::uuid[])`, both);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = ANY($1::uuid[])`, both);
      });
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[fixture, cupFixture]]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [[season, cupSeason]]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[competition, cup]]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[home, away]]);
      await pool.end();
      await close?.();
    });

    async function published(id = fixture): Promise<
      {
        version_number: number;
        kind: string;
        model_id: string;
        p_draw: string | null;
        division: string;
        reason: string | null;
      }[]
    > {
      const { rows } = await pool.query<{
        version_number: number;
        kind: string;
        model_id: string;
        p_draw: string | null;
        division: string;
        reason: string | null;
      }>(
        `SELECT f.version_number, s.kind, m.model_id, f.p_draw::text AS p_draw,
                s.request->>'division' AS division, f.unavailable_reason AS reason
           FROM forecast f
           JOIN input_snapshot s ON s.id = f.input_snapshot_id
           JOIN model_version m ON m.id = f.model_version_id
          WHERE f.fixture_id = $1 AND f.role = 'published'
          ORDER BY f.version_number`,
        [id],
      );
      return rows;
    }

    it('writes one new early version from the new model and keeps the old one as it was', async () => {
      const report = await triggers.runDue(PROMOTION_NOW);
      expect(report.published_model).toBe(PUBLISHED);
      expect(report.computed.early).toBe(2);
      expect(report.replaced).toEqual({ [REPLACED]: 1, 'none@0.0.0': 1 });

      const rows = await published();
      expect(rows.map((r) => [r.version_number, r.kind, r.model_id])).toEqual([
        [1, 'early', REPLACED],
        [2, 'early', PUBLISHED],
      ]);
      expect(Number(rows[0]?.p_draw)).toBeCloseTo(0.55, 4);
    });

    it('asks the published version about the cup match on the scale across leagues, once', async () => {
      const rows = await published(cupFixture);
      expect(rows.map((r) => [r.version_number, r.model_id, r.division, r.reason])).toEqual([
        [1, 'none@0.0.0', '', 'cross_competition'],
        [2, PUBLISHED, 'XL', null],
      ]);
    });

    it('writes nothing on the next pass: the newest version is the published one', async () => {
      const again = await triggers.runDue(PROMOTION_NOW);
      expect(again.computed.early ?? 0).toBe(0);
      expect(again.replaced).toEqual({});
      expect((await published()).length).toBe(2);
      expect((await published(cupFixture)).length).toBe(2);
    });
  },
);

// T-1377, D-195: newer results. A fixture whose early version was fitted
// before results either side has since finished gets one new version on the
// newer results, at most once a day, and a tick with nothing to refresh
// writes nothing. Dates of their own, far from every other spec's fixtures.
const REFRESH_KICKOFF = new Date('2032-04-10T15:00:00Z');
const HOUR = 60 * 60 * 1000;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'refreshing a forecast once its inputs have moved on (T-1377)',
  () => {
    const league = randomUUID();
    const leagueSeason = randomUUID();
    const cup = randomUUID();
    const cupSeason = randomUUID();
    const fixture = randomUUID();
    const home = randomUUID();
    const away = randomUUID();
    const other = randomUUID();
    const results: string[] = [];
    let clock = new Date('2032-04-08T12:00:00Z');
    let pool: Pool;
    let triggers: ForecastTriggersService;
    let close: () => Promise<void>;

    /** A finished match of `team` against `other`, with a full-time score unless told not. */
    async function finished(
      season: string,
      team: string,
      kickoff: string,
      withScore = true,
    ): Promise<void> {
      const id = randomUUID();
      results.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'finished')`,
        [id, season, new Date(kickoff)],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, team, other],
      );
      if (withScore) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 2, 1)`,
          [id],
        );
      }
    }

    async function rows(): Promise<
      { version_number: number; kind: string; p_draw: string; fit_date: string; at: Date }[]
    > {
      const { rows: found } = await pool.query<{
        version_number: number;
        kind: string;
        p_draw: string;
        fit_date: string;
        at: Date;
      }>(
        `SELECT f.version_number, s.kind, f.p_draw::text AS p_draw,
                s.model_inputs->>'fit_date' AS fit_date, f.computed_at AS at
           FROM forecast f
           JOIN input_snapshot s ON s.id = f.input_snapshot_id
          WHERE f.fixture_id = $1 AND f.role = 'published'
          ORDER BY f.version_number`,
        [fixture],
      );
      return found;
    }

    /** Every row a tick could write for the fixture, so "writes nothing" is a count. */
    async function written(): Promise<number> {
      const { rows: counted } = await pool.query<{ n: string }>(
        `SELECT (SELECT COUNT(*) FROM forecast WHERE fixture_id = $1)
              + (SELECT COUNT(*) FROM input_snapshot WHERE fixture_id = $1)
              + (SELECT COUNT(*) FROM power_index WHERE participant_id IN
                   (SELECT id FROM fixture_participant WHERE fixture_id = $1)) AS n`,
        [fixture],
      );
      return Number(counted[0]?.n);
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender, football_data_division)
         VALUES ($1, $2, 'Refresh Test League', 'league', 'domestic', 'men', 'Y7')`,
        [league, COUNTRY],
      );
      // A domestic cup: the league's fit does not read it.
      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, 'Refresh Test Cup', 'cup', 'domestic', 'men')`,
        [cup, COUNTRY],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2031/32', '2031-08-01', '2032-05-30', false),
                ($3, $4, '2031/32', '2031-08-01', '2032-05-30', false)`,
        [leagueSeason, league, cupSeason, cup],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender)
         VALUES ($1, 'Nu', 'club', 'men'), ($2, 'Xi', 'club', 'men'), ($3, 'Omicron', 'club', 'men')`,
        [home, away, other],
      );
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
        [fixture, leagueSeason, REFRESH_KICKOFF],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [fixture, home, away],
      );

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule],
        providers: [
          ForecastTriggersService,
          ForecastService,
          PostgresForecastStore,
          PowerIndexService,
          EvaluationService,
          PostgresEvaluationStore,
          { provide: MODEL_CLIENT, useValue: answering(PUBLISHED, () => clock) },
        ],
      }).compile();
      await moduleRef.init();
      triggers = moduleRef.get(ForecastTriggersService);
      close = () => moduleRef.close();

      // The early version, made on 6 April: its fit read results up to the 5th.
      await moduleRef.get(PostgresForecastStore).record({
        fixtureId: fixture,
        kind: 'early',
        modelId: PUBLISHED,
        request: {
          fixture_id: fixture,
          home_team_id: home,
          away_team_id: away,
          division: 'Y7',
          kickoff_at: REFRESH_KICKOFF.toISOString(),
        },
        computedAt: new Date('2032-04-06T12:00:00Z'),
        available: {
          probabilities: { home: 0.25, draw: 0.55, away: 0.2 },
          expectedGoals: { home: 0.5, away: 0.3 },
          mostLikely: [{ home: 0, away: 0, probability: 0.45 }],
          leadingFactors: [],
          inputs: {
            model_version: PUBLISHED,
            fit_date: '2032-04-05',
            matches_used: 200,
            elo_used: true,
            history_from: '2029-04-01',
            data_completeness: 'available',
          },
        },
        unavailable: null,
      });
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM power_index WHERE participant_id IN
             (SELECT id FROM fixture_participant WHERE fixture_id = $1)`,
          [fixture],
        );
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [fixture]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [fixture]);
      });
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[fixture, ...results]]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [
        [leagueSeason, cupSeason],
      ]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [[league, cup]]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[home, away, other]]);
      await pool.end();
      await close?.();
    });

    it('writes nothing while no result the fit did not read is stored', async () => {
      const before = await written();
      // A league result today (a fit made now would not read it yet), a cup
      // result (the league's fit never reads it), and a league result with
      // no full-time score: none of them moves the inputs.
      await finished(leagueSeason, home, '2032-04-08T10:00:00Z');
      await finished(cupSeason, away, '2032-04-07T18:00:00Z');
      await finished(leagueSeason, away, '2032-04-06T18:00:00Z', false);

      const report = await triggers.runDue(clock);
      expect(report.refreshed).toBe(0);
      expect(report.computed).toEqual({});
      expect(Object.keys(report.skipped)).toContain(
        'the early version is recorded and no line-up has arrived yet',
      );
      expect(await written()).toBe(before);
    });

    it('writes one new version once either side has a result the fit did not read', async () => {
      await finished(leagueSeason, away, '2032-04-07T18:00:00Z');

      const report = await triggers.runDue(clock);
      expect(report.refreshed).toBe(1);
      expect(report.computed).toEqual({ early: 1 });

      const found = await rows();
      expect(found.map((r) => [r.version_number, r.kind, r.fit_date])).toEqual([
        [1, 'early', '2032-04-05'],
        [2, 'early', '2032-04-07'],
      ]);
      // The first version is as it was (rule 5).
      expect(Number(found[0]?.p_draw)).toBeCloseTo(0.55, 4);
      expect(found[1]?.at.toISOString()).toBe(clock.toISOString());
    });

    it('writes nothing on the next pass: the new version read every result before today', async () => {
      const before = await written();
      const report = await triggers.runDue(clock);
      expect(report.refreshed).toBe(0);
      expect(await written()).toBe(before);
    });

    it('waits a day after the newest version, then refreshes once more', async () => {
      // The next morning, the 8th's league result is one a fit would read,
      // but the newest version is 18 hours old.
      clock = new Date(clock.getTime() + 18 * HOUR);
      const before = await written();
      const early = await triggers.runDue(clock);
      expect(early.refreshed).toBe(0);
      expect(
        early.skipped['newer results are stored, and the newest version is less than 24 hours old'],
      ).toBe(1);
      expect(await written()).toBe(before);

      clock = new Date(clock.getTime() + 6 * HOUR);
      const due = await triggers.runDue(clock);
      expect(due.refreshed).toBe(1);
      expect((await rows()).map((r) => r.fit_date)).toEqual([
        '2032-04-05',
        '2032-04-07',
        '2032-04-08',
      ]);
    });

    it('never refreshes after kick-off', async () => {
      await finished(leagueSeason, home, '2032-04-09T18:00:00Z');
      clock = new Date(REFRESH_KICKOFF.getTime() + 60 * 1000);
      const before = await written();
      const report = await triggers.runDue(clock);
      expect(report.refreshed).toBe(0);
      expect(await written()).toBe(before);
      expect((await rows()).length).toBe(3);
    });
  },
);
