import { Inject, Injectable } from '@nestjs/common';
import type {
  WatchdogCondition,
  WatchdogEvent,
  WatchdogEventKind,
  WatchdogLevel,
  WatchdogUnit,
} from '@fmip/contracts';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { Reading, RunRecord, WalArchiveRecord } from './conditions';
import { type StoredCondition, isAlert } from './transition';

/**
 * The key of the transaction-scoped advisory lock one tick holds (T-801). Two
 * processes that both schedule would otherwise read the same previous state
 * and both write the same `raised` event; with the lock the second skips.
 */
export const WATCHDOG_LOCK = 801_801;

interface ConditionRow {
  key: string;
  level: WatchdogLevel;
  since: Date;
  checked_at: Date;
  observed: number | null;
  unit: WatchdogUnit;
  degraded_at: number;
  failing_at: number;
  note: string | null;
  incident_id: string | null;
}

interface EventRow {
  id: string;
  condition: string;
  at: Date;
  from_level: WatchdogLevel;
  to_level: WatchdogLevel;
  kind: WatchdogEventKind;
  incident_id: string | null;
  observed: number | null;
  note: string | null;
}

const EVENT_COLUMNS = 'id, condition, at, from_level, to_level, kind, incident_id, observed, note';

function eventOf(row: EventRow): WatchdogEvent {
  return {
    id: Number(row.id),
    condition: row.condition,
    at: row.at.toISOString(),
    from: row.from_level,
    to: row.to_level,
    kind: row.kind,
    alert: isAlert(row.kind),
    incident: row.incident_id === null ? null : Number(row.incident_id),
    observed: row.observed,
    note: row.note,
  };
}

/** Every statement the watchdog runs: its own two tables, and the reads it makes of others. */
@Injectable()
export class WatchdogStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Runs `work` inside one transaction holding the watchdog's advisory lock,
   * or returns `null` without running it when another tick holds the lock.
   */
  async locked<T>(work: (client: PoolClient) => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ got: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS got',
        [WATCHDOG_LOCK],
      );
      if (rows[0]?.got !== true) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async previous(client: PoolClient): Promise<Map<string, StoredCondition>> {
    const { rows } = await client.query<ConditionRow>(
      `SELECT key, level, since, checked_at, observed, unit, degraded_at, failing_at, note, incident_id
         FROM watchdog_condition`,
    );
    return new Map(
      rows.map((r) => [
        r.key,
        {
          key: r.key,
          level: r.level,
          since: r.since,
          observed: r.observed,
          incidentId: r.incident_id === null ? null : Number(r.incident_id),
        },
      ]),
    );
  }

  /**
   * Writes one transition. A `raised` event draws its id first so that it can
   * name itself as its incident in the same row.
   */
  async writeEvent(
    client: PoolClient,
    event: {
      condition: string;
      at: Date;
      from: WatchdogLevel;
      to: WatchdogLevel;
      kind: WatchdogEventKind;
      incident: number | null | 'new';
      observed: number | null;
      note: string | null;
    },
  ): Promise<WatchdogEvent> {
    const { rows } = await client.query<EventRow>(
      `WITH n AS (SELECT nextval(pg_get_serial_sequence('watchdog_event', 'id')) AS id)
       INSERT INTO watchdog_event (id, condition, at, from_level, to_level, kind, incident_id, observed, note)
       SELECT n.id, $1::text, $2::timestamptz, $3::text, $4::text, $5::text,
              CASE WHEN $8::boolean THEN n.id ELSE $6::bigint END, $7::double precision, $9::text
         FROM n
       RETURNING ${EVENT_COLUMNS}`,
      [
        event.condition,
        event.at,
        event.from,
        event.to,
        event.kind,
        event.incident === 'new' ? null : event.incident,
        event.observed,
        event.incident === 'new',
        event.note,
      ],
    );
    return eventOf(rows[0] as EventRow);
  }

  async saveCondition(
    client: PoolClient,
    reading: Reading,
    state: { level: WatchdogLevel; since: Date; incident: number | null },
    now: Date,
  ): Promise<void> {
    await client.query(
      `INSERT INTO watchdog_condition
         (key, level, since, checked_at, observed, unit, degraded_at, failing_at, note, incident_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (key) DO UPDATE SET
         level = EXCLUDED.level, since = EXCLUDED.since, checked_at = EXCLUDED.checked_at,
         observed = EXCLUDED.observed, unit = EXCLUDED.unit, degraded_at = EXCLUDED.degraded_at,
         failing_at = EXCLUDED.failing_at, note = EXCLUDED.note, incident_id = EXCLUDED.incident_id`,
      [
        reading.key,
        state.level,
        state.since,
        now,
        reading.observed,
        reading.threshold.unit,
        reading.threshold.degraded,
        reading.threshold.failing,
        reading.note,
        state.incident,
      ],
    );
  }

  /**
   * Removes a condition whose subject is gone for good (T-947, D-162). Its
   * events stay: the record of what happened is not rewritten.
   */
  async removeCondition(client: PoolClient, key: string): Promise<void> {
    await client.query('DELETE FROM watchdog_condition WHERE key = $1 AND incident_id IS NULL', [
      key,
    ]);
  }

  async conditions(): Promise<WatchdogCondition[]> {
    const { rows } = await this.pool.query<ConditionRow>(
      `SELECT key, level, since, checked_at, observed, unit, degraded_at, failing_at, note, incident_id
         FROM watchdog_condition ORDER BY key`,
    );
    return rows.map((r) => ({
      key: r.key,
      level: r.level,
      since: r.since.toISOString(),
      checked_at: r.checked_at.toISOString(),
      observed: r.observed,
      threshold: { unit: r.unit, degraded: r.degraded_at, failing: r.failing_at },
      note: r.note,
      incident: r.incident_id === null ? null : Number(r.incident_id),
    }));
  }

  /** The newest events first. */
  async events(limit: number): Promise<WatchdogEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM watchdog_event ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    return rows.map(eventOf);
  }

  /** `raised` and `recovered` events after a cursor, oldest first: what T-802 delivers. */
  async alertsAfter(afterId: number, limit: number): Promise<WatchdogEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM watchdog_event
        WHERE id > $1 AND kind IN ('raised', 'recovered')
        ORDER BY id LIMIT $2`,
      [afterId, limit],
    );
    return rows.map(eventOf);
  }

  /** The newest alert events at or before a cursor, newest first: what T-802 delivered. */
  async alertsUpTo(lastId: number, limit: number): Promise<WatchdogEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM watchdog_event
        WHERE id <= $1 AND kind IN ('raised', 'recovered')
        ORDER BY id DESC LIMIT $2`,
      [lastId, limit],
    );
    return rows.map(eventOf);
  }

  /** How many alert events are after a cursor: not delivered yet. */
  async alertsPendingAfter(lastId: number): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM watchdog_event
        WHERE id > $1 AND kind IN ('raised', 'recovered')`,
      [lastId],
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Matches in progress: how many, when the longest-unchanged one last
   * changed, and how many have been unchanged for `behindAfterMs` or more.
   * Measured against `now` from the application, not the database clock.
   */
  async liveFixtures(
    now: Date,
    behindAfterMs: number,
  ): Promise<{ inProgress: number; oldestChangeAt: Date | null; behind: number }> {
    const { rows } = await this.pool.query<{
      in_progress: string;
      oldest: Date | null;
      behind: string;
    }>(
      // A match's last change is the one the scores page shows (D-045): the
      // newest of the fixture, its score and its incidents.
      `WITH live AS (
         SELECT GREATEST(
                  f.updated_at,
                  (SELECT max(sc.updated_at) FROM fixture_score sc WHERE sc.fixture_id = f.id),
                  (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = f.id)
                ) AS changed
           FROM fixture f
          WHERE f.status IN ('live', 'suspended'))
       SELECT count(*)::text AS in_progress,
              min(changed) AS oldest,
              count(*) FILTER (WHERE changed <= $1)::text AS behind
         FROM live`,
      [new Date(now.getTime() - behindAfterMs)],
    );
    const row = rows[0];
    return {
      inProgress: Number(row?.in_progress ?? 0),
      oldestChangeAt: row?.oldest ?? null,
      behind: Number(row?.behind ?? 0),
    };
  }

  /** Outcomes per channel of the deliveries carried since `since` (T-330's record). */
  async deliveryOutcomes(
    since: Date,
  ): Promise<{ email: { sent: number; failed: number }; push: { sent: number; failed: number } }> {
    const { rows } = await this.pool.query<{
      email_sent: string;
      email_failed: string;
      push_sent: string;
      push_failed: string;
    }>(
      `SELECT count(*) FILTER (WHERE email = 'sent')::text AS email_sent,
              count(*) FILTER (WHERE email = 'failed')::text AS email_failed,
              count(*) FILTER (WHERE push = 'sent')::text AS push_sent,
              count(*) FILTER (WHERE push = 'failed')::text AS push_failed
         FROM notification_delivery
        WHERE carried_at >= $1`,
      [since],
    );
    const row = rows[0];
    return {
      email: { sent: Number(row?.email_sent ?? 0), failed: Number(row?.email_failed ?? 0) },
      push: { sent: Number(row?.push_sent ?? 0), failed: Number(row?.push_failed ?? 0) },
    };
  }

  /**
   * What the backup and the restore drill recorded (T-805): per kind, the
   * newest successful run and the newest run of any outcome. Written by
   * `scripts/backup/*.sh` on the host through psql, never by the API.
   */
  async backupRuns(): Promise<{ backup: RunRecord; drill: RunRecord }> {
    const { rows } = await this.pool.query<{
      kind: 'backup' | 'restore_drill';
      last_ok: Date | null;
      newest_at: Date;
      newest_ok: boolean;
      newest_detail: string | null;
    }>(
      `SELECT kind,
              max(finished_at) FILTER (WHERE ok) AS last_ok,
              (array_agg(finished_at ORDER BY finished_at DESC, id DESC))[1] AS newest_at,
              (array_agg(ok ORDER BY finished_at DESC, id DESC))[1] AS newest_ok,
              (array_agg(detail ORDER BY finished_at DESC, id DESC))[1] AS newest_detail
         FROM backup_run
        GROUP BY kind`,
    );
    const of = (kind: 'backup' | 'restore_drill'): RunRecord => {
      const row = rows.find((r) => r.kind === kind);
      return row === undefined
        ? { lastSucceededAt: null, newest: null }
        : {
            lastSucceededAt: row.last_ok,
            newest: { at: row.newest_at, ok: row.newest_ok, detail: row.newest_detail },
          };
    };
    return { backup: of('backup'), drill: of('restore_drill') };
  }

  /**
   * The WAL archiver (T-845, D-157), from Postgres itself: whether
   * `archive_mode` is on, the newest segment archived and refused, and how
   * many finished segments wait -- the current segment's number less the
   * newest archived one's, less the one being written. `last_archived_wal`
   * can name a `.backup` marker, whose first 24 characters are its segment.
   */
  async walArchive(): Promise<WalArchiveRecord> {
    const { rows } = await this.pool.query<{
      mode: string;
      last_archived_time: Date | null;
      last_failed_time: Date | null;
      last_failed_wal: string | null;
      waiting: number | null;
    }>(
      `SELECT current_setting('archive_mode') AS mode,
              a.last_archived_time, a.last_failed_time, a.last_failed_wal,
              CASE WHEN pg_is_in_recovery() OR a.last_archived_wal IS NULL
                        OR a.last_archived_wal !~ '^[0-9A-F]{24}' THEN NULL
                   ELSE greatest(0,
                          (pg_split_walfile_name(pg_walfile_name(pg_current_wal_lsn()))).segment_number
                          - (pg_split_walfile_name(left(a.last_archived_wal, 24))).segment_number
                          - 1)::int
              END AS waiting
         FROM pg_stat_archiver a`,
    );
    const row = rows[0];
    return {
      on: row?.mode === 'on' || row?.mode === 'always',
      lastArchivedAt: row?.last_archived_time ?? null,
      lastFailedAt: row?.last_failed_time ?? null,
      lastFailedWal: row?.last_failed_wal ?? null,
      waiting: row?.waiting ?? null,
    };
  }
}
