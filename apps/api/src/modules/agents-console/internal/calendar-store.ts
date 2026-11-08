/**
 * The calendar's Postgres store (T-1788, D-391): events, subscriptions, push devices and the reminders sent, each change a person makes with its `console_audit` row.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsoleCalendarEvent,
  ConsoleMe,
  ConsoleReminderSent,
  ConsoleSubscription,
  ConsoleSubscriptionInput,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { EventFields, RemindableEvent } from './calendar-rules';
import { writeConsoleAudit } from './console-store';

/** The person who writes from the computer (`import-calendar`): no console account. */
const COMPUTER = 'claude';

const EVENT_COLUMNS = `e.id, e.title, to_char(e.starts_on, 'YYYY-MM-DD') AS date,
  to_char(e.at_time, 'HH24:MI') AS time, e.repeat, e.basis,
  to_char(e.repeat_until, 'YYYY-MM-DD') AS repeat_until, e.remind_minutes, e.note, e.color,
  e.subscription_key, e.created_at, e.updated_at, u.display_name AS updated_by`;
const EVENT_FROM = 'console_event e LEFT JOIN console_user u ON u.id = e.updated_by';

interface EventRow {
  id: string;
  title: string;
  date: string;
  time: string | null;
  repeat: ConsoleCalendarEvent['repeat'];
  basis: ConsoleCalendarEvent['basis'];
  repeat_until: string | null;
  remind_minutes: number | null;
  note: string;
  color: ConsoleCalendarEvent['color'];
  subscription_key: string | null;
  created_at: Date;
  updated_at: Date;
  updated_by: string | null;
}

const event = (row: EventRow): ConsoleCalendarEvent => ({
  ...row,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

/** The fields an audit row records: what the person wrote, never the row's own bookkeeping. */
const fieldsOf = (e: ConsoleCalendarEvent): EventFields => ({
  title: e.title,
  date: e.date,
  time: e.time,
  repeat: e.repeat,
  basis: e.basis,
  repeat_until: e.repeat_until,
  remind_minutes: e.remind_minutes,
  note: e.note,
  color: e.color,
  subscription_key: e.subscription_key,
});

const SUBSCRIPTION_COLUMNS = `key, position, name, purpose, plan, price, started, renewal,
  to_char(renew_on, 'YYYY-MM-DD') AS renew_on, status, status_note, limits, payer, manage_url,
  manage_label, manage_note, source, paid, updated_at`;

/** A push device as the sender needs it. */
export interface ConsolePushDevice {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type EventOutcome =
  | { kind: 'ok'; event: ConsoleCalendarEvent }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string };

/**
 * The calendar's tables (T-1788, D-391): events, subscriptions, the push
 * devices and the reminders sent. Every change a person makes is written
 * with its `console_audit` row in the same transaction (rule 10), the
 * previous value with it.
 */
@Injectable()
export class PostgresCalendarStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // --- Events ----------------------------------------------------------------

  async events(): Promise<ConsoleCalendarEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM}
        WHERE e.deleted_at IS NULL ORDER BY e.starts_on, e.at_time NULLS FIRST, e.title`,
    );
    return rows.map(event);
  }

  async createEvent(input: EventFields, actor: ConsoleMe): Promise<EventOutcome> {
    return this.transaction(async (client) => {
      if (!(await this.subscriptionExists(client, input.subscription_key)))
        return { kind: 'refused', reason: 'No such subscription.' };
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_event
           (title, starts_on, at_time, repeat, basis, repeat_until, remind_minutes, note, color,
            subscription_key, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING id`,
        [...this.values(input), actor.id],
      );
      const id = rows[0]!.id;
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'calendar.event_created',
        targetType: 'calendar_event',
        targetId: id,
        reason: 'event added',
        next: input,
      });
      return { kind: 'ok', event: await this.eventById(client, id) };
    });
  }

  async updateEvent(id: string, input: EventFields, actor: ConsoleMe): Promise<EventOutcome> {
    return this.transaction(async (client) => {
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      if (!(await this.subscriptionExists(client, input.subscription_key)))
        return { kind: 'refused', reason: 'No such subscription.' };
      await client.query(
        `UPDATE console_event
            SET title = $1, starts_on = $2, at_time = $3, repeat = $4, basis = $5, repeat_until = $6,
                remind_minutes = $7, note = $8, color = $9, subscription_key = $10, updated_by = $11
          WHERE id = $12`,
        [...this.values(input), actor.id, id],
      );
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'calendar.event_changed',
        targetType: 'calendar_event',
        targetId: id,
        reason: 'event edited',
        previous: fieldsOf(before),
        next: input,
      });
      return { kind: 'ok', event: await this.eventById(client, id) };
    });
  }

  /** Removes an event from the calendar; its row stays for the audit trail. */
  async deleteEvent(id: string, actor: ConsoleMe): Promise<boolean> {
    return this.transaction(async (client) => {
      const before = await this.liveForUpdate(client, id);
      if (before === null) return false;
      await client.query(
        `UPDATE console_event SET deleted_at = now(), updated_by = $2 WHERE id = $1`,
        [id, actor.id],
      );
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'calendar.event_deleted',
        targetType: 'calendar_event',
        targetId: id,
        reason: 'event deleted',
        previous: fieldsOf(before),
      });
      return true;
    });
  }

  // --- Subscriptions -----------------------------------------------------------

  async subscriptions(): Promise<ConsoleSubscription[]> {
    const { rows } = await this.pool.query<
      Omit<ConsoleSubscription, 'updated_at'> & { updated_at: Date }
    >(`SELECT ${SUBSCRIPTION_COLUMNS} FROM console_subscription ORDER BY position, name`);
    return rows.map((row) => ({ ...row, updated_at: row.updated_at.toISOString() }));
  }

  // --- The import from the computer --------------------------------------------

  /**
   * The one-off move from the board's claude.ai page, and any later reload of
   * the subscriptions (`import-calendar`): subscriptions are written by key
   * (a reload replaces a row and audits the previous one); an event is added
   * once per `source_ref` and left alone after that, so a person's later edit
   * is never undone by running the import again. Audited as the computer's,
   * with `as` the console person it is filed under.
   */
  async importCalendar(
    subscriptions: readonly ConsoleSubscriptionInput[],
    events: readonly (EventFields & { source_ref: string })[],
    as: ConsoleMe,
  ): Promise<{
    subscriptions: { added: number; changed: number; same: number };
    events: { added: number; skipped: number };
  }> {
    return this.transaction(async (client) => {
      const counts = {
        subscriptions: { added: 0, changed: 0, same: 0 },
        events: { added: 0, skipped: 0 },
      };
      for (const sub of subscriptions) {
        const { rows } = await client.query<Omit<ConsoleSubscription, 'updated_at'>>(
          `SELECT ${SUBSCRIPTION_COLUMNS} FROM console_subscription WHERE key = $1 FOR UPDATE`,
          [sub.key],
        );
        const before = rows[0] ?? null;
        const keys = Object.keys(sub) as (keyof ConsoleSubscriptionInput)[];
        if (before !== null && keys.every((key) => before[key] === sub[key])) {
          counts.subscriptions.same += 1;
          continue;
        }
        await client.query(
          `INSERT INTO console_subscription
             (key, position, name, purpose, plan, price, started, renewal, renew_on, status,
              status_note, limits, payer, manage_url, manage_label, manage_note, source, paid, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now())
           ON CONFLICT (key) DO UPDATE SET
             position = EXCLUDED.position, name = EXCLUDED.name, purpose = EXCLUDED.purpose,
             plan = EXCLUDED.plan, price = EXCLUDED.price, started = EXCLUDED.started,
             renewal = EXCLUDED.renewal, renew_on = EXCLUDED.renew_on, status = EXCLUDED.status,
             status_note = EXCLUDED.status_note, limits = EXCLUDED.limits, payer = EXCLUDED.payer,
             manage_url = EXCLUDED.manage_url, manage_label = EXCLUDED.manage_label,
             manage_note = EXCLUDED.manage_note, source = EXCLUDED.source, paid = EXCLUDED.paid,
             updated_at = now()`,
          [
            sub.key,
            sub.position,
            sub.name,
            sub.purpose,
            sub.plan,
            sub.price,
            sub.started,
            sub.renewal,
            sub.renew_on,
            sub.status,
            sub.status_note,
            sub.limits,
            sub.payer,
            sub.manage_url,
            sub.manage_label,
            sub.manage_note,
            sub.source,
            sub.paid,
          ],
        );
        await writeConsoleAudit(client, {
          actorId: null,
          actorName: COMPUTER,
          action: before === null ? 'calendar.subscription_added' : 'calendar.subscription_changed',
          targetType: 'subscription',
          targetId: sub.key,
          reason: `import-calendar, filed for ${as.username}`,
          previous: before ?? undefined,
          next: sub,
        });
        if (before === null) counts.subscriptions.added += 1;
        else counts.subscriptions.changed += 1;
      }
      for (const input of events) {
        if (!(await this.subscriptionExists(client, input.subscription_key)))
          throw new Error(`${input.source_ref}: no subscription ${input.subscription_key}`);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO console_event
             (title, starts_on, at_time, repeat, basis, repeat_until, remind_minutes, note, color,
              subscription_key, created_by, updated_by, source_ref)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
           ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id`,
          [...this.values(input), as.id, input.source_ref],
        );
        const id = rows[0]?.id;
        if (id === undefined) {
          counts.events.skipped += 1;
          continue;
        }
        const { source_ref: ref, ...next } = input;
        await writeConsoleAudit(client, {
          actorId: null,
          actorName: COMPUTER,
          action: 'calendar.event_created',
          targetType: 'calendar_event',
          targetId: id,
          reason: `moved from ${ref}, filed for ${as.username}`,
          next,
        });
        counts.events.added += 1;
      }
      return counts;
    });
  }

  // --- Push devices --------------------------------------------------------------

  async deviceCount(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM console_push_device WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  /** Registers a browser for a person; an endpoint already known moves to them. Audited. */
  async addDevice(
    actor: ConsoleMe,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent: string | null,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_push_device (user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent
         RETURNING id`,
        [
          actor.id,
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth,
          userAgent,
        ],
      );
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'calendar.reminders_on',
        targetType: 'push_device',
        targetId: rows[0]!.id,
        reason: 'reminders switched on in a browser',
        next: { user_agent: userAgent },
      });
    });
  }

  async removeDevice(actor: ConsoleMe, endpoint: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `DELETE FROM console_push_device WHERE user_id = $1 AND endpoint = $2 RETURNING id`,
        [actor.id, endpoint],
      );
      const id = rows[0]?.id;
      if (id === undefined) return false;
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'calendar.reminders_off',
        targetType: 'push_device',
        targetId: id,
        reason: 'reminders switched off in a browser',
      });
      return true;
    });
  }

  /** Every enabled person's devices, or one person's. */
  async devices(userId?: string): Promise<ConsolePushDevice[]> {
    const { rows } = await this.pool.query<ConsolePushDevice>(
      `SELECT d.id, d.user_id, d.endpoint, d.p256dh, d.auth
         FROM console_push_device d JOIN console_user u ON u.id = d.user_id
        WHERE u.disabled_at IS NULL AND ($1::uuid IS NULL OR d.user_id = $1)
        ORDER BY d.created_at`,
      [userId ?? null],
    );
    return rows;
  }

  async deviceUsed(id: string): Promise<void> {
    await this.pool.query(`UPDATE console_push_device SET last_used_at = now() WHERE id = $1`, [
      id,
    ]);
  }

  /** A device whose push service said it is gone (404 or 410). */
  async deviceGone(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM console_push_device WHERE id = $1`, [id]);
  }

  // --- Reminders -------------------------------------------------------------------

  async remindable(): Promise<RemindableEvent[]> {
    const { rows } = await this.pool.query<RemindableEvent>(
      `SELECT e.id, e.title, to_char(e.starts_on, 'YYYY-MM-DD') AS date,
              to_char(e.at_time, 'HH24:MI') AS time, e.repeat, e.basis,
              to_char(e.repeat_until, 'YYYY-MM-DD') AS repeat_until, e.remind_minutes, e.updated_at
         FROM console_event e
        WHERE e.deleted_at IS NULL AND e.remind_minutes IS NOT NULL`,
    );
    return rows;
  }

  /** Claims one event's reminder for one day; false when it was claimed already. */
  async claimReminder(eventId: string, day: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO console_reminder_sent (event_id, occurs_on) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [eventId, day],
    );
    return (rowCount ?? 0) > 0;
  }

  async reminderSent(
    eventId: string,
    day: string,
    devices: number,
    delivered: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE console_reminder_sent SET devices = $3, delivered = $4 WHERE event_id = $1 AND occurs_on = $2`,
      [eventId, day, devices, delivered],
    );
  }

  async recentReminders(limit = 10): Promise<ConsoleReminderSent[]> {
    const { rows } = await this.pool.query<{
      event_id: string;
      title: string;
      occurs_on: string;
      sent_at: Date;
      delivered: number;
      devices: number;
    }>(
      `SELECT r.event_id, e.title, to_char(r.occurs_on, 'YYYY-MM-DD') AS occurs_on,
              r.claimed_at AS sent_at, r.delivered, r.devices
         FROM console_reminder_sent r JOIN console_event e ON e.id = r.event_id
        ORDER BY r.claimed_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({ ...row, sent_at: row.sent_at.toISOString() }));
  }

  // --- Helpers ----------------------------------------------------------------------

  private values(input: EventFields): unknown[] {
    return [
      input.title,
      input.date,
      input.time,
      input.repeat,
      input.basis,
      input.repeat_until,
      input.remind_minutes,
      input.note,
      input.color,
      input.subscription_key,
    ];
  }

  private async subscriptionExists(client: PoolClient, key: string | null): Promise<boolean> {
    if (key === null) return true;
    const { rows } = await client.query(`SELECT 1 FROM console_subscription WHERE key = $1`, [key]);
    return rows.length > 0;
  }

  private async liveForUpdate(
    client: PoolClient,
    id: string,
  ): Promise<ConsoleCalendarEvent | null> {
    const { rows } = await client.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM}
        WHERE e.id = $1 AND e.deleted_at IS NULL FOR UPDATE OF e`,
      [id],
    );
    return rows[0] === undefined ? null : event(rows[0]);
  }

  private async eventById(client: PoolClient, id: string): Promise<ConsoleCalendarEvent> {
    const { rows } = await client.query<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM ${EVENT_FROM} WHERE e.id = $1`,
      [id],
    );
    return event(rows[0]!);
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
