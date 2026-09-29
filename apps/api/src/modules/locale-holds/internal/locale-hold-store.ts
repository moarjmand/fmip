import { Inject, Injectable } from '@nestjs/common';
import type { LocaleHoldRecord } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * Holding back a language (T-1163, D-155): each hold and release with its
 * `audit_log` row in the same transaction (rule 10), target type `locale`.
 * One hold in force per locale is the schema's (`locale_hold_one_in_force`);
 * the writer reads it under the lock the unique index takes, so a race ends
 * as `already` rather than an error.
 */
@Injectable()
export class PostgresLocaleHoldStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The locales held now, oldest hold first. */
  async held(): Promise<{ locale: string; held_at: Date }[]> {
    const { rows } = await this.pool.query<{ locale: string; held_at: Date }>(
      `SELECT locale, held_at FROM locale_hold WHERE released_at IS NULL ORDER BY held_at, locale`,
    );
    return rows;
  }

  async list(): Promise<LocaleHoldRecord[]> {
    const { rows } = await this.pool.query<{
      locale: string;
      held_by: string;
      reason: string;
      held_at: Date;
      released_by: string | null;
      release_reason: string | null;
      released_at: Date | null;
    }>(
      `SELECT h.locale, hb.username AS held_by, h.reason, h.held_at,
              rb.username AS released_by, h.release_reason, h.released_at
         FROM locale_hold h
         JOIN user_account hb ON hb.id = h.held_by
         LEFT JOIN user_account rb ON rb.id = h.released_by
        ORDER BY h.held_at DESC, h.locale
        LIMIT 200`,
    );
    return rows.map((r) => ({
      locale: r.locale,
      held_by: r.held_by,
      reason: r.reason,
      held_at: r.held_at.toISOString(),
      released_by: r.released_by,
      release_reason: r.release_reason,
      released_at: r.released_at?.toISOString() ?? null,
    }));
  }

  /** Holds `locale`; `already` when a hold is in force. */
  async hold(locale: string, actorId: string, reason: string): Promise<'held' | 'already'> {
    return this.transaction(async (client) => {
      const inserted = await client.query<{ id: string; held_at: Date }>(
        `INSERT INTO locale_hold (locale, held_by, reason) VALUES ($1, $2, $3)
         ON CONFLICT (locale) WHERE released_at IS NULL DO NOTHING
         RETURNING id, held_at`,
        [locale, actorId, reason],
      );
      const hold = inserted.rows[0];
      if (hold === undefined) return 'already';
      const previous = await client.query<{
        id: string;
        reason: string;
        held_at: Date;
        release_reason: string | null;
        released_at: Date | null;
      }>(
        `SELECT id, reason, held_at, release_reason, released_at FROM locale_hold
          WHERE locale = $1 AND id <> $2 ORDER BY held_at DESC LIMIT 1`,
        [locale, hold.id],
      );
      const last = previous.rows[0];
      await audit(client, {
        actorId,
        action: 'locale.hold',
        locale,
        reason,
        previous:
          last === undefined
            ? { held: false }
            : {
                held: false,
                last_hold_id: last.id,
                last_reason: last.reason,
                last_held_at: last.held_at.toISOString(),
                last_release_reason: last.release_reason,
                last_released_at: last.released_at?.toISOString() ?? null,
              },
        next: { held: true, hold_id: hold.id, held_at: hold.held_at.toISOString() },
      });
      return 'held';
    });
  }

  /** Releases the hold in force; false when there is none. */
  async release(locale: string, actorId: string, reason: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; reason: string; held_at: Date }>(
        `UPDATE locale_hold
            SET released_at = now(), released_by = $2, release_reason = $3
          WHERE locale = $1 AND released_at IS NULL
          RETURNING id, reason, held_at`,
        [locale, actorId, reason],
      );
      const released = rows[0];
      if (released === undefined) return false;
      await audit(client, {
        actorId,
        action: 'locale.release',
        locale,
        reason,
        previous: {
          held: true,
          hold_id: released.id,
          reason: released.reason,
          held_at: released.held_at.toISOString(),
        },
        next: { held: false, hold_id: released.id },
      });
      return true;
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

async function audit(
  client: PoolClient,
  entry: {
    actorId: string;
    action: string;
    locale: string;
    reason: string;
    previous: Record<string, unknown>;
    next: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'locale', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.locale,
      entry.reason,
      JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
