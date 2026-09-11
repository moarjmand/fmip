import { Inject, Injectable } from '@nestjs/common';
import type {
  Prediction,
  PredictionHistoryItem,
  PredictionOutcome,
  PredictionReasonTag,
  PredictionVersion,
  Settlement,
  SettlementVoidReason,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { PredictionInput } from './validation';

export interface FixtureLock {
  id: string;
  kickoffAt: Date;
  status: string;
}

interface VersionRow {
  id: string;
  version_number: number;
  outcome: PredictionOutcome;
  home_goals: number | null;
  away_goals: number | null;
  confidence: number;
  reason_tags: PredictionReasonTag[];
  explanation: string | null;
  submitted_at: Date;
}

const toVersion = (row: VersionRow): PredictionVersion => ({
  id: row.id,
  version_number: row.version_number,
  outcome: row.outcome,
  score:
    row.home_goals !== null && row.away_goals !== null
      ? { home: row.home_goals, away: row.away_goals }
      : null,
  confidence: row.confidence,
  reason_tags: row.reason_tags,
  explanation: row.explanation,
  submitted_at: row.submitted_at.toISOString(),
});

/** SQLSTATE raised by refuse_prediction_after_kickoff() (migration 1758900000000). */
export const LOCKED_SQLSTATE = 'PL001';

export class PredictionLockedError extends Error {
  constructor() {
    super('predictions are locked at kick-off');
    this.name = 'PredictionLockedError';
  }
}

/** SQL for the predictions boundary (D-025). Versions are only ever inserted. */
@Injectable()
export class PostgresPredictionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureLock(fixtureId: string): Promise<FixtureLock | null> {
    const { rows } = await this.pool.query<{ id: string; kickoff_at: Date; status: string }>(
      `SELECT id, kickoff_at, status FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    return row === undefined ? null : { id: row.id, kickoffAt: row.kickoff_at, status: row.status };
  }

  /**
   * Writes the next version inside one transaction: the prediction row is
   * created on first submission and only touched (updated_at) afterwards;
   * the version number is MAX + 1 under the row's lock, so two submissions
   * racing each other cannot share a number.
   */
  async submit(userId: string, fixtureId: string, input: PredictionInput): Promise<Prediction> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upsert = await client.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2)
           ON CONFLICT (user_id, fixture_id) DO UPDATE SET updated_at = now()
           RETURNING id`,
        [userId, fixtureId],
      );
      const predictionId = upsert.rows[0]?.id;
      if (predictionId === undefined) throw new Error('user_prediction upsert returned no row');
      await client.query(`SELECT id FROM user_prediction WHERE id = $1 FOR UPDATE`, [predictionId]);
      await client.query(
        `INSERT INTO prediction_version
           (prediction_id, version_number, outcome, home_goals, away_goals, confidence, reason_tags, explanation)
         SELECT $1, COALESCE(MAX(version_number), 0) + 1, $2, $3, $4, $5, $6::text[], $7
           FROM prediction_version WHERE prediction_id = $1`,
        [
          predictionId,
          input.outcome,
          input.score?.home ?? null,
          input.score?.away ?? null,
          input.confidence,
          input.reasonTags,
          input.explanation,
        ],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === LOCKED_SQLSTATE) throw new PredictionLockedError();
      throw error;
    } finally {
      client.release();
    }
    const prediction = await this.find(userId, fixtureId);
    if (prediction === null) throw new Error('prediction vanished after submit');
    return prediction;
  }

  async find(userId: string, fixtureId: string): Promise<Prediction | null> {
    const { rows } = await this.pool.query<{ id: string; kickoff_at: Date; locked: boolean }>(
      `SELECT p.id, f.kickoff_at, (f.kickoff_at <= now()) AS locked
         FROM user_prediction p JOIN fixture f ON f.id = p.fixture_id
        WHERE p.user_id = $1 AND p.fixture_id = $2`,
      [userId, fixtureId],
    );
    const head = rows[0];
    if (head === undefined) return null;
    const versions = await this.pool.query<VersionRow>(
      `SELECT id, version_number, outcome, home_goals, away_goals, confidence, reason_tags,
              explanation, submitted_at
         FROM prediction_version WHERE prediction_id = $1 ORDER BY version_number`,
      [head.id],
    );
    const list = versions.rows.map(toVersion);
    const latest = list.at(-1);
    if (latest === undefined) return null;
    const settlement = await this.currentSettlement(head.id);
    return {
      id: head.id,
      fixture_id: fixtureId,
      locks_at: head.kickoff_at.toISOString(),
      locked: head.locked,
      latest,
      versions: list,
      settlement,
    };
  }

  /**
   * A member's predictions, newest kick-off first (T-056), with the fixture
   * as the match centre names it, every version and the current settlement.
   * `total` counts the whole history; the page is `limit` from `offset`.
   */
  async history(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; items: PredictionHistoryItem[] }> {
    const counted = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_prediction WHERE user_id = $1`,
      [userId],
    );
    const total = Number(counted.rows[0]?.n ?? 0);
    if (total === 0) return { total, items: [] };

    const { rows } = await this.pool.query<{
      id: string;
      fixture_id: string;
      kickoff_at: Date;
      locked: boolean;
      status: string;
      competition_id: string;
      competition_name: string;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      score_home: number | null;
      score_away: number | null;
    }>(
      `SELECT p.id, p.fixture_id, f.kickoff_at, (f.kickoff_at <= now()) AS locked, f.status,
              c.id AS competition_id, c.name AS competition_name,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(ft.home, cur.home) AS score_home, COALESCE(ft.away, cur.away) AS score_away
         FROM user_prediction p
         JOIN fixture f ON f.id = p.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
        WHERE p.user_id = $1
        ORDER BY f.kickoff_at DESC, p.id
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    if (rows.length === 0) return { total, items: [] };

    const ids = rows.map((r) => r.id);
    const versions = await this.pool.query<VersionRow & { prediction_id: string }>(
      `SELECT prediction_id, id, version_number, outcome, home_goals, away_goals, confidence,
              reason_tags, explanation, submitted_at
         FROM prediction_version WHERE prediction_id = ANY($1::uuid[])
        ORDER BY prediction_id, version_number`,
      [ids],
    );
    const byPrediction = new Map<string, PredictionVersion[]>();
    for (const row of versions.rows) {
      const list = byPrediction.get(row.prediction_id) ?? [];
      list.push(toVersion(row));
      byPrediction.set(row.prediction_id, list);
    }

    const items: PredictionHistoryItem[] = [];
    for (const r of rows) {
      const list = byPrediction.get(r.id) ?? [];
      const latest = list.at(-1);
      if (latest === undefined) continue;
      items.push({
        fixture: {
          id: r.fixture_id,
          kickoff_at: r.kickoff_at.toISOString(),
          status: r.status,
          competition: { id: r.competition_id, name: r.competition_name },
          home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
          away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
          score:
            r.score_home !== null && r.score_away !== null
              ? { home: r.score_home, away: r.score_away }
              : null,
        },
        prediction: {
          id: r.id,
          fixture_id: r.fixture_id,
          locks_at: r.kickoff_at.toISOString(),
          locked: r.locked,
          latest,
          versions: list,
          settlement: await this.currentSettlement(r.id),
        },
      });
    }
    return { total, items };
  }

  /** The newest settlement row of a prediction (T-052), or null. */
  private async currentSettlement(predictionId: string): Promise<Settlement | null> {
    const { rows } = await this.pool.query<{
      id: string;
      status: 'settled' | 'void';
      void_reason: SettlementVoidReason | null;
      actual_home: number | null;
      actual_away: number | null;
      outcome_correct: boolean | null;
      score_predicted: boolean;
      score_correct: boolean | null;
      confidence: number;
      settled_at: Date;
      version_number: number;
    }>(
      `SELECT s.id, s.status, s.void_reason, s.actual_home, s.actual_away, s.outcome_correct,
              s.score_predicted, s.score_correct, s.confidence, s.settled_at, v.version_number
         FROM settlement s JOIN prediction_version v ON v.id = s.version_id
        WHERE s.prediction_id = $1 ORDER BY s.settled_at DESC, s.id DESC LIMIT 1`,
      [predictionId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      status: r.status,
      void_reason: r.void_reason,
      actual:
        r.actual_home !== null && r.actual_away !== null
          ? { home: r.actual_home, away: r.actual_away }
          : null,
      outcome_correct: r.outcome_correct,
      score_predicted: r.score_predicted,
      score_correct: r.score_correct,
      confidence: r.confidence,
      settled_at: r.settled_at.toISOString(),
      version_number: r.version_number,
    };
  }
}
