import { Inject, Injectable } from '@nestjs/common';
import type {
  ForecastEvaluation,
  ForecastKind,
  ModelPerformanceRow,
  ModelScorelineProbability,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { Scored } from './scoring';

export interface FixtureResult {
  id: string;
  competitionId: string;
  status: string;
  kickoffAt: Date;
  /** The full-time score, or null when none has been recorded. */
  fullTime: { home: number; away: number } | null;
}

/** An available forecast version with no evaluation yet. */
export interface UnevaluatedVersion {
  forecastId: string;
  modelVersionId: string;
  computedAt: Date;
  probabilities: { home: number; draw: number; away: number };
  mostLikely: ModelScorelineProbability[];
}

export interface PerformanceTotals {
  finishedFixtures: number;
  fixturesEvaluated: number;
  unavailableVersions: number;
  postKickoffVersions: number;
  lastUpdatedAt: Date | null;
}

interface EvaluationRow {
  id: string;
  forecast_id: string;
  fixture_id: string;
  version_number: number;
  kind: ForecastKind;
  model_id: string;
  computed_at: Date;
  evaluated_at: Date;
  pre_kickoff: boolean;
  actual_home: number;
  actual_away: number;
  outcome: 'home' | 'draw' | 'away';
  p_outcome: string;
  log_loss: string;
  brier: string;
  correct: boolean;
  scoreline_hit: boolean;
}

const toEvaluation = (row: EvaluationRow): ForecastEvaluation => ({
  id: row.id,
  forecast_id: row.forecast_id,
  fixture_id: row.fixture_id,
  version_number: row.version_number,
  kind: row.kind,
  model_version: row.model_id,
  computed_at: row.computed_at.toISOString(),
  evaluated_at: row.evaluated_at.toISOString(),
  pre_kickoff: row.pre_kickoff,
  actual: { home: row.actual_home, away: row.actual_away },
  outcome: row.outcome,
  p_outcome: Number(row.p_outcome),
  log_loss: Number(row.log_loss),
  brier: Number(row.brier),
  correct: row.correct,
  scoreline_hit: row.scoreline_hit,
});

const SELECT = `
  SELECT e.id, e.forecast_id, e.fixture_id, f.version_number, s.kind, m.model_id, f.computed_at,
         e.evaluated_at, e.pre_kickoff, e.actual_home, e.actual_away, e.outcome,
         e.p_outcome, e.log_loss, e.brier, e.correct, e.scoreline_hit
    FROM evaluation e
    JOIN forecast f ON f.id = e.forecast_id
    JOIN input_snapshot s ON s.id = f.input_snapshot_id
    JOIN model_version m ON m.id = f.model_version_id`;

/** Fixtures of one competition, optionally one season. */
const IN_SCOPE = `
  fixture fx JOIN season se ON se.id = fx.season_id
  WHERE se.competition_id = $1 AND ($2::uuid IS NULL OR se.id = $2)`;

/** SQL for the evaluation side of the forecast boundary (D-025). Insert-only. */
@Injectable()
export class PostgresEvaluationStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureResult(fixtureId: string): Promise<FixtureResult | null> {
    const { rows } = await this.pool.query<{
      id: string;
      competition_id: string;
      status: string;
      kickoff_at: Date;
      home: number | null;
      away: number | null;
    }>(
      `SELECT f.id, se.competition_id, f.status, f.kickoff_at, sc.home, sc.away
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         LEFT JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      competitionId: row.competition_id,
      status: row.status,
      kickoffAt: row.kickoff_at,
      fullTime: row.home === null || row.away === null ? null : { home: row.home, away: row.away },
    };
  }

  async unevaluated(fixtureId: string): Promise<UnevaluatedVersion[]> {
    const { rows } = await this.pool.query<{
      id: string;
      model_version_id: string;
      computed_at: Date;
      p_home: string;
      p_draw: string;
      p_away: string;
      most_likely: ModelScorelineProbability[];
    }>(
      `SELECT f.id, f.model_version_id, f.computed_at, f.p_home, f.p_draw, f.p_away, f.most_likely
         FROM forecast f
        WHERE f.fixture_id = $1 AND f.status = 'available'
          AND NOT EXISTS (SELECT 1 FROM evaluation e WHERE e.forecast_id = f.id)
        ORDER BY f.version_number`,
      [fixtureId],
    );
    return rows.map((row) => ({
      forecastId: row.id,
      modelVersionId: row.model_version_id,
      computedAt: row.computed_at,
      probabilities: {
        home: Number(row.p_home),
        draw: Number(row.p_draw),
        away: Number(row.p_away),
      },
      mostLikely: row.most_likely,
    }));
  }

  /** Inserts one evaluation; returns false when the version already has one. */
  async record(
    version: UnevaluatedVersion,
    fixture: FixtureResult,
    actual: { home: number; away: number },
    scored: Scored,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO evaluation (
         forecast_id, fixture_id, model_version_id, actual_home, actual_away, outcome,
         pre_kickoff, p_outcome, log_loss, brier, correct, scoreline_hit
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (forecast_id) DO NOTHING`,
      [
        version.forecastId,
        fixture.id,
        version.modelVersionId,
        actual.home,
        actual.away,
        scored.outcome,
        version.computedAt < fixture.kickoffAt,
        scored.p_outcome,
        scored.log_loss,
        scored.brier,
        scored.correct,
        scored.scoreline_hit,
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async evaluations(fixtureId: string): Promise<ForecastEvaluation[]> {
    const { rows } = await this.pool.query<EvaluationRow>(
      `${SELECT} WHERE e.fixture_id = $1 ORDER BY f.version_number`,
      [fixtureId],
    );
    return rows.map(toEvaluation);
  }

  async competitionExists(competitionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM competition WHERE id = $1', [
      competitionId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  /** Pre-kick-off evaluations only, grouped by model version and forecast kind. */
  async performanceRows(
    competitionId: string,
    seasonId: string | null,
  ): Promise<ModelPerformanceRow[]> {
    const { rows } = await this.pool.query<{
      model_id: string;
      kind: ForecastKind;
      versions_evaluated: string;
      fixtures_evaluated: string;
      log_loss: string;
      brier: string;
      accuracy: string;
      scoreline_accuracy: string;
    }>(
      `SELECT m.model_id, s.kind,
              COUNT(*)::text AS versions_evaluated,
              COUNT(DISTINCT e.fixture_id)::text AS fixtures_evaluated,
              ROUND(AVG(e.log_loss), 6)::text AS log_loss,
              ROUND(AVG(e.brier), 6)::text AS brier,
              ROUND(AVG(e.correct::int), 4)::text AS accuracy,
              ROUND(AVG(e.scoreline_hit::int), 4)::text AS scoreline_accuracy
         FROM evaluation e
         JOIN forecast f ON f.id = e.forecast_id
         JOIN input_snapshot s ON s.id = f.input_snapshot_id
         JOIN model_version m ON m.id = f.model_version_id
        WHERE e.pre_kickoff
          AND e.fixture_id IN (SELECT fx.id FROM ${IN_SCOPE})
        GROUP BY m.model_id, s.kind
        ORDER BY m.model_id, s.kind`,
      [competitionId, seasonId],
    );
    return rows.map((row) => ({
      model_version: row.model_id,
      kind: row.kind,
      versions_evaluated: Number(row.versions_evaluated),
      fixtures_evaluated: Number(row.fixtures_evaluated),
      log_loss: Number(row.log_loss),
      brier: Number(row.brier),
      accuracy: Number(row.accuracy),
      scoreline_accuracy: Number(row.scoreline_accuracy),
    }));
  }

  async performanceTotals(
    competitionId: string,
    seasonId: string | null,
  ): Promise<PerformanceTotals> {
    const { rows } = await this.pool.query<{
      finished_fixtures: string;
      fixtures_evaluated: string;
      unavailable_versions: string;
      post_kickoff_versions: string;
      last_updated_at: Date | null;
    }>(
      `WITH scope AS (SELECT fx.id, fx.status FROM ${IN_SCOPE})
       SELECT (SELECT COUNT(*) FROM scope WHERE status = 'finished')::text AS finished_fixtures,
              (SELECT COUNT(DISTINCT e.fixture_id) FROM evaluation e
                WHERE e.pre_kickoff AND e.fixture_id IN (SELECT id FROM scope))::text
                AS fixtures_evaluated,
              (SELECT COUNT(*) FROM forecast f
                WHERE f.status = 'unavailable' AND f.fixture_id IN (SELECT id FROM scope))::text
                AS unavailable_versions,
              (SELECT COUNT(*) FROM evaluation e
                WHERE NOT e.pre_kickoff AND e.fixture_id IN (SELECT id FROM scope))::text
                AS post_kickoff_versions,
              (SELECT MAX(e.evaluated_at) FROM evaluation e
                WHERE e.fixture_id IN (SELECT id FROM scope)) AS last_updated_at`,
      [competitionId, seasonId],
    );
    const row = rows[0];
    return {
      finishedFixtures: Number(row?.finished_fixtures ?? 0),
      fixturesEvaluated: Number(row?.fixtures_evaluated ?? 0),
      unavailableVersions: Number(row?.unavailable_versions ?? 0),
      postKickoffVersions: Number(row?.post_kickoff_versions ?? 0),
      lastUpdatedAt: row?.last_updated_at ?? null,
    };
  }
}
