import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTriggersOff } from '../../testing/cleanup';
import { EvaluationService } from './evaluation.service';
import { candidateRecords } from './internal/candidate-records';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { PostgresForecastStore, type NewForecast } from './internal/forecast-store';

/**
 * T-1103 against the real schema: each candidate's pre-kick-off record and its
 * pairs with the published version, from the stored evaluations. The model
 * versions carry this run's tag, so rows other files leave behind are ignored.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SEASON = '00000000-0000-4000-8000-000000000302';
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PUBLISHED = `published-${RUN}@0.1.0`;
const ONE = `candidate-${RUN}@0.5.0`;
const TWO = `candidate-${RUN}@0.6.0`;
const KICKOFF = '2025-03-01T15:00:00.000Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('candidate records', () => {
  let pool: Pool;
  const fixture = randomUUID();

  const version = (
    role: 'published' | 'shadow',
    modelId: string,
    computedAt: string,
    p: [number, number, number] | null,
  ): NewForecast => ({
    fixtureId: fixture,
    kind: 'early',
    role,
    modelId,
    request: {
      fixture_id: fixture,
      home_team_id: HOME,
      away_team_id: AWAY,
      division: 'E0',
      kickoff_at: KICKOFF,
    },
    computedAt: new Date(computedAt),
    available:
      p === null
        ? null
        : {
            probabilities: { home: p[0], draw: p[1], away: p[2] },
            expectedGoals: { home: 1.5, away: 1.0 },
            mostLikely: [{ home: 1, away: 0, probability: 0.12 }],
            leadingFactors: [],
            inputs: {
              model_version: modelId,
              fit_date: '2025-02-28',
              matches_used: 100,
              elo_used: true,
              history_from: '2023-03-01',
              data_completeness: 'available',
            },
          },
    unavailable: p === null ? { reason: 'no_history', detail: 'a test refusal' } : null,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Candidates test', $3, 'finished')`,
      [fixture, SEASON, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, HOME, AWAY],
    );
    const store = new PostgresForecastStore(pool);
    await store.record(version('published', PUBLISHED, '2025-03-01T10:00:00Z', [0.5, 0.3, 0.2]));
    await store.record(version('shadow', ONE, '2025-03-01T10:00:00Z', [0.4, 0.3, 0.3]));
    // Its later pre-kick-off version is the one paired; both count.
    await store.record(version('shadow', ONE, '2025-03-01T12:00:00Z', [0.6, 0.25, 0.15]));
    // After kick-off: evaluated, never counted (D-031).
    await store.record(version('shadow', ONE, '2025-03-01T16:00:00Z', [0.9, 0.05, 0.05]));
    await store.record(version('shadow', TWO, '2025-03-01T10:00:00Z', null));
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', 2, 1)`,
      [fixture],
    );
    await new EvaluationService(new PostgresEvaluationStore(pool)).evaluateFixture(fixture);
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM evaluation WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM fixture_score WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    });
    await pool.end();
  });

  it('counts pre-kick-off forecasts only, and pairs the latest of each with the published one', async () => {
    const store = new PostgresEvaluationStore(pool);
    const [counts, pairs] = await Promise.all([store.candidateCounts(), store.candidatePairs()]);
    const report = candidateRecords(
      counts.filter((c) => c.modelVersion.includes(RUN)),
      pairs.filter((p) => p.modelVersion.includes(RUN)),
      [TWO],
      new Date('2025-03-02T00:00:00Z'),
    );

    const one = report.candidates.find((c) => c.model_version === ONE);
    const two = report.candidates.find((c) => c.model_version === TWO);
    expect(report.candidates.map((c) => c.model_version)).not.toContain(PUBLISHED);
    expect(one).toMatchObject({
      in_shadow: false,
      pre_kickoff_evaluated: 2,
      pre_kickoff_awaiting: 0,
      after_kickoff: 1,
      unavailable: 0,
    });
    expect(two).toMatchObject({ in_shadow: true, pre_kickoff_evaluated: 0, unavailable: 1 });
    expect(two?.competitions).toEqual([]);

    expect(one?.competitions).toHaveLength(1);
    const pair = one?.competitions[0];
    expect(pair?.pairs).toBe(1);
    expect(pair?.published_versions).toEqual([PUBLISHED]);
    // Home won: -ln(0.6) for the paired candidate version, -ln(0.5) for the published.
    expect(pair?.candidate.log_loss).toBeCloseTo(-Math.log(0.6), 5);
    expect(pair?.published.log_loss).toBeCloseTo(-Math.log(0.5), 5);
  });

  it('counts the forecasts a candidate stored nothing for, from its first answer on (T-1165)', async () => {
    const store = new PostgresForecastStore(pool);
    const shadowOnly = `shadow-${RUN}@0.7.0`;
    const now = new Date('2037-06-11T12:00:00Z');
    const at = (hoursBefore: number, seconds = 0) =>
      new Date(now.getTime() - hoursBefore * 3_600_000 + seconds * 1000).toISOString();
    const published = (iso: string) =>
      store.record(version('published', PUBLISHED, iso, [0.5, 0.3, 0.2]));

    // Before its first answer: never asked of it, so not a failure.
    await published(at(96));
    // Answered, outside the day.
    await published(at(30));
    await store.record(version('shadow', shadowOnly, at(30, 5), [0.4, 0.3, 0.3]));
    // Nothing stored: a failure, inside the day.
    await published(at(5));
    // A refusal is an answer.
    await published(at(2));
    await store.record(version('shadow', shadowOnly, at(2, 10), null));
    // The model service did not answer: no candidate was asked.
    await store.record({
      ...version('published', 'none@0.0.0', at(1), null),
      unavailable: { reason: 'model_unreachable', detail: 'a test outage' },
    });

    const rows = await store.candidateShadow(
      new Date(now.getTime() - 7 * 86_400_000),
      new Date(now.getTime() - 86_400_000),
      now,
    );
    const row = rows.find((r) => r.modelVersion === shadowOnly);
    expect(row).toMatchObject({ dayAsked: 2, dayFailed: 1 });
    expect(row?.firstAt.toISOString()).toBe(at(30, 5));
    expect(row?.lastAt.toISOString()).toBe(at(2, 10));
    expect(row?.lastFailure?.at.toISOString()).toBe(at(5));
    expect(row?.lastFailure?.fixtureId).toBe(fixture);
    // A version with nothing stored is absent: it has never answered.
    expect(rows.find((r) => r.modelVersion === `never-${RUN}@0.8.0`)).toBeUndefined();
  });
});
