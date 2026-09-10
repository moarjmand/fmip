import { Inject, Injectable } from '@nestjs/common';
import type {
  ForecastKind,
  ForecastUnavailableReason,
  ForecastVersion,
  ModelExpectedGoals,
  ModelForecastRequest,
  ModelInputs,
  ModelLeadingFactor,
  ModelProbabilities,
  ModelScorelineProbability,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** What the store needs to know about a fixture to ask the model. */
export interface FixtureForModel {
  id: string;
  kickoffAt: Date;
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  /** football-data.co.uk division, or null when the competition is not mapped. */
  division: string | null;
}

export interface NewForecast {
  fixtureId: string;
  kind: ForecastKind;
  modelId: string;
  request: ModelForecastRequest;
  computedAt: Date;
  available: {
    probabilities: ModelProbabilities;
    expectedGoals: ModelExpectedGoals;
    mostLikely: ModelScorelineProbability[];
    leadingFactors: ModelLeadingFactor[];
    inputs: ModelInputs;
  } | null;
  unavailable: { reason: ForecastUnavailableReason; detail: string } | null;
}

interface ForecastRow {
  id: string;
  fixture_id: string;
  version_number: number;
  kind: ForecastKind;
  model_id: string;
  computed_at: Date;
  status: 'available' | 'unavailable';
  p_home: string | null;
  p_draw: string | null;
  p_away: string | null;
  expected_home_goals: string | null;
  expected_away_goals: string | null;
  most_likely: ModelScorelineProbability[] | null;
  leading_factors: ModelLeadingFactor[] | null;
  data_completeness: 'available' | 'limited' | null;
  unavailable_reason: ForecastUnavailableReason | null;
  unavailable_detail: string | null;
}

function toVersion(row: ForecastRow): ForecastVersion {
  const available = row.status === 'available';
  return {
    id: row.id,
    fixture_id: row.fixture_id,
    version_number: row.version_number,
    kind: row.kind,
    model_version: row.model_id,
    computed_at: row.computed_at.toISOString(),
    status: row.status,
    probabilities:
      available && row.p_home !== null && row.p_draw !== null && row.p_away !== null
        ? { home: Number(row.p_home), draw: Number(row.p_draw), away: Number(row.p_away) }
        : null,
    expected_goals:
      available && row.expected_home_goals !== null && row.expected_away_goals !== null
        ? { home: Number(row.expected_home_goals), away: Number(row.expected_away_goals) }
        : null,
    most_likely_scorelines: available ? row.most_likely : null,
    leading_factors: available ? row.leading_factors : null,
    data_completeness: available ? row.data_completeness : null,
    unavailable_reason: available ? null : row.unavailable_reason,
    unavailable_detail: available ? null : row.unavailable_detail,
  };
}

const SELECT = `
  SELECT f.id, f.fixture_id, f.version_number, s.kind, m.model_id, f.computed_at, f.status,
         f.p_home, f.p_draw, f.p_away, f.expected_home_goals, f.expected_away_goals,
         f.most_likely, f.leading_factors, f.data_completeness,
         f.unavailable_reason, f.unavailable_detail
    FROM forecast f
    JOIN input_snapshot s ON s.id = f.input_snapshot_id
    JOIN model_version m ON m.id = f.model_version_id`;

/**
 * SQL for the forecast boundary (D-025). Writes are one transaction per
 * version: model_version (upsert), input_snapshot, forecast with the next
 * version number. Nothing here updates or deletes a forecast; the database
 * would refuse anyway (rule 5).
 */
@Injectable()
export class PostgresForecastStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureForModel(fixtureId: string): Promise<FixtureForModel | null> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      home_team_id: string;
      away_team_id: string;
      competition_id: string;
      division: string | null;
    }>(
      `SELECT f.id, f.kickoff_at, c.id AS competition_id, c.football_data_division AS division,
              h.team_id AS home_team_id, a.team_id AS away_team_id
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      kickoffAt: row.kickoff_at,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      competitionId: row.competition_id,
      division: row.division,
    };
  }

  async versions(fixtureId: string): Promise<ForecastVersion[]> {
    const { rows } = await this.pool.query<ForecastRow>(
      `${SELECT} WHERE f.fixture_id = $1 ORDER BY f.version_number`,
      [fixtureId],
    );
    return rows.map(toVersion);
  }

  /** Writes one version. Returns it as the API serves it. */
  async record(input: NewForecast): Promise<ForecastVersion> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const model = await client.query<{ id: string }>(
        `INSERT INTO model_version (model_id) VALUES ($1)
           ON CONFLICT (model_id) DO UPDATE SET model_id = EXCLUDED.model_id
           RETURNING id`,
        [input.modelId],
      );
      const modelVersionId = model.rows[0]?.id;
      if (modelVersionId === undefined) throw new Error('model_version upsert returned no row');

      const snapshot = await client.query<{ id: string }>(
        `INSERT INTO input_snapshot (fixture_id, model_version_id, kind, request, model_inputs)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
           RETURNING id`,
        [
          input.fixtureId,
          modelVersionId,
          input.kind,
          JSON.stringify(input.request),
          input.available === null ? null : JSON.stringify(input.available.inputs),
        ],
      );
      const snapshotId = snapshot.rows[0]?.id;
      if (snapshotId === undefined) throw new Error('input_snapshot insert returned no row');

      // The next version number, decided inside the transaction. Two
      // concurrent computations for one fixture serialise on the unique
      // constraint: the loser fails and retries, never overwrites.
      const forecast = await client.query<ForecastRow>(
        `INSERT INTO forecast (
           fixture_id, input_snapshot_id, model_version_id, version_number, computed_at, status,
           p_home, p_draw, p_away, expected_home_goals, expected_away_goals,
           most_likely, leading_factors, data_completeness, unavailable_reason, unavailable_detail
         )
         SELECT $1, $2, $3, COALESCE(MAX(version_number), 0) + 1, $4, $5,
                $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15
           FROM forecast WHERE fixture_id = $1
         RETURNING id`,
        [
          input.fixtureId,
          snapshotId,
          modelVersionId,
          input.computedAt,
          input.available === null ? 'unavailable' : 'available',
          input.available?.probabilities.home ?? null,
          input.available?.probabilities.draw ?? null,
          input.available?.probabilities.away ?? null,
          input.available?.expectedGoals.home ?? null,
          input.available?.expectedGoals.away ?? null,
          input.available === null ? null : JSON.stringify(input.available.mostLikely),
          input.available === null ? null : JSON.stringify(input.available.leadingFactors),
          input.available?.inputs.data_completeness ?? null,
          input.unavailable?.reason ?? null,
          input.unavailable?.detail ?? null,
        ],
      );
      const forecastId = forecast.rows[0]?.id;
      if (forecastId === undefined) throw new Error('forecast insert returned no row');

      const { rows } = await client.query<ForecastRow>(`${SELECT} WHERE f.id = $1`, [forecastId]);
      await client.query('COMMIT');

      const row = rows[0];
      if (row === undefined) throw new Error('forecast read-back returned no row');
      return toVersion(row);
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
