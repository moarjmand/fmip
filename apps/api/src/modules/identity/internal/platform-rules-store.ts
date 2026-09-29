import { Inject, Injectable } from '@nestjs/common';
import type { PlatformRules, PlatformRulesStanding } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The version in force: the highest version number published, compared as
 * numbers (`1.10.0` after `1.9.0`), never by timestamp, so a clock cannot
 * reorder two publications (T-931, D-113).
 */
export const CURRENT_RULES_VERSION_SQL = `(SELECT v.version FROM platform_rules_version v
  ORDER BY string_to_array(split_part(v.version, '@', 2), '.')::int[] DESC LIMIT 1)`;

interface RulesRow {
  version: string;
  published_at: Date;
  body: string;
}

interface StandingRow {
  current: string;
  accepted: string;
  accepted_at: Date;
}

function toStanding(row: StandingRow): PlatformRulesStanding {
  return {
    current: row.current,
    accepted: row.accepted,
    accepted_at: row.accepted_at.toISOString(),
    pending: row.current !== row.accepted,
  };
}

export type AcceptOutcome =
  | { kind: 'accepted'; standing: PlatformRulesStanding }
  | { kind: 'not_current'; current: string }
  | { kind: 'unknown_user' };

/**
 * SQL for the platform rules and who accepted which (T-931, D-113). A
 * version is only ever inserted; an acceptance moves the member's two
 * columns on `user_account` and adds a row to `platform_rules_acceptance`.
 */
@Injectable()
export class PostgresPlatformRulesStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async current(): Promise<PlatformRules | null> {
    const { rows } = await this.pool.query<RulesRow>(
      `SELECT version, published_at, body FROM platform_rules_version
        WHERE version = ${CURRENT_RULES_VERSION_SQL}`,
    );
    const row = rows[0];
    if (row === undefined) return null;
    return { version: row.version, published_at: row.published_at.toISOString(), body: row.body };
  }

  async standing(userId: string): Promise<PlatformRulesStanding | null> {
    const { rows } = await this.pool.query<StandingRow>(
      `SELECT ${CURRENT_RULES_VERSION_SQL} AS current,
              u.accepted_rules_version AS accepted, u.accepted_rules_at AS accepted_at
         FROM user_account u WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0];
    return row === undefined ? null : toStanding(row);
  }

  /**
   * Accept `version`, which must be the one in force. The version row is
   * locked for the statement's length so a publication cannot slip between
   * the check and the write; a repeat changes nothing.
   */
  async accept(userId: string, version: string): Promise<AcceptOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ version: string }>(
        `SELECT version FROM platform_rules_version
          WHERE version = ${CURRENT_RULES_VERSION_SQL} FOR SHARE`,
      );
      const inForce = current.rows[0]?.version;
      if (inForce === undefined || inForce !== version) {
        await client.query('ROLLBACK');
        return { kind: 'not_current', current: inForce ?? '' };
      }

      const updated = await client.query<StandingRow>(
        `UPDATE user_account u
            SET accepted_rules_version = $2,
                accepted_rules_at = CASE WHEN u.accepted_rules_version = $2
                                         THEN u.accepted_rules_at ELSE now() END,
                updated_at = CASE WHEN u.accepted_rules_version = $2
                                  THEN u.updated_at ELSE now() END
          WHERE u.id = $1 AND u.status = 'active'
      RETURNING $2::text AS current, u.accepted_rules_version AS accepted,
                u.accepted_rules_at AS accepted_at`,
        [userId, version],
      );
      const row = updated.rows[0];
      if (row === undefined) {
        await client.query('ROLLBACK');
        return { kind: 'unknown_user' };
      }
      await client.query(
        `INSERT INTO platform_rules_acceptance (user_id, version, accepted_at)
         VALUES ($1, $2, $3) ON CONFLICT (user_id, version) DO NOTHING`,
        [userId, version, row.accepted_at],
      );
      await client.query('COMMIT');
      return { kind: 'accepted', standing: toStanding(row) };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
