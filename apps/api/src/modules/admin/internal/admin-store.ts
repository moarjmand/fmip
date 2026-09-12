import { Inject, Injectable } from '@nestjs/common';
import {
  type AccountStatus,
  type AdminUser,
  type AuditRecord,
  type CoverageState,
  type CoverageStatusRow,
  type FreshnessRow,
  STALE_LIVE_AFTER_MS,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** What an audit record says (rule 10): who, what, on which record, why, before and after. */
export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  previous: unknown;
  next: unknown;
}

/**
 * SQL for the administration area (T-070). Reads cross the boundaries'
 * tables on purpose: the operator's view is the whole platform. Every write
 * here is a high-impact action and happens in one transaction with its
 * audit row, so there is never a change without its record.
 */
@Injectable()
export class PostgresAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async coverage(): Promise<CoverageStatusRow[]> {
    const { rows } = await this.pool.query<{
      season_id: string;
      season_label: string;
      is_current: boolean;
      competition_id: string;
      competition_name: string;
      module: string;
      state: CoverageState;
      provider: string | null;
      note: string | null;
    }>(
      `SELECT se.id AS season_id, se.label AS season_label, se.is_current,
              c.id AS competition_id, c.name AS competition_name,
              cp.module, cp.state, cp.provider, cp.note
         FROM coverage_profile cp
         JOIN season se ON se.id = cp.season_id
         JOIN competition c ON c.id = se.competition_id
        WHERE se.is_current
        ORDER BY c.name, se.label, cp.module`,
    );
    return rows.map((r) => ({
      season: { id: r.season_id, label: r.season_label, is_current: r.is_current },
      competition: { id: r.competition_id, name: r.competition_name },
      module: r.module,
      state: r.state,
      provider: r.provider,
      note: r.note,
    }));
  }

  async freshness(): Promise<FreshnessRow[]> {
    const { rows } = await this.pool.query<{
      season_id: string;
      season_label: string;
      competition_id: string;
      competition_name: string;
      fixtures: string;
      live: string;
      live_behind: string;
      last_change_at: Date | null;
    }>(
      `WITH changed AS (
         SELECT f.id, f.season_id, f.status,
                GREATEST(f.updated_at,
                  (SELECT max(sc.updated_at) FROM fixture_score sc WHERE sc.fixture_id = f.id),
                  (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = f.id)) AS changed_at
           FROM fixture f
       )
       SELECT se.id AS season_id, se.label AS season_label,
              c.id AS competition_id, c.name AS competition_name,
              count(ch.id)::text AS fixtures,
              count(ch.id) FILTER (WHERE ch.status = 'live')::text AS live,
              count(ch.id) FILTER (WHERE ch.status IN ('live', 'suspended')
                                     AND ch.changed_at < now() - ($1::int * interval '1 millisecond'))::text AS live_behind,
              max(ch.changed_at) AS last_change_at
         FROM season se
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN changed ch ON ch.season_id = se.id
        WHERE se.is_current
        GROUP BY se.id, se.label, c.id, c.name
        ORDER BY c.name, se.label`,
      [STALE_LIVE_AFTER_MS],
    );
    return rows.map((r) => ({
      season: { id: r.season_id, label: r.season_label },
      competition: { id: r.competition_id, name: r.competition_name },
      fixtures: Number(r.fixtures),
      live: Number(r.live),
      live_behind: Number(r.live_behind),
      last_change_at: r.last_change_at === null ? null : r.last_change_at.toISOString(),
    }));
  }

  async searchUsers(query: string, limit: number): Promise<AdminUser[]> {
    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      status: AccountStatus;
      email_verified: boolean;
      roles: string[] | null;
      created_at: Date;
    }>(
      `SELECT u.id, u.username, u.display_name, u.email, u.status,
              (u.email_verified_at IS NOT NULL) AS email_verified,
              (SELECT array_agg(r.role ORDER BY r.role) FROM user_role r WHERE r.user_id = u.id) AS roles,
              u.created_at
         FROM user_account u
        WHERE u.username ILIKE $1 OR u.email ILIKE $1 OR u.display_name ILIKE $1
        ORDER BY u.username
        LIMIT $2`,
      [`%${query.replace(/[%_\\]/g, '\\$&')}%`, limit],
    );
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      display_name: r.display_name,
      email: r.email,
      status: r.status,
      email_verified: r.email_verified,
      roles: r.roles ?? [],
      created_at: r.created_at.toISOString(),
    }));
  }

  /** Changes an account's status and writes the audit row in the same transaction; null for an unknown account. */
  async setUserStatus(
    userId: string,
    status: Exclude<AccountStatus, 'deleted'>,
    audit: Omit<AuditEntry, 'previous' | 'next' | 'targetType' | 'targetId' | 'action'>,
  ): Promise<{ previous: AccountStatus; next: AccountStatus; auditId: string } | null> {
    return this.transaction(async (client) => {
      const current = await client.query<{ status: AccountStatus }>(
        `SELECT status FROM user_account WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      const previous = current.rows[0]?.status;
      if (previous === undefined) return null;
      await client.query(`UPDATE user_account SET status = $2 WHERE id = $1`, [userId, status]);
      const auditId = await this.record(client, {
        ...audit,
        action: 'user.status',
        targetType: 'user_account',
        targetId: userId,
        previous: { status: previous },
        next: { status },
      });
      return { previous, next: status, auditId };
    });
  }

  /** Sets a season's declared coverage for one module, with the audit row; null for an unknown season. */
  async setCoverage(
    seasonId: string,
    module: string,
    next: { state: CoverageState; provider: string | null; note: string | null },
    audit: Omit<AuditEntry, 'previous' | 'next' | 'targetType' | 'targetId' | 'action'>,
  ): Promise<{
    previous: { state: CoverageState; provider: string | null; note: string | null } | null;
    auditId: string;
  } | null> {
    return this.transaction(async (client) => {
      const season = await client.query<{ id: string }>(`SELECT id FROM season WHERE id = $1`, [
        seasonId,
      ]);
      if (season.rows.length === 0) return null;
      const existing = await client.query<{
        id: string;
        state: CoverageState;
        provider: string | null;
        note: string | null;
      }>(
        `SELECT id, state, provider, note FROM coverage_profile
          WHERE season_id = $1 AND module = $2 FOR UPDATE`,
        [seasonId, module],
      );
      const before = existing.rows[0];
      if (before === undefined) {
        await client.query(
          `INSERT INTO coverage_profile (season_id, module, state, provider, note) VALUES ($1, $2, $3, $4, $5)`,
          [seasonId, module, next.state, next.provider, next.note],
        );
      } else {
        await client.query(
          `UPDATE coverage_profile SET state = $2, provider = $3, note = $4 WHERE id = $1`,
          [before.id, next.state, next.provider, next.note],
        );
      }
      const previous =
        before === undefined
          ? null
          : { state: before.state, provider: before.provider, note: before.note };
      const auditId = await this.record(client, {
        ...audit,
        action: 'coverage.set',
        targetType: 'coverage_profile',
        targetId: `${seasonId}:${module}`,
        previous,
        next,
      });
      return { previous, auditId };
    });
  }

  async audit(limit: number): Promise<AuditRecord[]> {
    const { rows } = await this.pool.query<{
      id: string;
      actor_id: string;
      actor_username: string;
      action: string;
      target_type: string;
      target_id: string;
      reason: string;
      previous: unknown;
      next: unknown;
      created_at: Date;
    }>(
      `SELECT a.id, a.actor_id, u.username AS actor_username, a.action, a.target_type, a.target_id,
              a.reason, a.previous, a.next, a.created_at
         FROM audit_log a JOIN user_account u ON u.id = a.actor_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      actor: { id: r.actor_id, username: r.actor_username },
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      reason: r.reason,
      previous: r.previous,
      next: r.next,
      created_at: r.created_at.toISOString(),
    }));
  }

  private async record(client: PoolClient, entry: AuditEntry): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
      [
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.reason,
        entry.previous === null ? null : JSON.stringify(entry.previous),
        entry.next === null ? null : JSON.stringify(entry.next),
      ],
    );
    return rows[0]!.id;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
