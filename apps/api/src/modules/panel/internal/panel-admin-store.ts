import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The SQL for opening and closing a match panel (T-253). All of it, and nothing
 * else.
 *
 * **Every write here carries its `audit_log` row in the same transaction**
 * (rule 10, D-046). An opening whose audit row could fail separately is a
 * public discussion that might exist with nobody's name on it, which is the one
 * thing this table was added to prevent.
 */

export interface PanelRow {
  fixture_id: string;
  home: string;
  away: string;
  kickoff_at: Date;
  opened_by: string;
  reason: string;
  opened_at: Date;
  closed_at: Date | null;
  closed_by: string | null;
  close_reason: string | null;
  posts: string;
}

export type PanelFilter = 'open' | 'closed' | 'all';

@Injectable()
export class PostgresPanelAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Every panel an operator might be deciding about, newest first.
   *
   * The post count comes back with the row rather than in a second query per
   * panel: it is the number an operator weighs before closing one, and a list
   * of forty panels should not cost forty round trips to show it.
   */
  async list(filter: PanelFilter, limit: number): Promise<PanelRow[]> {
    const { rows } = await this.pool.query<PanelRow>(
      `SELECT p.fixture_id,
              home.name AS home,
              away.name AS away,
              f.kickoff_at,
              opener.username AS opened_by,
              p.reason,
              p.created_at AS opened_at,
              p.closed_at,
              closer.username AS closed_by,
              p.close_reason,
              (SELECT count(*)::text FROM panel_post pp WHERE pp.fixture_id = p.fixture_id) AS posts
         FROM match_panel p
         JOIN fixture f ON f.id = p.fixture_id
         JOIN user_account opener ON opener.id = p.opened_by
         LEFT JOIN user_account closer ON closer.id = p.closed_by
         -- The two teams, by side. A panel an operator cannot recognise is one
         -- they cannot decide about.
         LEFT JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         LEFT JOIN team home ON home.id = hp.team_id
         LEFT JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         LEFT JOIN team away ON away.id = ap.team_id
        WHERE ($1 = 'all')
           OR ($1 = 'open' AND p.closed_at IS NULL)
           OR ($1 = 'closed' AND p.closed_at IS NOT NULL)
        ORDER BY p.created_at DESC
        LIMIT $2`,
      [filter, limit],
    );
    return rows;
  }

  async fixtureExists(fixtureId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM fixture WHERE id = $1`, [fixtureId]);
    return rows.length === 1;
  }

  /**
   * Open a panel, or reopen a closed one.
   *
   * One statement for both, because they are the same decision: this match
   * should have a public discussion. `ON CONFLICT` updates the closing away and
   * records the new reason, so a reopened panel says why it is open now rather
   * than why it was opened a month ago. The previous state goes into the audit
   * row.
   */
  async open(fixtureId: string, actorId: string, reason: string): Promise<'opened' | 'already'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query<{ closed: boolean }>(
        `SELECT (closed_at IS NOT NULL) AS closed FROM match_panel WHERE fixture_id = $1`,
        [fixtureId],
      );
      const existing = before.rows[0];
      if (existing !== undefined && !existing.closed) {
        await client.query('ROLLBACK');
        return 'already';
      }

      await client.query(
        `INSERT INTO match_panel (fixture_id, opened_by, reason)
         VALUES ($1, $2, $3)
         ON CONFLICT (fixture_id) DO UPDATE
            SET opened_by = EXCLUDED.opened_by,
                reason = EXCLUDED.reason,
                created_at = now(),
                closed_at = NULL,
                closed_by = NULL,
                close_reason = NULL`,
        [fixtureId, actorId, reason],
      );
      await record(client, {
        actorId,
        action: 'panel.open',
        targetId: fixtureId,
        reason,
        previous: existing === undefined ? null : { state: 'closed' },
        next: { state: 'open' },
      });
      await client.query('COMMIT');
      return 'opened';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** `false` when there was no open panel on that fixture to close. */
  async close(fixtureId: string, actorId: string, reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount } = await client.query(
        `UPDATE match_panel
            SET closed_at = now(), closed_by = $2, close_reason = $3
          WHERE fixture_id = $1 AND closed_at IS NULL`,
        [fixtureId, actorId, reason],
      );
      if (rowCount !== 1) {
        await client.query('ROLLBACK');
        return false;
      }
      await record(client, {
        actorId,
        action: 'panel.close',
        targetId: fixtureId,
        reason,
        previous: { state: 'open' },
        next: { state: 'closed' },
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
}

/**
 * `target_type` is `fixture`, not `user_account`.
 *
 * The audit log's target is the thing that changed, and what changed here is a
 * match, not a member. A row filed under the operator's own id would be
 * unfindable by the only question anybody asks of it: "who opened the
 * discussion on *this match*".
 */
async function record(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'fixture', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
