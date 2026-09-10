import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** A `user_account` row as the queries below return it. */
export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  email: string;
  email_verified_at: Date | null;
  country_id: string;
  preferred_language: string;
  timezone: string;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Date;
}

export interface NewUser {
  username: string;
  displayName: string;
  email: string;
  countryId: string;
  preferredLanguage: string;
  timezone: string;
  passwordHash: string;
}

export type CreateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; conflict: 'username' | 'email' }
  | { ok: false; conflict: 'country' };

export type EmailTokenKind = 'verify_email' | 'reset_password';

export function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    email: row.email,
    email_verified: row.email_verified_at !== null,
    country_id: row.country_id,
    preferred_language: row.preferred_language,
    timezone: row.timezone,
    created_at: row.created_at.toISOString(),
  };
}

const USER_COLUMNS = `u.id, u.username, u.display_name, u.email, u.email_verified_at, u.country_id,
  u.preferred_language, u.timezone, u.status, u.created_at`;

function pgError(error: unknown): { code: string; constraint: string | undefined } | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (typeof code !== 'string') return null;
  return { code, constraint: typeof constraint === 'string' ? constraint : undefined };
}

/**
 * SQL for the identity tables (D-025). Uniqueness and existence are decided by
 * the database and translated here into results the service can act on: the
 * unique-violation on a username is a 409 to the client, not a 500.
 */
@Injectable()
export class PostgresIdentityStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The user and their password credential, in one transaction: neither exists without the other. */
  async createUser(input: NewUser): Promise<CreateUserResult> {
    const client: PoolClient = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<UserRow>(
        `INSERT INTO user_account AS u
           (username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING ${USER_COLUMNS}`,
        [
          input.username,
          input.displayName,
          input.email,
          input.countryId,
          input.preferredLanguage,
          input.timezone,
        ],
      );
      const user = rows[0];
      if (user === undefined) throw new Error('user_account insert returned no row');

      await client.query(
        `INSERT INTO credential (user_id, kind, secret_hash) VALUES ($1, 'password', $2)`,
        [user.id, input.passwordHash],
      );

      await client.query('COMMIT');
      return { ok: true, user };
    } catch (error: unknown) {
      await client.query('ROLLBACK');

      const known = pgError(error);
      if (known?.code === '23505') {
        if (known.constraint === 'user_account_username_unique')
          return { ok: false, conflict: 'username' };
        if (known.constraint === 'user_account_email_unique')
          return { ok: false, conflict: 'email' };
      }
      if (known?.code === '23503' && known.constraint === 'user_account_country_id_fkey') {
        return { ok: false, conflict: 'country' };
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /** By username or e-mail (both stored lower-case), with the password hash if one exists. */
  async findForLogin(
    identifier: string,
  ): Promise<{ user: UserRow; passwordHash: string | null } | null> {
    const { rows } = await this.pool.query<UserRow & { secret_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, c.secret_hash
         FROM user_account u
         LEFT JOIN credential c ON c.user_id = u.id AND c.kind = 'password'
        WHERE (u.username = $1 OR u.email = $1) AND u.status = 'active'`,
      [identifier],
    );
    const row = rows[0];
    if (row === undefined) return null;

    const { secret_hash: passwordHash, ...user } = row;
    return { user, passwordHash };
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_account u WHERE u.email = $1 AND u.status = 'active'`,
      [email],
    );
    return rows[0] ?? null;
  }

  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    userAgent: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO session (user_id, token_hash, expires_at, user_agent) VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, expiresAt, userAgent],
    );
  }

  /**
   * The live session's user, or `null`. Touches `last_seen_at` at most every
   * five minutes so a busy client does not turn every read into a write.
   */
  async findSessionUser(tokenHash: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query<UserRow>(
      `WITH touched AS (
         UPDATE session SET last_seen_at = now()
          WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
            AND last_seen_at < now() - interval '5 minutes'
       )
       SELECT ${USER_COLUMNS}
         FROM session s
         JOIN user_account u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
          AND u.status = 'active'`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  /** Every live session of the user. Returns how many were ended. */
  async revokeAllSessions(userId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE session SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    return rowCount ?? 0;
  }

  async createEmailToken(
    userId: string,
    kind: EmailTokenKind,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_token (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [userId, kind, tokenHash, expiresAt],
    );
  }

  /**
   * Marks the token used and returns its user, or `null` if it is unknown,
   * expired, of another kind, or already used. Single-use is decided by this
   * one UPDATE, so two concurrent submissions cannot both succeed.
   */
  async consumeEmailToken(tokenHash: string, kind: EmailTokenKind): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `UPDATE email_token SET used_at = now()
        WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [tokenHash, kind],
    );
    return rows[0]?.user_id ?? null;
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_account SET email_verified_at = now() WHERE id = $1 AND email_verified_at IS NULL`,
      [userId],
    );
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO credential (user_id, kind, secret_hash) VALUES ($1, 'password', $2)
         ON CONFLICT (user_id, kind) DO UPDATE SET secret_hash = EXCLUDED.secret_hash`,
      [userId, passwordHash],
    );
  }
}
