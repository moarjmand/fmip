import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
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

@Injectable()
export class ConsoleAudit {
  async write(client: PoolClient, entry: ConsoleAuditEntry): Promise<void> {
    if (entry.reason.trim() === '') throw new Error('a console audit row needs a reason');
    await writeConsoleAudit(client, entry);
  }
}
