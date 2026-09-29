import { Inject, Injectable } from '@nestjs/common';
import type {
  ForecastKind,
  ForecastSummary,
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
  /**
   * Whether its clubs can come from different leagues -- a cup, or anything
   * that is not a domestic league -- so that no division could describe it
   * (T-503).
   */
  mixesLeagues: boolean;
}

export interface NewForecast {
  fixtureId: string;
  kind: ForecastKind;
  /**
   * `published` for the version the product shows; `shadow` for a candidate
   * computed beside it and shown nowhere (T-531). Absent means published.
   */
  role?: 'published' | 'shadow';
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
  model_inputs: ModelInputs | null;
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
    inputs: row.model_inputs,
    unavailable_reason: available ? null : row.unavailable_reason,
    unavailable_detail: available ? null : row.unavailable_detail,
  };
}

/** One candidate's answering, as `candidateShadow` reads it (T-1165). */
export interface CandidateShadowRow {
  modelVersion: string;
  firstAt: Date;
  lastAt: Date;
  dayAsked: number;
  dayFailed: number;
  lastFailure: { at: Date; fixtureId: string } | null;
}

/**
 * How long after a published version a candidate's answer to the same
 * question is looked for, and how long before (the model service's clock
 * stamps an answer, the API's a refusal it never received). Both are asked in
 * the same call (`ForecastService.compute`), seconds apart; two published
 * versions of one fixture and kind are hours apart (T-120).
 */
const SHADOW_MATCH_BEFORE = '2 minutes';
const SHADOW_MATCH_AFTER = '15 minutes';

const SELECT = `
  SELECT f.id, f.fixture_id, f.version_number, s.kind, m.model_id, f.computed_at, f.status,
         f.p_home, f.p_draw, f.p_away, f.expected_home_goals, f.expected_away_goals,
         f.most_likely, f.leading_factors, f.data_completeness, s.model_inputs,
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
      mixes_leagues: boolean;
    }>(
      `SELECT f.id, f.kickoff_at, c.id AS competition_id, c.football_data_division AS division,
              (c.kind <> 'league' OR c.scope <> 'domestic') AS mixes_leagues,
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
      mixesLeagues: row.mixes_leagues,
    };
  }

  async versions(fixtureId: string): Promise<ForecastVersion[]> {
    // Published versions only: a shadow candidate is never shown (T-531).
    const { rows } = await this.pool.query<ForecastRow>(
      `${SELECT} WHERE f.fixture_id = $1 AND f.role = 'published' ORDER BY f.version_number`,
      [fixtureId],
    );
    return rows.map(toVersion);
  }

  /**
   * The latest version of each of these fixtures, in one query (T-136).
   *
   * `version_number = MAX(...)` rather than `DISTINCT ON` so the shared
   * `SELECT` above stays untouched: one list of columns, used by both reads,
   * is one place for a column to be added rather than two that can disagree.
   *
   * A fixture with no forecast is simply absent from the result.
   */
  async latestForFixtures(fixtureIds: string[]): Promise<Map<string, ForecastVersion>> {
    const { rows } = await this.pool.query<ForecastRow>(
      `${SELECT}
        WHERE f.fixture_id = ANY($1)
          AND f.role = 'published'
          AND f.version_number = (
            SELECT MAX(later.version_number) FROM forecast later
             WHERE later.fixture_id = f.fixture_id AND later.role = 'published'
          )`,
      [fixtureIds],
    );
    return new Map(rows.map((row) => [row.fixture_id, toVersion(row)]));
  }

  /**
   * The latest published version computed before its fixture's kick-off, for
   * each of these fixtures, in one query (T-940, D-114). Only the columns a
   * summary carries: no input snapshot join, no factors or scorelines.
   *
   * "Before kick-off" is `computed_at < kickoff_at`, the evaluation's own test
   * (`pre_kickoff`, T-066). A fixture with no such version is absent.
   */
  async preKickoffSummaries(fixtureIds: string[]): Promise<Map<string, ForecastSummary>> {
    const { rows } = await this.pool.query<{
      fixture_id: string;
      version_number: number;
      kind: ForecastKind;
      model_id: string;
      computed_at: Date;
      status: 'available' | 'unavailable';
      p_home: string | null;
      p_draw: string | null;
      p_away: string | null;
      unavailable_reason: ForecastUnavailableReason | null;
    }>(
      `SELECT DISTINCT ON (f.fixture_id)
              f.fixture_id, f.version_number, s.kind, m.model_id, f.computed_at, f.status,
              f.p_home, f.p_draw, f.p_away, f.unavailable_reason
         FROM forecast f
         JOIN fixture fx ON fx.id = f.fixture_id
         JOIN input_snapshot s ON s.id = f.input_snapshot_id
         JOIN model_version m ON m.id = f.model_version_id
        WHERE f.fixture_id = ANY($1)
          AND f.role = 'published'
          AND f.computed_at < fx.kickoff_at
        ORDER BY f.fixture_id, f.version_number DESC`,
      [fixtureIds],
    );
    return new Map(
      rows.map((row) => {
        const available = row.status === 'available';
        const summary: ForecastSummary = {
          version_number: row.version_number,
          kind: row.kind,
          model_version: row.model_id,
          computed_at: row.computed_at.toISOString(),
          status: row.status,
          probabilities:
            available && row.p_home !== null && row.p_draw !== null && row.p_away !== null
              ? { home: Number(row.p_home), draw: Number(row.p_draw), away: Number(row.p_away) }
              : null,
          unavailable_reason: available ? null : row.unavailable_reason,
        };
        return [row.fixture_id, summary];
      }),
    );
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

      // The next version number, decided inside the transaction. Published
      // versions count on their own, so a reader never sees a gap; each
      // candidate's shadow versions count within its own model version
      // (T-1102, D-140), so one candidate's record never numbers another's.
      // Two concurrent computations serialise on the unique index: the loser
      // fails and retries, never overwrites.
      const forecast = await client.query<ForecastRow>(
        `INSERT INTO forecast (
           fixture_id, input_snapshot_id, model_version_id, version_number, computed_at, status,
           p_home, p_draw, p_away, expected_home_goals, expected_away_goals,
           most_likely, leading_factors, data_completeness, unavailable_reason, unavailable_detail,
           role
         )
         SELECT $1, $2, $3, COALESCE(MAX(version_number), 0) + 1, $4, $5,
                $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, $16
           FROM forecast
          WHERE fixture_id = $1 AND role = $16 AND ($16 = 'published' OR model_version_id = $3)
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
          input.role ?? 'published',
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

  /**
   * Each shadow model version's answering (T-1165): its first and newest
   * stored version, and against the published versions it was asked for --
   * those the model service answered (a model outage is `model_service`'s
   * condition, and asks no candidate), plus the cups that go to the
   * cross-league scale (T-533) -- from its first stored version on, how many
   * in the last day and which it stored nothing for. `since` bounds the
   * failure looked for; `dayFrom` the day counted; `now` both.
   */
  async candidateShadow(since: Date, dayFrom: Date, now: Date): Promise<CandidateShadowRow[]> {
    const { rows } = await this.pool.query<{
      model_id: string;
      first_at: Date;
      last_at: Date;
      day_asked: number;
      day_failed: number;
      last_failure_at: Date | null;
      last_failure_fixture: string | null;
    }>(
      `WITH cand AS (
         SELECT m.model_id, MIN(f.computed_at) AS first_at, MAX(f.computed_at) AS last_at
           FROM forecast f
           JOIN model_version m ON m.id = f.model_version_id
          WHERE f.role = 'shadow' AND m.model_id <> 'none@0.0.0'
          GROUP BY m.model_id
       ),
       asked AS (
         SELECT p.fixture_id, s.kind, p.computed_at
           FROM forecast p
           JOIN input_snapshot s ON s.id = p.input_snapshot_id
          WHERE p.role = 'published'
            AND p.computed_at >= $1 AND p.computed_at <= $3
            AND (p.unavailable_reason = 'cross_competition'
                 OR (COALESCE(s.request->>'division', '') <> ''
                     AND p.unavailable_reason IS DISTINCT FROM 'model_unreachable'
                     AND p.unavailable_reason IS DISTINCT FROM 'contract_violation'))
       ),
       outcome AS (
         SELECT c.model_id, a.fixture_id, a.computed_at,
                EXISTS (
                  SELECT 1
                    FROM forecast f
                    JOIN input_snapshot fs ON fs.id = f.input_snapshot_id
                    JOIN model_version m ON m.id = f.model_version_id
                   WHERE f.fixture_id = a.fixture_id AND f.role = 'shadow'
                     AND fs.kind = a.kind AND m.model_id = c.model_id
                     AND f.computed_at >= a.computed_at - interval '${SHADOW_MATCH_BEFORE}'
                     AND f.computed_at <= a.computed_at + interval '${SHADOW_MATCH_AFTER}'
                ) AS answered
           FROM cand c
           JOIN asked a ON a.computed_at >= c.first_at - interval '${SHADOW_MATCH_BEFORE}'
       )
       SELECT c.model_id, c.first_at, c.last_at,
              COUNT(o.fixture_id) FILTER (WHERE o.computed_at >= $2)::int AS day_asked,
              COUNT(o.fixture_id) FILTER (WHERE o.computed_at >= $2 AND NOT o.answered)::int
                AS day_failed,
              MAX(o.computed_at) FILTER (WHERE NOT o.answered) AS last_failure_at,
              (ARRAY_AGG(o.fixture_id ORDER BY o.computed_at DESC)
                 FILTER (WHERE NOT o.answered))[1] AS last_failure_fixture
         FROM cand c
         LEFT JOIN outcome o ON o.model_id = c.model_id
        GROUP BY c.model_id, c.first_at, c.last_at
        ORDER BY c.model_id`,
      [since, dayFrom, now],
    );
    return rows.map((row) => ({
      modelVersion: row.model_id,
      firstAt: row.first_at,
      lastAt: row.last_at,
      dayAsked: row.day_asked,
      dayFailed: row.day_failed,
      lastFailure:
        row.last_failure_at === null || row.last_failure_fixture === null
          ? null
          : { at: row.last_failure_at, fixtureId: row.last_failure_fixture },
    }));
  }
}
