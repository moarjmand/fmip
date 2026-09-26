import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { PowerIndexService } from './power-index.service';
import { withTriggersOff } from '../../testing/cleanup';

// The Power Index end to end (T-111).
//
// The history it measures against is built here rather than assumed: the
// development machine happens to hold a real Premier League season and a
// continuous-integration database holds none, so a test that relied on one
// would pass in one place and fail in the other. This creates its own division —
// four teams whose order is not in doubt — and the one test that does use the
// real season skips itself, visibly, when the season is absent.
const DATABASE_URL = process.env.DATABASE_URL;

// A code football-data does not use, and valid under the column's format
// constraint (one or two letters then a digit or C).
const DIVISION = 'Z9';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FIXTURE = randomUUID();
const EARLIER = randomUUID();
const LOAD = randomUUID();
const TEAMS = {
  strongest: randomUUID(),
  strong: randomUUID(),
  weak: randomUUID(),
  weakest: randomUUID(),
};
const NAMES: [keyof typeof TEAMS, string][] = [
  ['strongest', 'Alpha'],
  ['strong', 'Beta'],
  ['weak', 'Gamma'],
  ['weakest', 'Delta'],
];
// Three days and twenty hours after the earlier fixture: three whole days.
const KICKOFF = '2025-08-16T14:00:00Z';
const PREVIOUS = '2025-08-12T18:00:00Z';

// The real season, when this database happens to hold it.
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the power index', () => {
  let pool: Pool;
  let service: PowerIndexService;
  let close: () => Promise<void>;
  let hasRealSeason = false;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender, football_data_division)
       VALUES ($1, '00000000-0000-4000-8000-000000000101', 'Power Index Test League',
               'league', 'domestic', 'men', $2)`,
      [COMPETITION, DIVISION],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26', '2025-08-01', '2026-05-30', false)`,
      [SEASON, COMPETITION],
    );
    for (const [key, name] of NAMES) {
      await pool.query(`INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men')`, [
        TEAMS[key],
        name,
      ]);
      await pool.query(
        `INSERT INTO training.team_alias (team_id, division, training_name) VALUES ($1, $2, $3)`,
        [TEAMS[key], DIVISION, name],
      );
    }

    // A division whose order is not in doubt: each team beats every team below
    // it by its distance in the table, home and away, twice over.
    await pool.query(
      `INSERT INTO training.source_load
         (id, source, scope, url, licence_url, licence_note, content_sha256, row_count, status, finished_at)
       VALUES ($1, 'football_data_co_uk', 'Z9 test', 'about:blank', 'about:blank',
               'test fixture, not a real load', 'x', 24, 'succeeded', now())`,
      [LOAD],
    );
    const order = NAMES.map(([, name]) => name);
    let day = 0;
    for (let round = 0; round < 2; round += 1) {
      for (let i = 0; i < order.length; i += 1) {
        for (let j = 0; j < order.length; j += 1) {
          if (i === j) continue;
          day += 1;
          const margin = Math.max(0, j - i);
          await pool.query(
            `INSERT INTO training.match
               (source_load_id, division, season, match_date, home_team, away_team,
                home_goals, away_goals, result)
             VALUES ($1, $2, '2024/25', $3, $4, $5, $6, 0, $7)`,
            [
              LOAD,
              DIVISION,
              new Date(Date.UTC(2025, 0, 1 + day)).toISOString().slice(0, 10),
              order[i],
              order[j],
              margin,
              margin > 0 ? 'H' : 'D',
            ],
          );
        }
      }
    }

    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'finished')`,
      [EARLIER, SEASON, PREVIOUS],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [EARLIER, TEAMS.strongest, TEAMS.weakest],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
      [FIXTURE, SEASON, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [FIXTURE, TEAMS.strongest, TEAMS.weakest],
    );

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM training.match WHERE division = 'E0'`,
    );
    hasRealSeason = Number(rows[0]?.n ?? 0) >= 300;

    // The service alone, not the whole forecast boundary: the Power Index needs
    // the pool and nothing else, and pulling in the identity and model-client
    // wiring would make this test depend on their environment as well.
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [PowerIndexService],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(PowerIndexService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM power_index WHERE participant_id IN
           (SELECT id FROM fixture_participant WHERE fixture_id = ANY($1::uuid[]))`,
        [[FIXTURE, EARLIER]],
      );
    });
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[FIXTURE, EARLIER]]);
    await pool.query(`DELETE FROM season WHERE competition_id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM training.match WHERE source_load_id = $1`, [LOAD]);
    await pool.query(`DELETE FROM training.source_load WHERE id = $1`, [LOAD]);
    await pool.query(`DELETE FROM training.team_alias WHERE division = $1`, [DIVISION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.end();
    await close?.();
  });

  it('measures both sides, and says what it could not reach', async () => {
    const outcome = await service.compute(FIXTURE, new Date('2025-08-15T09:00:00Z'));
    expect(outcome.kind).toBe('computed');
    if (outcome.kind !== 'computed') return;

    for (const index of [outcome.pair.home, outcome.pair.away]) {
      expect(index.value).toBeGreaterThanOrEqual(0);
      expect(index.value).toBeLessThanOrEqual(100);
      // Four of the seven components arrive here. This fixture has no recorded
      // line-ups or ratings, so line-up quality and stability say so (T-112),
      // and competition context is not modelled.
      expect(index.completeness).toBeCloseTo(0.7, 4);
      const absent = index.components.filter((c) => c.state === 'not_supplied');
      expect(absent.map((c) => c.key).sort()).toEqual([
        'competition_context',
        'lineup_quality',
        'stability',
      ]);
      // Every absence says why. A blank row teaches nothing.
      expect(absent.every((c) => (c.note ?? '') !== '')).toBe(true);
    }

    // The division's order is not in doubt, so the index has to reproduce it.
    const strongest = outcome.pair.home.components.find((c) => c.key === 'underlying_strength');
    const weakest = outcome.pair.away.components.find((c) => c.key === 'underlying_strength');
    expect(strongest?.value as number).toBeGreaterThan(weakest?.value as number);
    expect(outcome.pair.home.value).toBeGreaterThan(outcome.pair.away.value);
  });

  it('measures rest from the real schedule, and never calls it complete', async () => {
    const outcome = await service.compute(FIXTURE, new Date('2025-08-15T09:30:00Z'));
    if (outcome.kind !== 'computed') throw new Error('expected an index');

    const rest = outcome.pair.home.components.find((c) => c.key === 'rest_and_congestion');
    // Three whole days between the two fixtures: inside the curve, so the
    // component is neither 0 nor 1.
    expect(rest?.value as number).toBeGreaterThan(0);
    expect(rest?.value as number).toBeLessThan(1);
    expect(rest?.note).toContain('3 days since the previous match');
    // Travel is the third thing the blueprint names here and is not modelled.
    expect(rest?.state).toBe('limited');
  });

  it('stores each computation as a new immutable row, and reads back the newest', async () => {
    const first = new Date('2025-08-15T10:00:00Z');
    const second = new Date('2025-08-16T10:00:00Z');
    await service.compute(FIXTURE, first);
    await service.compute(FIXTURE, second);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM power_index pi
         JOIN fixture_participant p ON p.id = pi.participant_id
        WHERE p.fixture_id = $1 AND pi.computed_at IN ($2, $3)`,
      [FIXTURE, first, second],
    );
    // Two moments, two sides: four rows, none of them an edit of another.
    expect(Number(rows[0]?.n)).toBe(4);

    const latest = await service.latest(FIXTURE);
    expect(latest?.home.computed_at).toBe(second.toISOString());
    expect(latest?.away.team.id).toBe(TEAMS.weakest);
    expect(latest?.home.leading.length).toBeGreaterThan(0);
  });

  it('recomputing at the same instant is the same computation, not a second one', async () => {
    const when = new Date('2025-08-15T11:00:00Z');
    await service.compute(FIXTURE, when);
    await service.compute(FIXTURE, when);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM power_index pi
         JOIN fixture_participant p ON p.id = pi.participant_id
        WHERE p.fixture_id = $1 AND pi.computed_at = $2`,
      [FIXTURE, when],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('declines, with a reason, for a competition it has no history for', async () => {
    const season = randomUUID();
    const fixture = randomUUID();
    // La Liga maps to SP1, which no development database is loaded with.
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '00000000-0000-4000-8000-000000000202', '2025/26 no-history test', '2025-08-01', '2026-05-30', false)`,
      [season],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
      [fixture, season, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, TEAMS.strongest, TEAMS.weakest],
    );

    const outcome = await service.compute(fixture);
    expect(outcome.kind).toBe('not_measurable');
    if (outcome.kind === 'not_measurable') expect(outcome.reason).toContain('SP1');

    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
  });

  it('says so for a fixture it has never heard of', async () => {
    const outcome = await service.compute('00000000-0000-4000-8000-0000000009ff');
    expect(outcome.kind).toBe('unknown_fixture');
  });

  it('separates the champions from the fifteenth on a real season', async (ctx) => {
    // Only where the training store has been loaded — the loaders need the
    // network, so a continuous-integration database has none. Skipped out loud
    // rather than passed quietly.
    if (!hasRealSeason) ctx.skip();

    const season = randomUUID();
    const fixture = randomUUID();
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26 real-season test', '2025-08-01', '2026-05-30', false)`,
      [season, PREMIER_LEAGUE],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
      [fixture, season, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, MAN_UNITED, LIVERPOOL],
    );

    const outcome = await service.compute(fixture, new Date('2025-08-15T09:00:00Z'));
    expect(outcome.kind).toBe('computed');
    if (outcome.kind === 'computed') {
      // Liverpool won the 2024/25 Premier League; Manchester United finished
      // fifteenth. Separating them is the least a strength measure has to do.
      expect(outcome.pair.away.value).toBeGreaterThan(outcome.pair.home.value);
    }

    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM power_index WHERE participant_id IN
           (SELECT id FROM fixture_participant WHERE fixture_id = $1)`,
        [fixture],
      );
    });
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
  });
});
