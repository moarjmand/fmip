import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { DAILY_PREFIX, DAILY_THROUGH, mergeRolledUp, type RollUpState } from './daily';
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
 * Sign-ins: sessions per UTC day they were created. `until` (a parameter
 * placeholder) bounds the days for the roll-up; the report reads from `$1` on.
 */
function signIns(until?: string): string {
  return perDay(
    'sign_ins',
    'session',
    'created_at',
    until === undefined ? 'TRUE' : `created_at < ${until}`,
  );
}

/**
 * Active members: distinct members per UTC day who started a session or
 * submitted a prediction version that day. `until` as for `signIns`.
 */
function activeMembers(until?: string): string {
  const below = (column: string) => (until === undefined ? '' : ` AND ${column} < ${until}`);
  return `SELECT 'active_members' AS metric, d AS day, count(DISTINCT uid)::int AS n
     FROM (SELECT user_id AS uid, ${day('created_at')} AS d FROM session
            WHERE created_at >= $1${below('created_at')}
           UNION ALL
           SELECT p.user_id, ${day('v.submitted_at')}
             FROM prediction_version v JOIN user_prediction p ON p.id = v.prediction_id
            WHERE v.submitted_at >= $1${below('v.submitted_at')}) seen
    GROUP BY d`;
}

/** The window's first UTC day, from the `$1` instant. */
const FIRST_DAY = `($1::timestamptz AT TIME ZONE 'UTC')::date`;

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
 *
 * Sign-ins and active members of the days whose sessions the retention purge
 * deleted come from `activity_daily` instead (T-1727, D-353), kept as two
 * anonymous numbers per day before the sessions went; a member deleted after
 * that stays in those two numbers, which name no one.
 */
const ACTIVITY_SQL = [
  perDay('registrations', 'user_account', 'created_at'),
  perDay('verifications', 'user_account', 'email_verified_at'),
  signIns(),
  activeMembers(),
  // The kept days (T-1727, D-353): the same two metrics from the roll-up, and
  // its last day, read in this one statement so the boundary and the counts
  // come from one snapshot. `mergeRolledUp` takes each day from one source.
  `SELECT '${DAILY_PREFIX}sign_ins' AS metric, to_char(day, 'YYYY-MM-DD') AS day, sign_ins AS n
     FROM activity_daily WHERE day >= ${FIRST_DAY} AND sign_ins > 0`,
  `SELECT '${DAILY_PREFIX}active_members' AS metric, to_char(day, 'YYYY-MM-DD') AS day,
          active_members AS n
     FROM activity_daily WHERE day >= ${FIRST_DAY} AND active_members > 0`,
  `SELECT '${DAILY_THROUGH}' AS metric, to_char(max(day), 'YYYY-MM-DD') AS day, 0 AS n
     FROM activity_daily HAVING max(day) IS NOT NULL`,
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

  /**
   * Per metric and UTC day from `since`: only days with at least one row.
   * Sign-ins and active members up to the last kept day are the roll-up's,
   * later days the live rows' (D-353).
   */
  async counts(since: Date): Promise<CountRow[]> {
    const { rows } = await this.pool.query<CountRow>(ACTIVITY_SQL, [since]);
    return mergeRolledUp(rows);
  }

  /**
   * What the roll-up step needs before the purge deletes the sessions that
   * expired before `sessionsBefore` (the purge's own cut-off): the last kept
   * day, the latest creation day among those sessions, and the first day
   * either source has a row for.
   */
  async rollUpState(sessionsBefore: Date): Promise<RollUpState> {
    const utc = (instant: string) => `to_char((${instant} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`;
    const { rows } = await this.pool.query<RollUpState>(
      `SELECT to_char((SELECT max(day) FROM activity_daily), 'YYYY-MM-DD') AS "keptThrough",
              ${utc('(SELECT max(created_at) FROM session WHERE expires_at < $1)')} AS "purgeThrough",
              ${utc(`least((SELECT min(created_at) FROM session),
                           (SELECT min(submitted_at) FROM prediction_version))`)} AS "firstDay"`,
      [sessionsBefore],
    );
    return rows[0] ?? { keptThrough: null, purgeThrough: null, firstDay: null };
  }

  /**
   * Keeps the sign-ins and active members of every UTC day from `from` up to
   * (not including) `until`, both day starts, with the report's own
   * definitions above; a quiet day is kept as zeros so the kept days stay
   * contiguous. A day already kept is left as it is. Returns the days written.
   */
  async rollUp(from: Date, until: Date): Promise<number> {
    const result = await this.pool.query(
      `WITH counted AS (
         ${signIns('$2')}
         UNION ALL
         ${activeMembers('$2')}
       )
       INSERT INTO activity_daily (day, sign_ins, active_members)
       SELECT d::date,
              coalesce(max(c.n) FILTER (WHERE c.metric = 'sign_ins'), 0),
              coalesce(max(c.n) FILTER (WHERE c.metric = 'active_members'), 0)
         FROM generate_series($1::timestamptz AT TIME ZONE 'UTC',
                              ($2::timestamptz AT TIME ZONE 'UTC') - interval '1 day',
                              interval '1 day') d
         LEFT JOIN counted c ON c.day = to_char(d, 'YYYY-MM-DD')
        GROUP BY d
       ON CONFLICT (day) DO NOTHING`,
      [from, until],
    );
    return result.rowCount ?? 0;
  }
}
