import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { CountRow } from './series';

/** A timestamp column as its UTC calendar day, `YYYY-MM-DD`. */
const day = (column: string) => `to_char((${column} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`;

/** `count(*)` of a table's rows per UTC day of one timestamp column, from `$1`. */
function perDay(metric: string, table: string, column: string, where = 'TRUE'): string {
  return `SELECT '${metric}' AS metric, ${day(column)} AS day, count(*)::int AS n
            FROM ${table}
           WHERE ${column} >= $1 AND (${where})
           GROUP BY 2`;
}

/**
 * Every count on the Activity page, one statement (T-807). Each part reads a
 * table another boundary owns, the way the watchdog reads the live fixtures:
 * the rows exist for the product's own purposes, and this only counts them.
 * Nothing here selects a name, an address or a body; the one per-member
 * figure, `active_members`, is a `count(DISTINCT ...)` that leaves the
 * database as a number.
 *
 * What the product erases on deletion (D-094) cannot be counted afterwards,
 * and is not reconstructed: a deleted member's verification (the address and
 * its timestamp go) and sign-ins (the sessions go). Their registration,
 * predictions, settlements, messages and reports stay, unnamed, and count.
 */
const ACTIVITY_SQL = [
  perDay('registrations', 'user_account', 'created_at'),
  perDay('verifications', 'user_account', 'email_verified_at'),
  perDay('sign_ins', 'session', 'created_at'),
  `SELECT 'active_members' AS metric, d AS day, count(DISTINCT uid)::int AS n
     FROM (SELECT user_id AS uid, ${day('created_at')} AS d FROM session WHERE created_at >= $1
           UNION ALL
           SELECT p.user_id, ${day('v.submitted_at')}
             FROM prediction_version v JOIN user_prediction p ON p.id = v.prediction_id
            WHERE v.submitted_at >= $1) seen
    GROUP BY d`,
  perDay('deletions', 'retired_username', 'retired_at'),
  perDay('predictions', 'user_prediction', 'created_at'),
  perDay('prediction_changes', 'prediction_version', 'submitted_at', 'version_number > 1'),
  perDay('settlements', 'settlement', 'settled_at'),
  perDay('rating_snapshots', 'rating_snapshot', 'computed_at'),
  `SELECT CASE WHEN c.kind = 'direct' THEN 'direct_messages' ELSE 'group_messages' END AS metric,
          ${day('m.created_at')} AS day, count(*)::int AS n
     FROM message m JOIN conversation c ON c.id = m.conversation_id
    WHERE m.created_at >= $1
    GROUP BY 1, 2`,
  perDay('panel_posts', 'panel_post', 'created_at'),
  perDay('group_polls', 'group_poll', 'created_at'),
  perDay('reports', 'report', 'created_at'),
  perDay('notifications', 'notification', 'created_at'),
  perDay('push_sent', 'notification_delivery', 'carried_at', `push = 'sent'`),
  perDay('push_failed', 'notification_delivery', 'carried_at', `push = 'failed'`),
  perDay('email_sent', 'notification_delivery', 'carried_at', `email = 'sent'`),
  perDay('email_failed', 'notification_delivery', 'carried_at', `email = 'failed'`),
].join('\nUNION ALL\n');

@Injectable()
export class ActivityStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Per metric and UTC day from `since`: only days with at least one row. */
  async counts(since: Date): Promise<CountRow[]> {
    const { rows } = await this.pool.query<CountRow>(ACTIVITY_SQL, [since]);
    return rows;
  }
}
