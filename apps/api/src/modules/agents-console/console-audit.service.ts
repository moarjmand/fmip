import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { writeConsoleAudit } from './internal/console-store';

/**
 * One `console_audit` row (rule 10: actor, time, reason, previous value), for
 * a module whose console actions the agents console does not perform itself
 * (T-1838, D-427 point 8: the social posts). Written inside the caller's own
 * transaction, so the change and its audit row commit or roll back together.
 * The time is the row's `created_at`.
 */
export interface ConsoleAuditEntry {
  /** The console person, or null for the job's own action (`actorName` then names it, e.g. `automation`). */
  actorId: string | null;
  actorName: string;
  /** `<area>.<verb>`, e.g. `social.approve`. */
  action: string;
  targetType: string;
  targetId: string;
  /** Never blank (the table refuses it). */
  reason: string;
  /** What it was before; null only when there was nothing. */
  previous: unknown;
  next?: unknown;
}

/** One audit row as read back, for that module's own console page (T-1836). */
export interface ConsoleAuditRecord {
  created_at: Date;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  previous: unknown;
}

/** An action area: lower-case letters and underscores, as the table's `action` CHECK has them. */
const AREA = /^[a-z_]+$/;

@Injectable()
export class ConsoleAudit {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async write(client: PoolClient, entry: ConsoleAuditEntry): Promise<void> {
    if (entry.reason.trim() === '') throw new Error('a console audit row needs a reason');
    await writeConsoleAudit(client, entry);
  }

  /**
   * The newest rows of one area (`social` for `social.*`), newest first, with
   * the previous value; `next` is not read. For the social tab's own trail
   * (T-1836), so it is not drowned by the console's other rows.
   */
  async recent(area: string, limit: number): Promise<ConsoleAuditRecord[]> {
    if (!AREA.test(area)) throw new Error(`not an audit area: ${area}`);
    const { rows } = await this.pool.query<ConsoleAuditRecord>(
      `SELECT created_at, actor_name, action, target_type, target_id, reason, previous
         FROM console_audit WHERE action LIKE $1
        ORDER BY created_at DESC, id DESC LIMIT $2`,
      [`${area}.%`, limit],
    );
    return rows;
  }
}
