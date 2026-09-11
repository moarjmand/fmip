import { Inject, Injectable } from '@nestjs/common';
import type { Settlement, SettlementVoidReason } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface FixtureFinal {
  id: string;
  status: string;
  fullTime: { home: number; away: number } | null;
}

/** A prediction as settlement sees it: its final version and its current settlement, if any. */
export interface Settleable {
  predictionId: string;
  versionId: string;
  versionNumber: number;
  outcome: 'home' | 'draw' | 'away';
  score: { home: number; away: number } | null;
  confidence: number;
  current: { status: 'settled' | 'void'; voidReason: SettlementVoidReason | null } | null;
}

export interface NewSettlement {
  predictionId: string;
  versionId: string;
  status: 'settled' | 'void';
  voidReason: SettlementVoidReason | null;
  actual: { home: number; away: number } | null;
  outcomeCorrect: boolean | null;
  scorePredicted: boolean;
  scoreCorrect: boolean | null;
  confidence: number;
}

interface SettlementRow {
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
}

export const toSettlement = (row: SettlementRow): Settlement => ({
  id: row.id,
  status: row.status,
  void_reason: row.void_reason,
  actual:
    row.actual_home !== null && row.actual_away !== null
      ? { home: row.actual_home, away: row.actual_away }
      : null,
  outcome_correct: row.outcome_correct,
  score_predicted: row.score_predicted,
  score_correct: row.score_correct,
  confidence: row.confidence,
  settled_at: row.settled_at.toISOString(),
  version_number: row.version_number,
});

const SELECT = `
  SELECT s.id, s.status, s.void_reason, s.actual_home, s.actual_away, s.outcome_correct,
         s.score_predicted, s.score_correct, s.confidence, s.settled_at, v.version_number
    FROM settlement s JOIN prediction_version v ON v.id = s.version_id`;

/** SQL for settlement (D-025). Rows are only ever inserted; each run is recorded. */
@Injectable()
export class PostgresSettlementStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureFinal(fixtureId: string): Promise<FixtureFinal | null> {
    const { rows } = await this.pool.query<{
      id: string;
      status: string;
      home: number | null;
      away: number | null;
    }>(
      `SELECT f.id, f.status, sc.home, sc.away
         FROM fixture f
         LEFT JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      status: row.status,
      fullTime: row.home === null || row.away === null ? null : { home: row.home, away: row.away },
    };
  }

  /** Every prediction on the fixture with its final version and current settlement. */
  async settleables(fixtureId: string): Promise<Settleable[]> {
    const { rows } = await this.pool.query<{
      prediction_id: string;
      version_id: string;
      version_number: number;
      outcome: 'home' | 'draw' | 'away';
      home_goals: number | null;
      away_goals: number | null;
      confidence: number;
      current_status: 'settled' | 'void' | null;
      current_reason: SettlementVoidReason | null;
    }>(
      `SELECT p.id AS prediction_id, v.id AS version_id, v.version_number, v.outcome,
              v.home_goals, v.away_goals, v.confidence,
              s.status AS current_status, s.void_reason AS current_reason
         FROM user_prediction p
         JOIN LATERAL (
           SELECT * FROM prediction_version pv
            WHERE pv.prediction_id = p.id ORDER BY pv.version_number DESC LIMIT 1
         ) v ON true
         LEFT JOIN LATERAL (
           SELECT st.status, st.void_reason FROM settlement st
            WHERE st.prediction_id = p.id ORDER BY st.settled_at DESC, st.id DESC LIMIT 1
         ) s ON true
        WHERE p.fixture_id = $1
        ORDER BY p.created_at, p.id`,
      [fixtureId],
    );
    return rows.map((r) => ({
      predictionId: r.prediction_id,
      versionId: r.version_id,
      versionNumber: r.version_number,
      outcome: r.outcome,
      score:
        r.home_goals !== null && r.away_goals !== null
          ? { home: r.home_goals, away: r.away_goals }
          : null,
      confidence: r.confidence,
      current:
        r.current_status === null
          ? null
          : { status: r.current_status, voidReason: r.current_reason },
    }));
  }

  /** One run: the run row plus every new settlement, in one transaction. */
  async record(
    fixtureId: string,
    rows: NewSettlement[],
    unchanged: number,
  ): Promise<{ runId: string }> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const run = await client.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id, settled, voided, unchanged)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          fixtureId,
          rows.filter((r) => r.status === 'settled').length,
          rows.filter((r) => r.status === 'void').length,
          unchanged,
        ],
      );
      const runId = run.rows[0]?.id;
      if (runId === undefined) throw new Error('settlement_run insert returned no row');
      for (const r of rows) {
        await client.query(
          `INSERT INTO settlement (run_id, prediction_id, version_id, fixture_id, status, void_reason,
                                   actual_home, actual_away, outcome_correct, score_predicted,
                                   score_correct, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            runId,
            r.predictionId,
            r.versionId,
            fixtureId,
            r.status,
            r.voidReason,
            r.actual?.home ?? null,
            r.actual?.away ?? null,
            r.outcomeCorrect,
            r.scorePredicted,
            r.scoreCorrect,
            r.confidence,
          ],
        );
      }
      await client.query('COMMIT');
      return { runId };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** The current (newest) settlement of one prediction, or null. */
  async currentFor(predictionId: string): Promise<Settlement | null> {
    const { rows } = await this.pool.query<SettlementRow>(
      `${SELECT} WHERE s.prediction_id = $1 ORDER BY s.settled_at DESC, s.id DESC LIMIT 1`,
      [predictionId],
    );
    const row = rows[0];
    return row === undefined ? null : toSettlement(row);
  }

  /** Every settlement row for the fixture, newest first per prediction. */
  async forFixture(fixtureId: string): Promise<(Settlement & { prediction_id: string })[]> {
    const { rows } = await this.pool.query<SettlementRow & { prediction_id: string }>(
      `${SELECT.replace('SELECT s.id,', 'SELECT s.prediction_id, s.id,')}
        WHERE s.fixture_id = $1 ORDER BY s.prediction_id, s.settled_at DESC, s.id DESC`,
      [fixtureId],
    );
    return rows.map((row) => ({ ...toSettlement(row), prediction_id: row.prediction_id }));
  }

  /** Fixtures that are final and have at least one prediction without a current settlement matching their state. */
  async due(limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT DISTINCT f.id
         FROM fixture f
         JOIN user_prediction p ON p.fixture_id = f.id
         LEFT JOIN LATERAL (
           SELECT st.status FROM settlement st
            WHERE st.prediction_id = p.id ORDER BY st.settled_at DESC, st.id DESC LIMIT 1
         ) s ON true
        WHERE f.status IN ('finished', 'postponed', 'abandoned', 'cancelled', 'awarded')
          AND (s.status IS NULL OR (s.status = 'void' AND f.status = 'finished'))
        ORDER BY f.id
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }
}
