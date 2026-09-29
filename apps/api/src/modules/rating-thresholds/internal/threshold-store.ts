import { Inject, Injectable } from '@nestjs/common';
import {
  RATING_THRESHOLD_MAX_LEAD_DAYS,
  type RatingThresholdValues,
  type RatingThresholdVersion,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { type RatingThresholds, sameValues, valuesOf } from './thresholds';

interface Row {
  version: number;
  provisional_below: number;
  established_at: number;
  contributor_min_rating: string;
  contributor_min_settled: number;
  conduct_window_days: number;
  flag_period_days: number;
  effective_from: Date;
  set_by: string | null;
  reason: string;
  recorded_at: Date;
}

const COLUMNS = `t.version, t.provisional_below, t.established_at, t.contributor_min_rating,
  t.contributor_min_settled, t.conduct_window_days, t.flag_period_days, t.effective_from,
  t.reason, t.recorded_at`;

/** The version in force at `$1` (null: the database's now). */
const IN_FORCE = `SELECT ${COLUMNS}, NULL::text AS set_by
   FROM rating_threshold_version t
  WHERE t.effective_from <= COALESCE($1::timestamptz, now())
  ORDER BY t.effective_from DESC, t.version DESC
  LIMIT 1`;

function thresholdsOf(row: Row): RatingThresholds {
  return {
    version: row.version,
    provisionalBelow: row.provisional_below,
    establishedAt: row.established_at,
    contributorMinRating: Number(row.contributor_min_rating),
    contributorMinSettled: row.contributor_min_settled,
    conductWindowDays: row.conduct_window_days,
    flagPeriodDays: row.flag_period_days,
  };
}

function recordOf(row: Row): RatingThresholdVersion {
  return {
    version: row.version,
    ...valuesOf(thresholdsOf(row)),
    effective_from: row.effective_from.toISOString(),
    set_by: row.set_by,
    reason: row.reason,
    recorded_at: row.recorded_at.toISOString(),
  };
}

export type SupersedeOutcome =
  | { kind: 'recorded'; version: RatingThresholdVersion }
  | { kind: 'past' }
  | { kind: 'too_far' }
  | { kind: 'unchanged'; version: number };

/**
 * SQL for `rating_threshold_version` (T-1160, D-152). Insert-only: the
 * table's trigger refuses an UPDATE or DELETE. A new version and its
 * `audit_log` row, carrying the version it supersedes, are one transaction
 * (rule 10); version numbers are taken under a table lock, so two
 * administrators saving at once get two versions rather than an error.
 */
@Injectable()
export class PostgresRatingThresholdStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The version in force at `at`, or now by the database clock. */
  async inForce(at: Date | null = null): Promise<RatingThresholds> {
    const { rows } = await this.pool.query<Row>(IN_FORCE, [at?.toISOString() ?? null]);
    const row = rows[0];
    // Version 1 starts at the epoch and cannot be deleted, so this is a broken schema.
    if (row === undefined) throw new Error('rating_threshold_version holds no version in force');
    return thresholdsOf(row);
  }

  /** Every version, newest first. */
  async list(): Promise<RatingThresholdVersion[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS}, u.username AS set_by
         FROM rating_threshold_version t
         LEFT JOIN user_account u ON u.id = t.set_by
        ORDER BY t.version DESC`,
    );
    return rows.map(recordOf);
  }

  /**
   * A new version from `effectiveFrom` (null: now). Refused when the start is
   * in the past, more than `RATING_THRESHOLD_MAX_LEAD_DAYS` ahead, or when it
   * would change nothing against the version in force at that start.
   */
  async supersede(
    values: RatingThresholdValues,
    effectiveFrom: string | null,
    actorId: string,
    reason: string,
  ): Promise<SupersedeOutcome> {
    return this.transaction(async (client) => {
      await client.query(`LOCK TABLE rating_threshold_version IN SHARE ROW EXCLUSIVE MODE`);
      const clock = await client.query<{ start: Date; past: boolean; too_far: boolean }>(
        `SELECT s.start, s.start < now() AS past,
                s.start > now() + make_interval(days => $2) AS too_far
           FROM (SELECT COALESCE($1::timestamptz, now()) AS start) s`,
        [effectiveFrom, RATING_THRESHOLD_MAX_LEAD_DAYS],
      );
      const { start, past, too_far } = clock.rows[0]!;
      if (past) return { kind: 'past' };
      if (too_far) return { kind: 'too_far' };

      const previous = (await client.query<Row>(IN_FORCE, [start.toISOString()])).rows[0];
      if (previous === undefined) throw new Error('rating_threshold_version holds no version');
      const before = recordOf(previous);
      if (sameValues(before, values)) return { kind: 'unchanged', version: before.version };

      const inserted = await client.query<Row>(
        `INSERT INTO rating_threshold_version AS t
           (version, provisional_below, established_at, contributor_min_rating,
            contributor_min_settled, conduct_window_days, flag_period_days, effective_from,
            set_by, reason)
         SELECT max(version) + 1, $1, $2, $3, $4, $5, $6, $7, $8, $9
           FROM rating_threshold_version
         RETURNING ${COLUMNS}, NULL::text AS set_by`,
        [
          values.provisional_below,
          values.established_at,
          values.contributor_min_rating,
          values.contributor_min_settled,
          values.conduct_window_days,
          values.flag_period_days,
          start.toISOString(),
          actorId,
          reason,
        ],
      );
      const row = inserted.rows[0]!;
      const { rows: actor } = await client.query<{ username: string }>(
        `SELECT username FROM user_account WHERE id = $1`,
        [actorId],
      );
      const next = recordOf({ ...row, set_by: actor[0]?.username ?? null });
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'rating_thresholds.supersede', 'rating_threshold_version', $2, $3,
                 $4::jsonb, $5::jsonb)`,
        [
          actorId,
          String(next.version),
          reason,
          JSON.stringify({
            version: before.version,
            effective_from: before.effective_from,
            ...valuesOf(thresholdsOf(previous)),
          }),
          JSON.stringify({
            version: next.version,
            effective_from: next.effective_from,
            ...values,
          }),
        ],
      );
      return { kind: 'recorded', version: next };
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
