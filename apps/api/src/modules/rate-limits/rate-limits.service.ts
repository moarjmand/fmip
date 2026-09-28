import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  RATE_REFUSAL_DAYS,
  RATE_REFUSAL_RETENTION_DAYS,
  type ApiError,
  type RateLimitsReport,
} from '@fmip/contracts';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { CEILINGS, EXEMPT } from './inventory';

const DAY_MS = 86_400_000;
/** How often, at most, a process deletes the days past the retention. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

export type MemberRateOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/** The last `days` UTC dates up to and including `now`'s, oldest first, as `YYYY-MM-DD`. */
export function daysUpTo(now: Date, days: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const out: string[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    out.push(new Date(today - back * DAY_MS).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The report from the inventory, the ceilings as the table has them now and
 * the refusals counted per day. A ceiling whose row is missing is reported
 * with `per_hour: null` -- not limited, said as such -- and a day with no
 * refusals is 0, not absent, so the page never has to guess.
 */
export function reportOf(
  limits: ReadonlyMap<string, number>,
  refusals: readonly { action: string; day: string; count: number }[],
  days: readonly string[],
  now: Date,
): RateLimitsReport {
  const counted = new Map(refusals.map((r) => [`${r.action}|${r.day}`, r.count]));
  return {
    ceilings: CEILINGS.map((ceiling) => ({
      action: ceiling.action,
      per_hour: limits.get(ceiling.action) ?? null,
      subject: ceiling.subject,
      enforced: ceiling.enforced,
      what: ceiling.what,
      routes: [...ceiling.routes],
      refusals: days.map((day) => ({ day, count: counted.get(`${ceiling.action}|${day}`) ?? 0 })),
    })),
    exempt: Object.entries(EXEMPT)
      .map(([route, reason]) => ({ route, reason }))
      .sort((a, b) => a.route.localeCompare(b.route)),
    days: [...days],
    generated_at: now.toISOString(),
  };
}

/**
 * Member rate limits enforced in the API, refusals counted, and the
 * inventory reported (T-811, D-103). Public surface:
 *
 * - `take(userId, action)`: one attempt against a `rate_limit` row, counted in
 *   `rate_window` like the triggers count, for work whose cost comes before
 *   any insert (a model call) or that the API alone writes. A refusal is
 *   counted in `rate_refusal` by the same statement.
 * - `recordRefusal(action)`: a database-enforced ceiling's refusal, counted
 *   when the API answers 429 (`main.ts`); the trigger rolled its own count
 *   back, so it cannot be counted there. Never throws, never delays a
 *   response.
 * - `report(now)`: behind `GET /admin/rate-limits`.
 */
@Injectable()
export class RateLimitsService {
  private readonly log = new Logger('RateLimits');
  private lastPrune = 0;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async take(userId: string, action: string): Promise<MemberRateOutcome> {
    const { rows } = await this.pool.query<{ refused: boolean; retry_after: number }>(
      `WITH ceiling AS (
         SELECT per_hour FROM rate_limit WHERE action = $2
       ),
       counted AS (
         INSERT INTO rate_window (user_id, action, window_start, count)
         SELECT $1, $2, date_trunc('hour', now()), 1 FROM ceiling
         ON CONFLICT (user_id, action, window_start)
           DO UPDATE SET count = rate_window.count + 1
         RETURNING count
       ),
       verdict AS (
         SELECT coalesce((SELECT count FROM counted) > (SELECT per_hour FROM ceiling), false)
                  AS refused
       ),
       refusal AS (
         INSERT INTO rate_refusal (action, day, count)
         SELECT $2, $3::date, 1 FROM verdict WHERE refused
         ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1
       )
       SELECT refused,
              ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                AS retry_after
         FROM verdict`,
      // The day is the application's, like the report's, not the database's.
      [userId, action, new Date().toISOString().slice(0, 10)],
    );
    const row = rows[0];
    if (row === undefined || !row.refused) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, row.retry_after) };
  }

  async recordRefusal(action: string, at: Date = new Date()): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
         ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
        [action, at.toISOString().slice(0, 10)],
      );
      if (at.getTime() - this.lastPrune >= PRUNE_EVERY_MS) {
        this.lastPrune = at.getTime();
        await this.pool.query(`DELETE FROM rate_refusal WHERE day < $1::date`, [
          new Date(at.getTime() - RATE_REFUSAL_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10),
        ]);
      }
    } catch (error) {
      this.log.warn(
        `rate_refusal.record_failed action=${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async report(now: Date): Promise<RateLimitsReport> {
    const days = daysUpTo(now, RATE_REFUSAL_DAYS);
    const [limits, refusals] = await Promise.all([
      this.pool.query<{ action: string; per_hour: number }>(
        `SELECT action, per_hour FROM rate_limit`,
      ),
      this.pool.query<{ action: string; day: string; count: number }>(
        `SELECT action, to_char(day, 'YYYY-MM-DD') AS day, count
           FROM rate_refusal
          WHERE day >= $1::date AND day <= $2::date`,
        [days[0], days[days.length - 1]],
      ),
    ]);
    return reportOf(
      new Map(limits.rows.map((r) => [r.action, r.per_hour])),
      refusals.rows,
      days,
      now,
    );
  }
}

/**
 * A member's refusal by an API-enforced ceiling: 429 `rate_limited`, with
 * `Retry-After` in seconds (the end of the hour) and a sentence about the
 * wait, like every other ceiling's refusal.
 */
export function refuseOverRate(
  reply: { header(name: string, value: string): unknown },
  outcome: Extract<MemberRateOutcome, { ok: false }>,
  what: string,
): never {
  const minutes = Math.max(1, Math.ceil(outcome.retryAfterSeconds / 60));
  void reply.header('retry-after', String(outcome.retryAfterSeconds));
  const body: ApiError = {
    error: 'rate_limited',
    message: `${what} Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  };
  throw new HttpException(body, 429);
}
