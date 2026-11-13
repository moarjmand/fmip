import { Inject, Injectable } from '@nestjs/common';
import type {
  AccuracyPeriod,
  ForecastEvaluation,
  ForecastKind,
  ModelPerformanceRow,
  ModelProbabilities,
  ModelScorelineProbability,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { AccuracySumRow } from './model-accuracy';
import { rps, type Scored } from './scoring';

export interface FixtureResult {
  id: string;
  competitionId: string;
  status: string;
  kickoffAt: Date;
  /** The full-time score, or null when none has been recorded. */
  fullTime: { home: number; away: number } | null;
  /**
   * The score after play and the extra-time line (D-317), read so the
   * evaluation answer can tell stored scores that contradict each other
   * (T-1819, D-414); absent where a caller builds a result by hand.
   */
  current?: { home: number; away: number } | null;
  extraTime?: { home: number; away: number } | null;
}

/** An available forecast version with no evaluation yet. */
export interface UnevaluatedVersion {
  forecastId: string;
  modelVersionId: string;
  computedAt: Date;
  probabilities: { home: number; draw: number; away: number };
  mostLikely: ModelScorelineProbability[];
}

/** A fixture's counted evaluation (T-1430), with the probabilities it scored. */
export interface CountedRow {
  /** A published version computed before kick-off is available, scored or not. */
  hasForecast: boolean;
  evaluation: (ForecastEvaluation & { probabilities: ModelProbabilities }) | null;
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
  p_home: string;
  p_draw: string;
  p_away: string;
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
  // Computed when read, from the version's own stored probabilities (D-187).
  rps: rps(
    { home: Number(row.p_home), draw: Number(row.p_draw), away: Number(row.p_away) },
    row.outcome,
  ),
  correct: row.correct,
  scoreline_hit: row.scoreline_hit,
});

/**
 * `rps()` of `scoring.ts` in SQL, over an `evaluation e` joined to its
 * `forecast f` (T-1369, D-187): the cumulative home and home-or-draw
 * probabilities against the result's. `accuracy.http.spec.ts` holds the two
 * definitions to each other.
 */
const rpsSql = (probabilities: string, result: string): string =>
  `(power(${probabilities}.p_home - (${result}.outcome = 'home')::int, 2)
       + power(${probabilities}.p_home + ${probabilities}.p_draw - (${result}.outcome <> 'away')::int, 2)) / 2`;
const RPS_SQL = rpsSql('f', 'e');

/** What a uniform forecast's RPS is on the same result: 1/9 for a draw, 5/18 otherwise. */
const uniformRpsSql = (result: string): string =>
  `CASE ${result}.outcome WHEN 'draw' THEN 1.0 / 9 ELSE 5.0 / 18 END`;
const UNIFORM_RPS_SQL = uniformRpsSql('e');

const SELECT = `
  SELECT e.id, e.forecast_id, e.fixture_id, f.version_number, s.kind, m.model_id, f.computed_at,
         e.evaluated_at, e.pre_kickoff, e.actual_home, e.actual_away, e.outcome,
         e.p_outcome, e.log_loss, e.brier, e.correct, e.scoreline_hit,
         f.p_home, f.p_draw, f.p_away
    FROM evaluation e
    -- Published versions only: a shadow candidate is evaluated, for T-535, and
    -- shown nowhere (T-531).
    JOIN forecast f ON f.id = e.forecast_id AND f.role = 'published'
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
      cur_home: number | null;
      cur_away: number | null;
      et_home: number | null;
      et_away: number | null;
    }>(
      `SELECT f.id, se.competition_id, f.status, f.kickoff_at, sc.home, sc.away,
              cur.home AS cur_home, cur.away AS cur_away, et.home AS et_home, et.away AS et_away
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         LEFT JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
         LEFT JOIN fixture_score et ON et.fixture_id = f.id AND et.kind = 'extra_time'
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    const line = (home: number | null, away: number | null) =>
      home === null || away === null ? null : { home, away };
    return {
      id: row.id,
      competitionId: row.competition_id,
      status: row.status,
      kickoffAt: row.kickoff_at,
      fullTime: line(row.home, row.away),
      current: line(row.cur_home, row.cur_away),
      extraTime: line(row.et_home, row.et_away),
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

  /**
   * Per fixture, the evaluation the accuracy figures count (T-1394, D-209):
   * of the published versions computed before kick-off, the last one -- the
   * same order as `accuracySums` -- with the probabilities it was scored on;
   * and whether any published version computed before kick-off is available
   * at all, so a match whose forecast is not yet scored is told apart from
   * one the model never forecast (T-1430). Read only; nothing is scored here.
   */
  async counted(fixtureIds: string[]): Promise<Map<string, CountedRow>> {
    if (fixtureIds.length === 0) return new Map();
    const { rows } = await this.pool.query<
      { asked_id: string; has_forecast: boolean } & {
        [K in keyof EvaluationRow]: EvaluationRow[K] | null;
      }
    >(
      `SELECT fx.id::text AS asked_id,
              EXISTS (SELECT 1 FROM forecast pf
                       WHERE pf.fixture_id = fx.id AND pf.role = 'published'
                         AND pf.status = 'available' AND pf.computed_at < fx.kickoff_at)
                AS has_forecast,
              c.*
         FROM fixture fx
         LEFT JOIN LATERAL (
           ${SELECT}
            WHERE e.fixture_id = fx.id AND e.pre_kickoff
            ORDER BY f.computed_at DESC, f.id DESC
            LIMIT 1
         ) c ON true
        WHERE fx.id = ANY($1::uuid[])`,
      [fixtureIds],
    );
    return new Map(
      rows.map((row) => [
        row.asked_id,
        {
          hasForecast: row.has_forecast,
          evaluation:
            row.id === null
              ? null
              : {
                  ...toEvaluation(row as unknown as EvaluationRow),
                  probabilities: {
                    home: Number(row.p_home),
                    draw: Number(row.p_draw),
                    away: Number(row.p_away),
                  },
                },
        },
      ]),
    );
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
         JOIN forecast f ON f.id = e.forecast_id AND f.role = 'published'
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
                WHERE f.status = 'unavailable' AND f.role = 'published'
                  AND f.fixture_id IN (SELECT id FROM scope))::text
                AS unavailable_versions,
              (SELECT COUNT(*) FROM evaluation e
                JOIN forecast f ON f.id = e.forecast_id AND f.role = 'published'
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

  /**
   * Sums of the pre-kick-off evaluations (D-031) per competition and per week
   * or month of the match's kick-off, UTC (T-1369). `by_model` keeps each
   * model version in each role apart, shadow included (the console);
   * `published` is the published forecasts only, every version together, with
   * the versions named (the public page). Sums, not means, so the caller can
   * add competitions and periods up without averaging averages; a fixture is
   * in one competition and one period, so match counts add up too.
   *
   * Every sum is over each match's own forecast only -- the last version
   * computed before its kick-off, per model version and role on the console
   * -- so `matches` is the sample of every figure (T-1394, D-209): before,
   * a share of all versions sat beside a count of matches and read as
   * 65.0% of 7. `forecasts` still counts every pre-kick-off version.
   */
  async accuracySums(
    period: AccuracyPeriod,
    scope: 'by_model' | 'published',
  ): Promise<AccuracySumRow[]> {
    // Interpolated, never a parameter: GROUP BY must see the same expression.
    const unit = period === 'week' ? 'week' : 'month';
    const byModel = scope === 'by_model';
    const { rows } = await this.pool.query<{
      role: 'published' | 'shadow' | null;
      model_id: string | null;
      model_ids: string[];
      competition_id: string;
      competition_name: string;
      period_start: string;
      forecasts: number;
      matches: number;
      log_loss: string;
      brier: string;
      rps: string;
      uniform_rps: string;
      correct: number;
      last_evaluated_at: Date;
    }>(
      `WITH scored AS (
         SELECT f.role, m.model_id, co.id AS competition_id, co.name AS competition_name,
                date_trunc('${unit}', fx.kickoff_at AT TIME ZONE 'UTC') AS period,
                e.log_loss, e.brier, e.correct, e.evaluated_at,
                ${RPS_SQL} AS rps,
                ${UNIFORM_RPS_SQL} AS uniform_rps,
                -- The match's own forecast: the last one computed before its
                -- kick-off (for the console, per model version and role).
                row_number() OVER (
                  PARTITION BY e.fixture_id${byModel ? ', f.role, m.model_id' : ''}
                  ORDER BY f.computed_at DESC, f.id DESC) = 1 AS counted
           FROM evaluation e
           JOIN forecast f ON f.id = e.forecast_id
           JOIN model_version m ON m.id = f.model_version_id
           JOIN fixture fx ON fx.id = e.fixture_id
           JOIN season se ON se.id = fx.season_id
           JOIN competition co ON co.id = se.competition_id
          WHERE e.pre_kickoff ${byModel ? '' : `AND f.role = 'published'`}
       )
       SELECT ${byModel ? 's.role, s.model_id' : 'NULL::text AS role, NULL::text AS model_id'},
              COALESCE(array_agg(DISTINCT s.model_id ORDER BY s.model_id)
                         FILTER (WHERE s.counted), '{}') AS model_ids,
              s.competition_id::text AS competition_id, s.competition_name,
              to_char(s.period, 'YYYY-MM-DD') AS period_start,
              COUNT(*)::int AS forecasts,
              (COUNT(*) FILTER (WHERE s.counted))::int AS matches,
              COALESCE(SUM(s.log_loss) FILTER (WHERE s.counted), 0)::text AS log_loss,
              COALESCE(SUM(s.brier) FILTER (WHERE s.counted), 0)::text AS brier,
              COALESCE(SUM(s.rps) FILTER (WHERE s.counted), 0)::text AS rps,
              COALESCE(SUM(s.uniform_rps) FILTER (WHERE s.counted), 0)::text AS uniform_rps,
              (COUNT(*) FILTER (WHERE s.counted AND s.correct))::int AS correct,
              MAX(s.evaluated_at) AS last_evaluated_at
         FROM scored s
        GROUP BY ${byModel ? 's.role, s.model_id, ' : ''}s.competition_id, s.competition_name,
                 s.period
        ORDER BY period_start`,
    );
    return rows.map((row) => ({
      role: row.role,
      modelVersion: row.model_id,
      modelVersions: row.model_ids,
      competition: { id: row.competition_id, name: row.competition_name },
      periodStart: row.period_start,
      forecasts: row.forecasts,
      matches: row.matches,
      logLoss: Number(row.log_loss),
      brier: Number(row.brier),
      rps: Number(row.rps),
      uniformRps: Number(row.uniform_rps),
      correct: row.correct,
      lastEvaluatedAt: row.last_evaluated_at,
    }));
  }

  /**
   * The competitions the model has published a pre-kick-off forecast for
   * (T-1369): the public page lists each, so one with nothing evaluated yet
   * says `not_supplied` instead of being missing.
   *
   * One pass over the forecasts, then the competitions it found (T-1576): as
   * an `EXISTS` per competition, Postgres scanned every forecast once per
   * competition, 51 ms on production's 39 competitions against 7 ms here, on
   * a read the home page makes for every guest.
   */
  async publishedCompetitions(): Promise<{ id: string; name: string }[]> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `WITH published AS MATERIALIZED (
         SELECT DISTINCT se.competition_id
           FROM forecast f
           JOIN fixture fx ON fx.id = f.fixture_id
           JOIN season se ON se.id = fx.season_id
          WHERE f.role = 'published' AND f.status = 'available'
            AND f.computed_at < fx.kickoff_at)
       SELECT co.id::text AS id, co.name
         FROM competition co
         JOIN published p ON p.competition_id = co.id
        ORDER BY co.name, co.id`,
    );
    return rows;
  }

  /**
   * Each shadow model version's counts (T-1103): pre-kick-off forecasts
   * evaluated (the count toward promotion, D-031), pre-kick-off ones not yet
   * evaluated, forecasts made after kick-off, and its refusals.
   */
  async candidateCounts(): Promise<CandidateCounts[]> {
    const { rows } = await this.pool.query<{
      model_id: string;
      evaluated: number;
      awaiting: number;
      after_kickoff: number;
      unavailable: number;
    }>(
      `SELECT m.model_id,
              COUNT(e.id) FILTER (WHERE e.pre_kickoff)::int AS evaluated,
              COUNT(*) FILTER (WHERE e.id IS NULL AND f.status = 'available'
                                 AND f.computed_at < fx.kickoff_at)::int AS awaiting,
              COUNT(*) FILTER (WHERE f.status = 'available'
                                 AND f.computed_at >= fx.kickoff_at)::int AS after_kickoff,
              COUNT(*) FILTER (WHERE f.status = 'unavailable')::int AS unavailable
         FROM forecast f
         JOIN model_version m ON m.id = f.model_version_id
         JOIN fixture fx ON fx.id = f.fixture_id
         LEFT JOIN evaluation e ON e.forecast_id = f.id
        WHERE f.role = 'shadow' AND m.model_id <> 'none@0.0.0'
        GROUP BY m.model_id
        ORDER BY m.model_id`,
    );
    return rows.map((row) => ({
      modelVersion: row.model_id,
      evaluated: row.evaluated,
      awaiting: row.awaiting,
      afterKickoff: row.after_kickoff,
      unavailable: row.unavailable,
    }));
  }

  /**
   * Each shadow model version against the published version on the same
   * matches, per competition (T-1103): a pair is a (fixture, forecast kind)
   * where both have a pre-kick-off evaluation, the latest of each.
   */
  async candidatePairs(): Promise<CandidatePairRow[]> {
    const { rows } = await this.pool.query<{
      model_id: string;
      competition_id: string;
      competition_name: string;
      pairs: number;
      published_versions: string[];
      candidate_log_loss: string;
      candidate_brier: string;
      published_log_loss: string;
      published_brier: string;
    }>(
      `WITH pre AS (
         SELECT f.fixture_id, s.kind, f.role, m.model_id, f.computed_at, e.log_loss, e.brier
           FROM evaluation e
           JOIN forecast f ON f.id = e.forecast_id
           JOIN input_snapshot s ON s.id = f.input_snapshot_id
           JOIN model_version m ON m.id = f.model_version_id
          WHERE e.pre_kickoff
       ),
       cand AS (
         SELECT DISTINCT ON (fixture_id, kind, model_id) *
           FROM pre WHERE role = 'shadow'
          ORDER BY fixture_id, kind, model_id, computed_at DESC
       ),
       pub AS (
         SELECT DISTINCT ON (fixture_id, kind) *
           FROM pre WHERE role = 'published'
          ORDER BY fixture_id, kind, computed_at DESC
       )
       SELECT c.model_id, co.id::text AS competition_id, co.name AS competition_name,
              COUNT(*)::int AS pairs,
              array_agg(DISTINCT p.model_id ORDER BY p.model_id) AS published_versions,
              ROUND(AVG(c.log_loss), 6)::text AS candidate_log_loss,
              ROUND(AVG(c.brier), 6)::text AS candidate_brier,
              ROUND(AVG(p.log_loss), 6)::text AS published_log_loss,
              ROUND(AVG(p.brier), 6)::text AS published_brier
         FROM cand c
         JOIN pub p ON p.fixture_id = c.fixture_id AND p.kind = c.kind
         JOIN fixture fx ON fx.id = c.fixture_id
         JOIN season se ON se.id = fx.season_id
         JOIN competition co ON co.id = se.competition_id
        GROUP BY c.model_id, co.id, co.name
        ORDER BY c.model_id, co.name`,
    );
    return rows.map((row) => ({
      modelVersion: row.model_id,
      competition: { id: row.competition_id, name: row.competition_name },
      pairs: row.pairs,
      publishedVersions: row.published_versions,
      candidate: { log_loss: Number(row.candidate_log_loss), brier: Number(row.candidate_brier) },
      published: { log_loss: Number(row.published_log_loss), brier: Number(row.published_brier) },
    }));
  }

  // --- The console's model page (T-1729, D-355) -------------------------------

  /** The model version of the newest published forecast: what the site shows now. */
  async newestPublishedModel(): Promise<string | null> {
    const { rows } = await this.pool.query<{ model_id: string }>(
      `SELECT m.model_id
         FROM forecast f JOIN model_version m ON m.id = f.model_version_id
        WHERE f.role = 'published' AND f.status = 'available' AND m.model_id <> 'none@0.0.0'
        ORDER BY f.computed_at DESC, f.id DESC
        LIMIT 1`,
    );
    return rows[0]?.model_id ?? null;
  }

  /** Shadow versions that stored a forecast since `since`, by name. */
  async recentShadowModels(since: Date): Promise<string[]> {
    const { rows } = await this.pool.query<{ model_id: string }>(
      `SELECT DISTINCT m.model_id
         FROM forecast f JOIN model_version m ON m.id = f.model_version_id
        WHERE f.role = 'shadow' AND f.computed_at >= $1 AND m.model_id <> 'none@0.0.0'
        ORDER BY m.model_id`,
      [since],
    );
    return rows.map((row) => row.model_id);
  }

  /**
   * What every version stored in each role (T-1752, D-371): its first and
   * last forecast with probabilities, and its forecasts counted by what
   * became of them -- scored, waiting for a result, made after kick-off
   * (never counted in a figure), refused.
   */
  async versionCounts(): Promise<VersionCountsRow[]> {
    const { rows } = await this.pool.query<{
      role: 'published' | 'shadow';
      model_id: string;
      first: Date | null;
      last: Date | null;
      forecasts: number;
      evaluated: number;
      awaiting: number;
      after_kickoff: number;
      unavailable: number;
    }>(
      `SELECT f.role, m.model_id,
              MIN(f.computed_at) FILTER (WHERE f.status = 'available') AS first,
              MAX(f.computed_at) FILTER (WHERE f.status = 'available') AS last,
              (COUNT(*) FILTER (WHERE f.status = 'available'))::int AS forecasts,
              (COUNT(e.id) FILTER (WHERE e.pre_kickoff))::int AS evaluated,
              (COUNT(*) FILTER (WHERE e.id IS NULL AND f.status = 'available'
                                  AND f.computed_at < fx.kickoff_at))::int AS awaiting,
              (COUNT(*) FILTER (WHERE f.status = 'available'
                                  AND f.computed_at >= fx.kickoff_at))::int AS after_kickoff,
              (COUNT(*) FILTER (WHERE f.status = 'unavailable'))::int AS unavailable
         FROM forecast f
         JOIN model_version m ON m.id = f.model_version_id
         JOIN fixture fx ON fx.id = f.fixture_id
         LEFT JOIN evaluation e ON e.forecast_id = f.id
        WHERE m.model_id <> 'none@0.0.0'
        GROUP BY f.role, m.model_id
        ORDER BY f.role, m.model_id`,
    );
    return rows.map((row) => ({
      role: row.role,
      modelVersion: row.model_id,
      first: row.first,
      last: row.last,
      forecasts: row.forecasts,
      evaluated: row.evaluated,
      awaiting: row.awaiting,
      afterKickoff: row.after_kickoff,
      unavailable: row.unavailable,
    }));
  }

  /**
   * Every version's record in each role, per competition and overall (the
   * row with a null competition): each match once, by the version's last
   * pre-kick-off forecast in that role (D-209, as `accuracySums`), with the
   * standard deviations the page's intervals need.
   */
  async versionRecords(): Promise<VersionRecordRow[]> {
    const { rows } = await this.pool.query<
      RawRecordRow & { role: 'published' | 'shadow'; model_id: string }
    >(
      `WITH counted AS (${COUNTED_ALL})
       SELECT c.role, c.model_id, c.competition_id::text AS competition_id,
              co.name AS competition_name, ${RECORD_COLUMNS}
         FROM counted c JOIN competition co ON co.id = c.competition_id
        GROUP BY GROUPING SETS ((c.role, c.model_id, c.competition_id, co.name),
                                (c.role, c.model_id))
        ORDER BY c.role, c.model_id, competition_name NULLS FIRST`,
    );
    return rows.map((row) => ({
      role: row.role,
      modelVersion: row.model_id,
      ...toRecordRow(row),
    }));
  }

  /**
   * Every version's calibration in each role (T-1729, T-1752): each
   * outcome's forecast probability in ten-point bands, how many, the mean
   * said and the share that happened -- the model watch's query, over each
   * match's own forecast.
   */
  async versionCalibration(): Promise<VersionCalibrationRow[]> {
    const { rows } = await this.pool.query<{
      role: 'published' | 'shadow';
      model_id: string;
      outcome: 'home' | 'draw' | 'away';
      band: number;
      forecasts: number;
      said: string;
      seen: number;
    }>(
      `WITH counted AS (${COUNTED_ALL})
       SELECT c.role, c.model_id, o.outcome, LEAST(floor(o.p * 10), 9)::int AS band,
              COUNT(*)::int AS forecasts, AVG(o.p)::text AS said,
              (COUNT(*) FILTER (WHERE c.outcome::text = o.outcome))::int AS seen
         FROM counted c
        CROSS JOIN LATERAL (VALUES ('home', c.p_home::float8), ('draw', c.p_draw::float8),
                                   ('away', c.p_away::float8)) o(outcome, p)
        GROUP BY 1, 2, 3, 4
        ORDER BY 1, 2, 3, 4`,
    );
    return rows.map((row) => ({
      role: row.role,
      modelVersion: row.model_id,
      outcome: row.outcome,
      band: row.band,
      forecasts: row.forecasts,
      said: Number(row.said),
      seen: row.seen,
    }));
  }

  /**
   * Every two versions on the matches both scored before kick-off (the model
   * watch's paired read, for all of them at once; T-1752): per fixture each
   * side's last pre-kick-off forecast, overall (a null competition) and per
   * competition. Each pair comes once, `a` the greater by name then role;
   * the caller decides which side is the subject.
   */
  async versionPairs(): Promise<VersionPairRow[]> {
    const { rows } = await this.pool.query<{
      a_role: 'published' | 'shadow';
      a_model: string;
      b_role: 'published' | 'shadow';
      b_model: string;
      competition_id: string | null;
      competition_name: string | null;
      matches: number;
      identical: number;
      a_log_loss: string;
      b_log_loss: string;
      a_brier: string;
      b_brier: string;
      a_rps: string;
      b_rps: string;
      a_correct: number;
      b_correct: number;
      difference: string;
      difference_sd: string | null;
    }>(
      `WITH counted AS MATERIALIZED (${COUNTED_ALL})
       SELECT a.role AS a_role, a.model_id AS a_model, b.role AS b_role, b.model_id AS b_model,
              a.competition_id::text AS competition_id, co.name AS competition_name,
              COUNT(*)::int AS matches,
              -- The same three probabilities, not merely the same log loss.
              (COUNT(*) FILTER (WHERE a.p_home = b.p_home AND a.p_draw = b.p_draw
                                  AND a.p_away = b.p_away))::int AS identical,
              AVG(a.log_loss)::text AS a_log_loss, AVG(b.log_loss)::text AS b_log_loss,
              AVG(a.brier)::text AS a_brier, AVG(b.brier)::text AS b_brier,
              AVG(${rpsSql('a', 'a')})::text AS a_rps, AVG(${rpsSql('b', 'b')})::text AS b_rps,
              (COUNT(*) FILTER (WHERE a.correct))::int AS a_correct,
              (COUNT(*) FILTER (WHERE b.correct))::int AS b_correct,
              AVG(a.log_loss - b.log_loss)::text AS difference,
              STDDEV_SAMP(a.log_loss - b.log_loss)::text AS difference_sd
         FROM counted a
         JOIN counted b ON b.fixture_id = a.fixture_id
                       AND (a.model_id, a.role::text) > (b.model_id, b.role::text)
         JOIN competition co ON co.id = a.competition_id
        GROUP BY GROUPING SETS (
                   (a.role, a.model_id, b.role, b.model_id, a.competition_id, co.name),
                   (a.role, a.model_id, b.role, b.model_id))
        ORDER BY a.model_id, a.role, b.model_id, b.role, competition_name NULLS FIRST`,
    );
    return rows.map((row) => ({
      a: { role: row.a_role, modelVersion: row.a_model },
      b: { role: row.b_role, modelVersion: row.b_model },
      competition:
        row.competition_id === null
          ? null
          : { id: row.competition_id, name: row.competition_name ?? '' },
      matches: row.matches,
      identical: row.identical,
      aLogLoss: Number(row.a_log_loss),
      bLogLoss: Number(row.b_log_loss),
      aBrier: Number(row.a_brier),
      bBrier: Number(row.b_brier),
      aRps: Number(row.a_rps),
      bRps: Number(row.b_rps),
      aCorrect: row.a_correct,
      bCorrect: row.b_correct,
      difference: Number(row.difference),
      differenceSd: row.difference_sd === null ? null : Number(row.difference_sd),
    }));
  }

  /**
   * What the store holds of each input a version reads or was tested with
   * (T-1752, D-371), counted as of `now`: the results the fit reads and its
   * cross-league part (`training.match` inside the published version's
   * window), our own Elo's newest run, and -- read by no version, tested in
   * the lab -- expected goals, starting line-ups and absences on the
   * finished matches of the site's own store. A count, never an estimate.
   */
  async modelInputs(now: Date): Promise<ModelInputRow[]> {
    const day = now.toISOString().slice(0, 10);
    const [results, elo, xg, lineups, absences] = await Promise.all([
      this.pool.query<{
        division_key: string;
        matches: number;
        total: number;
        divisions: number | null;
        late: number;
        newest: string | null;
      }>(
        // A division runs late when the site has finished matches of its
        // competition played more than LATE_AFTER_DAYS after the store's newest
        // result: a break in the calendar is not late, a missing round is.
        `WITH played AS (
           SELECT co.football_data_division AS division, MAX(fx.kickoff_at)::date AS newest
             FROM fixture fx
             JOIN season se ON se.id = fx.season_id
             JOIN competition co ON co.id = se.competition_id
            WHERE fx.status = 'finished' AND fx.kickoff_at <= $1::date + 1
              AND co.football_data_division IS NOT NULL
            GROUP BY 1),
         stored AS (
           SELECT division,
                  COUNT(*) FILTER (WHERE match_date >= $1::date - ${MODEL_HISTORY_DAYS}) AS matches,
                  COUNT(*) AS total,
                  MAX(match_date) AS newest
             FROM training.match
            WHERE match_date <= $1::date
            GROUP BY division)
         SELECT CASE WHEN s.division = 'XL' THEN 'cross_league' ELSE 'results' END AS division_key,
                SUM(s.matches)::int AS matches, SUM(s.total)::int AS total,
                (COUNT(*) FILTER (WHERE s.matches > 0))::int AS divisions,
                (COUNT(*) FILTER (WHERE p.newest > s.newest + ${LATE_AFTER_DAYS}))::int AS late,
                to_char(MAX(s.newest), 'YYYY-MM-DD') AS newest
           FROM stored s LEFT JOIN played p ON p.division = s.division
          GROUP BY 1`,
        [day],
      ),
      this.pool.query<{ day: string; club_count: number; computed_at: Date }>(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, club_count::int AS club_count, computed_at
           FROM training.own_elo_run
          ORDER BY computed_at DESC
          LIMIT 1`,
      ),
      this.pool.query<{ finished: number; held: number; newest: Date | null }>(
        `WITH fin AS (
           SELECT id, kickoff_at FROM fixture
            WHERE status = 'finished' AND kickoff_at > $1::timestamptz - interval '90 days'
              AND kickoff_at <= $1),
         held AS (
           SELECT fp.fixture_id
             FROM fixture_stat st
             JOIN fixture_participant fp ON fp.id = st.participant_id
            WHERE st.metric = 'expected_goals' AND st.value IS NOT NULL
              AND fp.fixture_id IN (SELECT id FROM fin)
            GROUP BY fp.fixture_id
           HAVING COUNT(DISTINCT fp.id) >= 2)
         SELECT (SELECT COUNT(*) FROM fin)::int AS finished,
                (SELECT COUNT(*) FROM held)::int AS held,
                (SELECT MAX(fin.kickoff_at) FROM fin JOIN held ON held.fixture_id = fin.id)
                  AS newest`,
        [now],
      ),
      this.pool.query<{ finished: number; held: number; newest: Date | null }>(
        `WITH fin AS (
           SELECT id, kickoff_at FROM fixture
            WHERE status = 'finished' AND kickoff_at > $1::timestamptz - interval '30 days'
              AND kickoff_at <= $1),
         held AS (
           SELECT fp.fixture_id
             FROM lineup l
             JOIN fixture_participant fp ON fp.id = l.participant_id
            WHERE l.role = 'starter' AND fp.fixture_id IN (SELECT id FROM fin)
            GROUP BY fp.fixture_id
           HAVING COUNT(DISTINCT fp.id) >= 2)
         SELECT (SELECT COUNT(*) FROM fin)::int AS finished,
                (SELECT COUNT(*) FROM held)::int AS held,
                (SELECT MAX(fin.kickoff_at) FROM fin JOIN held ON held.fixture_id = fin.id)
                  AS newest`,
        [now],
      ),
      this.pool.query<{ fixtures: number; newest: Date | null }>(
        `SELECT COUNT(DISTINCT fixture_id)::int AS fixtures, MAX(reported_at) AS newest
           FROM fixture_absence`,
      ),
    ]);
    const noon = (date: string | null) => (date === null ? null : new Date(`${date}T12:00:00Z`));
    const rows: ModelInputRow[] = [];
    for (const key of ['results', 'cross_league'] as const) {
      const row = results.rows.find((r) => r.division_key === key);
      rows.push({
        key,
        count: row?.matches ?? 0,
        of: row?.total ?? 0,
        groups: key === 'results' ? (row?.divisions ?? 0) : null,
        lateGroups: key === 'results' ? (row?.late ?? 0) : null,
        newestAt: noon(row?.newest ?? null),
      });
    }
    const run = elo.rows[0];
    rows.push({
      key: 'own_elo',
      count: run?.club_count ?? 0,
      of: null,
      groups: null,
      newestAt: noon(run?.day ?? null),
    });
    rows.push({
      key: 'expected_goals',
      count: xg.rows[0]?.held ?? 0,
      of: xg.rows[0]?.finished ?? 0,
      groups: null,
      newestAt: xg.rows[0]?.newest ?? null,
    });
    rows.push({
      key: 'lineups',
      count: lineups.rows[0]?.held ?? 0,
      of: lineups.rows[0]?.finished ?? 0,
      groups: null,
      newestAt: lineups.rows[0]?.newest ?? null,
    });
    rows.push({
      key: 'absences',
      count: absences.rows[0]?.fixtures ?? 0,
      of: null,
      groups: null,
      newestAt: absences.rows[0]?.newest ?? null,
    });
    return rows;
  }

  /**
   * What a published version's record does not cover (T-1752): the finished
   * matches since its first forecast, in the competitions it has forecast,
   * and how many of them have no published forecast scored before kick-off.
   */
  async unscored(modelId: string): Promise<{ finished: number; without: number } | null> {
    const { rows } = await this.pool.query<{ finished: number; without: number }>(
      `WITH own AS (
         SELECT f.computed_at, se.competition_id
           FROM forecast f
           JOIN model_version m ON m.id = f.model_version_id
           JOIN fixture fx ON fx.id = f.fixture_id
           JOIN season se ON se.id = fx.season_id
          WHERE f.role = 'published' AND f.status = 'available' AND m.model_id = $1),
       fin AS (
         SELECT fx.id
           FROM fixture fx JOIN season se ON se.id = fx.season_id
          WHERE fx.status = 'finished'
            AND fx.kickoff_at >= (SELECT MIN(computed_at) FROM own)
            AND se.competition_id IN (SELECT competition_id FROM own))
       SELECT COUNT(*)::int AS finished,
              (COUNT(*) FILTER (WHERE NOT EXISTS (
                 SELECT 1 FROM evaluation e JOIN forecast f2 ON f2.id = e.forecast_id
                  WHERE e.fixture_id = fin.id AND e.pre_kickoff AND f2.role = 'published')))::int
                AS without
         FROM fin`,
      [modelId],
    );
    return rows[0] ?? null;
  }

  /**
   * How many matches a shadow version scored that no published version
   * forecast before kick-off: its new divisions' count toward D-336's
   * "better than chance" (100). The count alone: the figure is the weekly
   * watch's one look (T-1720, D-371).
   */
  async newDivisionsCount(candidate: string): Promise<number> {
    const { rows } = await this.pool.query<{ matches: number }>(
      `WITH counted AS (${counted('$1', "'shadow'")})
       SELECT COUNT(*)::int AS matches
         FROM counted c
        WHERE NOT EXISTS (
          SELECT 1 FROM evaluation e2 JOIN forecast f2 ON f2.id = e2.forecast_id
           WHERE e2.fixture_id = c.fixture_id AND e2.pre_kickoff AND f2.role = 'published')`,
      [candidate],
    );
    return rows[0]?.matches ?? 0;
  }
}

/**
 * Each match once for one model version in one role: its last forecast
 * computed before kick-off that was evaluated (D-209), with the fixture's
 * competition and kick-off. `model` and `role` are SQL (a placeholder or a
 * literal), never input.
 */
function counted(model: string, role: string): string {
  return `SELECT DISTINCT ON (e.fixture_id) e.fixture_id, e.log_loss, e.brier, e.correct,
                 e.outcome, e.evaluated_at, f.p_home, f.p_draw, f.p_away, fx.kickoff_at,
                 se.competition_id
            FROM evaluation e
            JOIN forecast f ON f.id = e.forecast_id
            JOIN model_version m ON m.id = f.model_version_id
            JOIN fixture fx ON fx.id = e.fixture_id
            JOIN season se ON se.id = fx.season_id
           WHERE e.pre_kickoff AND f.role = ${role} AND m.model_id = ${model}
           ORDER BY e.fixture_id, f.computed_at DESC, f.id DESC`;
}

/**
 * The history window of the published version's fit, in days (`history_days`
 * in its version file, D-190): what "the results the fit reads" is counted
 * over on the console's model page.
 */
export const MODEL_HISTORY_DAYS = 1100;
/**
 * A division's results run late when the site has a finished match of its
 * competition this many days after the store's newest result.
 */
const LATE_AFTER_DAYS = 3;

/**
 * Each match once for every model version in every role (T-1752): as
 * `counted`, for all of them in one pass.
 */
const COUNTED_ALL = `SELECT DISTINCT ON (e.fixture_id, f.role, m.model_id)
                 e.fixture_id, f.role, m.model_id, e.log_loss, e.brier, e.correct,
                 e.outcome, e.evaluated_at, f.p_home, f.p_draw, f.p_away, fx.kickoff_at,
                 f.computed_at, f.data_completeness, se.competition_id
            FROM evaluation e
            JOIN forecast f ON f.id = e.forecast_id
            JOIN model_version m ON m.id = f.model_version_id
            JOIN fixture fx ON fx.id = e.fixture_id
            JOIN season se ON se.id = fx.season_id
           WHERE e.pre_kickoff AND m.model_id <> 'none@0.0.0'
           ORDER BY e.fixture_id, f.role, m.model_id, f.computed_at DESC, f.id DESC`;

const RECORD_COLUMNS = `COUNT(*)::int AS matches,
              AVG(c.log_loss)::text AS log_loss, STDDEV_SAMP(c.log_loss)::text AS log_loss_sd,
              AVG(c.brier)::text AS brier, STDDEV_SAMP(c.brier)::text AS brier_sd,
              AVG(${rpsSql('c', 'c')})::text AS rps,
              STDDEV_SAMP(${rpsSql('c', 'c')})::text AS rps_sd,
              AVG(${uniformRpsSql('c')})::text AS uniform_rps,
              (COUNT(*) FILTER (WHERE c.data_completeness = 'limited'))::int AS limited,
              (percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (c.kickoff_at - c.computed_at)) / 3600))::text
                AS lead_hours,
              (COUNT(*) FILTER (WHERE c.correct))::int AS correct,
              MIN(c.kickoff_at) AS first_kickoff_at, MAX(c.kickoff_at) AS last_kickoff_at,
              MAX(c.evaluated_at) AS last_evaluated_at`;

interface RawRecordRow {
  competition_id: string | null;
  competition_name: string | null;
  matches: number;
  log_loss: string | null;
  log_loss_sd: string | null;
  brier: string | null;
  brier_sd: string | null;
  rps: string | null;
  rps_sd: string | null;
  uniform_rps: string | null;
  limited: number;
  lead_hours: string | null;
  correct: number;
  first_kickoff_at: Date | null;
  last_kickoff_at: Date | null;
  last_evaluated_at: Date | null;
}

const toRecordRow = (row: RawRecordRow): ModelRecordRow => {
  const num = (value: string | null) => (value === null ? null : Number(value));
  return {
    competition:
      row.competition_id === null
        ? null
        : { id: row.competition_id, name: row.competition_name ?? '' },
    matches: row.matches,
    logLoss: num(row.log_loss),
    logLossSd: num(row.log_loss_sd),
    brier: num(row.brier),
    brierSd: num(row.brier_sd),
    rps: num(row.rps),
    rpsSd: num(row.rps_sd),
    uniformRps: num(row.uniform_rps),
    limited: row.limited,
    medianLeadHours: num(row.lead_hours),
    correct: row.correct,
    firstKickoffAt: row.first_kickoff_at,
    lastKickoffAt: row.last_kickoff_at,
    lastEvaluatedAt: row.last_evaluated_at,
  };
};

/** One version's record over a set of matches (T-1729): means, deviations, the window. */
export interface ModelRecordRow {
  /** Null: every competition together. */
  competition: { id: string; name: string } | null;
  matches: number;
  logLoss: number | null;
  logLossSd: number | null;
  brier: number | null;
  brierSd: number | null;
  rps: number | null;
  rpsSd: number | null;
  /** A one-third guess's RPS on the same results. */
  uniformRps: number | null;
  /** How many of the matches were forecast with `limited` data. */
  limited: number;
  /** The median hours from the counted forecast to kick-off. */
  medianLeadHours: number | null;
  correct: number;
  firstKickoffAt: Date | null;
  lastKickoffAt: Date | null;
  lastEvaluatedAt: Date | null;
}

/** What the store holds of one model input now (T-1752). */
export interface ModelInputRow {
  key: 'results' | 'cross_league' | 'own_elo' | 'expected_goals' | 'lineups' | 'absences';
  count: number;
  /** What `count` is a part of, or null where it is not a share. */
  of: number | null;
  groups: number | null;
  /** Divisions in season whose newest result is older than ten days; null where not counted. */
  lateGroups?: number | null;
  newestAt: Date | null;
}

export interface VersionKey {
  role: 'published' | 'shadow';
  modelVersion: string;
}

/** One version's record in one role (T-1752). */
export type VersionRecordRow = ModelRecordRow & VersionKey;

export type VersionCalibrationRow = CalibrationRow & VersionKey;

/** What one version stored in one role, as forecasts (T-1752). */
export interface VersionCountsRow extends VersionKey {
  first: Date | null;
  last: Date | null;
  forecasts: number;
  evaluated: number;
  awaiting: number;
  afterKickoff: number;
  unavailable: number;
}

/** Two versions on the matches both scored (T-1752): means over the shared matches. */
export interface VersionPairRow {
  a: VersionKey;
  b: VersionKey;
  /** Null: every competition together. */
  competition: { id: string; name: string } | null;
  matches: number;
  identical: number;
  aLogLoss: number;
  bLogLoss: number;
  aBrier: number;
  bBrier: number;
  aRps: number;
  bRps: number;
  aCorrect: number;
  bCorrect: number;
  /** `a` minus `b` in log loss, per match. */
  difference: number;
  differenceSd: number | null;
}

export interface CalibrationRow {
  outcome: 'home' | 'draw' | 'away';
  band: number;
  forecasts: number;
  said: number;
  /** How many of `forecasts` the outcome happened in. */
  seen: number;
}

export interface PairedRow {
  matches: number;
  identical: number;
  publishedLogLoss: number | null;
  candidateLogLoss: number | null;
  publishedBrier: number | null;
  candidateBrier: number | null;
  difference: number | null;
  differenceSd: number | null;
}

export interface CandidateCounts {
  modelVersion: string;
  evaluated: number;
  awaiting: number;
  afterKickoff: number;
  unavailable: number;
}

export interface CandidatePairRow {
  modelVersion: string;
  competition: { id: string; name: string };
  pairs: number;
  publishedVersions: string[];
  candidate: { log_loss: number; brier: number };
  published: { log_loss: number; brier: number };
}
