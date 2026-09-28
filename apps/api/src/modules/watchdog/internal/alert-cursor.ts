import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The key of the advisory lock one alert delivery holds (T-802). Distinct
 * from the tick's (`WATCHDOG_LOCK`): a slow push must not make the next tick
 * skip, and a tick must not make the delivery skip.
 */
export const ALERT_LOCK = 802_802;

/**
 * The cursor as the delivery sees it: the id of the newest alert event every
 * administrator has been written a notification for, and a way to move it.
 */
export interface AlertCursor {
  /**
   * Runs `work` holding the delivery's lock, with the cursor's value; `advance`
   * moves it forward in the same transaction, which commits when `work`
   * returns. `null` without running `work` when another delivery holds the
   * lock -- in this process or another.
   */
  withCursor<T>(
    work: (lastEventId: number, advance: (eventId: number) => Promise<void>) => Promise<T>,
  ): Promise<T | null>;
  /** The cursor as stored, for the report. */
  read(): Promise<{ lastEventId: number; advancedAt: Date | null }>;
}

/** `watchdog_alert_cursor`, one row, moved forward only. */
@Injectable()
export class PostgresAlertCursor implements AlertCursor {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async withCursor<T>(
    work: (lastEventId: number, advance: (eventId: number) => Promise<void>) => Promise<T>,
  ): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: lock } = await client.query<{ got: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1) AS got',
        [ALERT_LOCK],
      );
      if (lock[0]?.got !== true) {
        await client.query('ROLLBACK');
        return null;
      }
      // The row lock as well as the advisory one: a hand-run UPDATE during an
      // incident waits for this delivery rather than being overwritten by it.
      const { rows } = await client.query<{ last_event_id: string }>(
        'SELECT last_event_id FROM watchdog_alert_cursor WHERE id = 1 FOR UPDATE',
      );
      const last = Number(rows[0]?.last_event_id ?? 0);
      const result = await work(last, async (eventId) => {
        // `GREATEST`: forward only, whatever the caller passes.
        await client.query(
          `INSERT INTO watchdog_alert_cursor (id, last_event_id, advanced_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE
             SET last_event_id = GREATEST(watchdog_alert_cursor.last_event_id, EXCLUDED.last_event_id),
                 advanced_at = now()`,
          [eventId],
        );
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async read(): Promise<{ lastEventId: number; advancedAt: Date | null }> {
    const { rows } = await this.pool.query<{ last_event_id: string; advanced_at: Date | null }>(
      'SELECT last_event_id, advanced_at FROM watchdog_alert_cursor WHERE id = 1',
    );
    return {
      lastEventId: Number(rows[0]?.last_event_id ?? 0),
      advancedAt: rows[0]?.advanced_at ?? null,
    };
  }
}
