import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * Rate limits before signing in (T-810, D-093).
 *
 * The ceilings are rows in `rate_limit` (T-213); the counts are fixed hourly
 * windows in `auth_rate_window`, keyed by an HMAC of the address or of the
 * identifier typed, so the table never holds either in clear. A missing
 * `rate_limit` row means "not limited", as everywhere else.
 */

export type AuthRateAction =
  | 'login_failure_account'
  | 'login_failure_ip'
  | 'register_account'
  | 'register_ip'
  | 'password_forgot_account'
  | 'password_forgot_ip'
  | 'email_token_ip';

/** One counter to take from: an action and whose it is. */
export interface AuthRateCheck {
  action: AuthRateAction;
  /** The subject as an opaque HMAC, from `subjectOf`. */
  subject: string;
}

export type AuthRateOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/** The header the web app forwards the reader's address in (D-093). */
export const CLIENT_IP_HEADER = 'x-fmip-client-ip';

/**
 * The address a request came from, as the web app forwarded it, or `null`.
 *
 * Only a well-formed IP is accepted: anything else is not an address and must
 * not become a counter everyone shares. `null` means the per-address ceilings
 * do not apply to this request -- the per-account ones still do -- which is
 * the right failure: a missing header must not put every reader in one bucket.
 */
export function clientIpOf(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers[CLIENT_IP_HEADER];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (value === undefined || value === '' || value.length > 64) return null;
  if (isIP(value) === 0) return null;
  return value.toLowerCase();
}

/**
 * The opaque subject for a kind of key and its value. The kind is part of the
 * hashed text so an address and an identifier that happen to be the same
 * string never share a counter, and the `rate:` prefix keeps these HMACs apart
 * from token hashes made with the same secret.
 */
export function subjectOf(kind: 'ip' | 'account', value: string, secret: string): string {
  return createHmac('sha256', secret).update(`rate:${kind}:${value}`).digest('base64url');
}

/** The sentence a refusal carries. It names a wait, never an account. */
export function refusalMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

@Injectable()
export class AuthRateLimiter {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Count one attempt against every check, and say whether any is over its
   * ceiling. All are counted even when one refuses, in one statement, so two
   * attempts racing cannot both slip under a ceiling.
   *
   * `retryAfterSeconds` is the time to the end of the current hour: a fixed
   * window, whose cost (twice the ceiling across an hour boundary) is stated
   * in migration `..._rate-limit`.
   */
  async take(checks: readonly AuthRateCheck[]): Promise<AuthRateOutcome> {
    if (checks.length === 0) return { ok: true };
    const { rows } = await this.pool.query<{ refused: boolean; retry_after: number }>(
      `WITH wanted AS (
         SELECT w.subject, w.action, l.per_hour
           FROM unnest($1::text[], $2::text[]) AS w (subject, action)
           JOIN rate_limit l ON l.action = w.action
       ),
       counted AS (
         INSERT INTO auth_rate_window (subject, action, window_start, count)
         SELECT subject, action, date_trunc('hour', now()), 1 FROM wanted
         ON CONFLICT (subject, action, window_start)
           DO UPDATE SET count = auth_rate_window.count + 1
         RETURNING subject, action, count
       )
       SELECT coalesce(bool_or(c.count > w.per_hour), false) AS refused,
              ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                AS retry_after
         FROM counted c
         JOIN wanted w USING (subject, action)`,
      [checks.map((check) => check.subject), checks.map((check) => check.action)],
    );
    const row = rows[0];
    if (row === undefined || !row.refused) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, row.retry_after) };
  }

  /**
   * Give back an attempt that turned out not to count -- a sign-in that
   * succeeded. Counting first and giving back afterwards, rather than counting
   * only failures after the fact, is what keeps a burst of parallel guesses
   * from all being checked before any is counted.
   */
  async giveBack(checks: readonly AuthRateCheck[]): Promise<void> {
    if (checks.length === 0) return;
    await this.pool.query(
      `UPDATE auth_rate_window a
          SET count = greatest(a.count - 1, 0)
         FROM unnest($1::text[], $2::text[]) AS w (subject, action)
        WHERE a.subject = w.subject AND a.action = w.action
          AND a.window_start = date_trunc('hour', now())`,
      [checks.map((check) => check.subject), checks.map((check) => check.action)],
    );
  }

  /** Forget this hour's count for these checks (after a password reset). */
  async clear(checks: readonly AuthRateCheck[]): Promise<void> {
    if (checks.length === 0) return;
    await this.pool.query(
      `DELETE FROM auth_rate_window a
        USING unnest($1::text[], $2::text[]) AS w (subject, action)
        WHERE a.subject = w.subject AND a.action = w.action`,
      [checks.map((check) => check.subject), checks.map((check) => check.action)],
    );
  }
}
