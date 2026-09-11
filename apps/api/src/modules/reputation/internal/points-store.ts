import { Inject, Injectable } from '@nestjs/common';
import type { PointsReason, PointsTransaction } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { Award } from './points';

/** SQL for the Career Points ledger (D-025). Insert-only, one award per settlement and reason. */
@Injectable()
export class PostgresPointsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Inserts the awards not yet in the ledger; returns how many were new. */
  async award(userId: string, awards: readonly Award[], ruleVersion: string): Promise<number> {
    if (awards.length === 0) return 0;
    const { rowCount } = await this.pool.query(
      `INSERT INTO points_transaction (user_id, settlement_id, reason, points, rule_version)
       SELECT $1, s.settlement_id, s.reason, s.points, $2
         FROM unnest($3::uuid[], $4::text[], $5::integer[]) AS s(settlement_id, reason, points)
       ON CONFLICT (settlement_id, reason) DO NOTHING`,
      [
        userId,
        ruleVersion,
        awards.map((a) => a.settlementId),
        awards.map((a) => a.reason),
        awards.map((a) => a.points),
      ],
    );
    return rowCount ?? 0;
  }

  async total(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(points), 0)::text AS total FROM points_transaction WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async recent(userId: string, limit: number): Promise<PointsTransaction[]> {
    const { rows } = await this.pool.query<{
      id: string;
      settlement_id: string;
      reason: PointsReason;
      points: number;
      rule_version: string;
      awarded_at: Date;
    }>(
      `SELECT id, settlement_id, reason, points, rule_version, awarded_at
         FROM points_transaction WHERE user_id = $1
        ORDER BY awarded_at DESC, id DESC LIMIT $2`,
      [userId, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      settlement_id: r.settlement_id,
      reason: r.reason,
      points: r.points,
      rule_version: r.rule_version,
      awarded_at: r.awarded_at.toISOString(),
    }));
  }
}
