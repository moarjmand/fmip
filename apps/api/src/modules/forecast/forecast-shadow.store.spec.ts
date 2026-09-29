import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTriggersOff } from '../../testing/cleanup';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { PostgresForecastStore, type NewForecast } from './internal/forecast-store';

/**
 * T-531 against the real schema: a shadow version is stored like any forecast,
 * numbered within its own role, and absent from every read the product serves.
 * A fixture of its own, so no other file's version numbers are disturbed.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SEASON = '00000000-0000-4000-8000-000000000302';
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('shadow forecasts', () => {
  let pool: Pool;
  let store: PostgresForecastStore;
  const fixture = randomUUID();

  const answer = (role: NewForecast['role'], modelId: string): NewForecast => ({
    fixtureId: fixture,
    kind: 'early',
    role,
    modelId,
    request: {
      fixture_id: fixture,
      home_team_id: HOME,
      away_team_id: AWAY,
      division: 'E0',
      kickoff_at: '2099-02-01T15:00:00.000Z',
    },
    computedAt: new Date(),
    available: null,
    unavailable: { reason: 'no_history', detail: 'a test answer' },
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PostgresForecastStore(pool);
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Shadow test', TIMESTAMPTZ '2099-02-01 15:00:00+00', 'scheduled')`,
      [fixture, SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, HOME, AWAY],
    );
  });

  afterAll(async () => {
    // Forecasts refuse deletion (rule 5); a test's own rows go with triggers off.
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [fixture]);
      await client.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    });
    await pool.end();
  });

  it('numbers each role on its own and serves only the published versions', async () => {
    const first = await store.record(answer('published', 'dixon-coles-elo@0.1.0'));
    const shadow = await store.record(answer('shadow', 'dixon-coles-elo@0.2.0'));
    const second = await store.record(answer(undefined, 'dixon-coles-elo@0.1.0'));

    expect([first.version_number, shadow.version_number, second.version_number]).toEqual([1, 1, 2]);
    const served = await store.versions(fixture);
    expect(served.map((v) => v.version_number)).toEqual([1, 2]);
    expect(served.map((v) => v.model_version)).not.toContain('dixon-coles-elo@0.2.0');
    expect((await store.latestForFixtures([fixture])).get(fixture)?.version_number).toBe(2);

    const { rows } = await pool.query<{ role: string; n: string }>(
      `SELECT role, count(*)::text AS n FROM forecast WHERE fixture_id = $1 GROUP BY role ORDER BY role`,
      [fixture],
    );
    expect(rows).toEqual([
      { role: 'published', n: '2' },
      { role: 'shadow', n: '1' },
    ]);
  });

  it('numbers each candidate within its own model version, and published has no gap (T-1102)', async () => {
    // Continues the fixture above: published 1 and 2, 0.2.0's shadow 1.
    const older = await store.record(answer('shadow', 'dixon-coles-elo@0.2.0'));
    const newer = await store.record(answer('shadow', 'dixon-coles-elo@0.3.0'));
    const third = await store.record(answer('published', 'dixon-coles-elo@0.1.0'));
    const newerAgain = await store.record(answer('shadow', 'dixon-coles-elo@0.3.0'));

    expect([older.version_number, newer.version_number, newerAgain.version_number]).toEqual([
      2, 1, 2,
    ]);
    expect(third.version_number).toBe(3);
    const served = await store.versions(fixture);
    expect(served.map((v) => v.version_number)).toEqual([1, 2, 3]);
    expect(served.every((v) => v.model_version === 'dixon-coles-elo@0.1.0')).toBe(true);

    const { rows } = await pool.query<{ model_id: string; numbers: number[] }>(
      `SELECT m.model_id, array_agg(f.version_number ORDER BY f.version_number) AS numbers
         FROM forecast f JOIN model_version m ON m.id = f.model_version_id
        WHERE f.fixture_id = $1 AND f.role = 'shadow'
        GROUP BY m.model_id ORDER BY m.model_id`,
      [fixture],
    );
    expect(rows).toEqual([
      { model_id: 'dixon-coles-elo@0.2.0', numbers: [1, 2] },
      { model_id: 'dixon-coles-elo@0.3.0', numbers: [1, 2] },
    ]);
  });

  it('offers the available version of every candidate for evaluation under its own model version', async () => {
    const available = (modelId: string): NewForecast => ({
      ...answer('shadow', modelId),
      available: {
        probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
        expectedGoals: { home: 1.5, away: 1.0 },
        mostLikely: [{ home: 1, away: 0, probability: 0.12 }],
        leadingFactors: [],
        inputs: {
          model_version: modelId,
          fit_date: '2099-01-31',
          matches_used: 100,
          elo_used: true,
          history_from: '2098-01-01',
          data_completeness: 'available',
        },
      },
      unavailable: null,
    });
    await store.record(available('dixon-coles-elo@0.2.0'));
    await store.record(available('dixon-coles-elo@0.3.0'));

    const pending = await new PostgresEvaluationStore(pool).unevaluated(fixture);
    const { rows } = await pool.query<{ id: string; model_id: string }>(
      `SELECT mv.id, mv.model_id FROM model_version mv WHERE mv.id = ANY($1::uuid[])`,
      [pending.map((p) => p.modelVersionId)],
    );
    expect(rows.map((r) => r.model_id).sort()).toEqual([
      'dixon-coles-elo@0.2.0',
      'dixon-coles-elo@0.3.0',
    ]);
  });
});
