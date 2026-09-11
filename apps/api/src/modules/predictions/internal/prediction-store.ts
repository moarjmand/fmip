import { Inject, Injectable } from '@nestjs/common';
import type {
  Prediction,
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
