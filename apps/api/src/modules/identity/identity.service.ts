import { Inject, Injectable } from '@nestjs/common';
import type {
  AuthUser,
  DeleteAccountRequest,
  LoginRequest,
  RegisterRequest,
} from '@fmip/contracts';
import { PostgresAccountDeletionStore } from './internal/account-deletion-store';
import {
  type AuthRateCheck,
  AuthRateLimiter,
  type AuthRateOutcome,
  subjectOf,
} from './internal/auth-rate-limit';
import { clearSessionCookie, serializeSessionCookie } from './internal/cookies';
import { PostgresIdentityStore, toAuthUser } from './internal/identity-store';
import { MAILER, type Mailer } from './internal/mailer';
import { decoyHash, hashPassword, verifyPassword } from './internal/password';
import { hashToken, newToken } from './internal/tokens';

// The module's public surface. Other modules import from this file only.
export { SESSION_COOKIE, parseCookies } from './internal/cookies';
export { clientIpOf, refusalMessage } from './internal/auth-rate-limit';

export interface IdentityOptions {
  /** Keys the HMAC of every session and e-mail token. */
  sessionSecret: string;
  sessionTtlSeconds: number;
  verifyEmailTtlSeconds: number;
  resetPasswordTtlSeconds: number;
  /** Where e-mailed links point, e.g. https://fmip.example. */
  webBaseUrl: string;
  /** Session cookie only over HTTPS. True in production. */
  cookieSecure: boolean;
}

export const IDENTITY_OPTIONS = Symbol('IDENTITY_OPTIONS');

export const DEFAULT_IDENTITY_OPTIONS: Omit<
  IdentityOptions,
  'sessionSecret' | 'webBaseUrl' | 'cookieSecure'
> = {
  sessionTtlSeconds: 14 * 24 * 60 * 60,
  verifyEmailTtlSeconds: 24 * 60 * 60,
  resetPasswordTtlSeconds: 60 * 60,
};

/** A request refused by a rate limit (T-810): when to try again, and nothing else. */
export interface Limited {
  kind: 'limited';
  retryAfterSeconds: number;
}

export type RegisterOutcome =
  | { kind: 'created'; user: AuthUser; sessionToken: string }
  | Limited
  | { kind: 'conflict'; fields: Record<string, string> }
  | { kind: 'invalid'; fields: Record<string, string> };

export type DeleteAccountOutcome =
  | 'deleted'
  | 'wrong_password'
  | 'wrong_confirmation'
  /** No active account behind the id: already deleted, or never was. */
  | 'unknown';

/** The audit reason of a member deleting their own account (D-094). */
export const SELF_SERVICE_DELETION = 'self-service deletion';

export type LoginOutcome =
  { kind: 'signed_in'; user: AuthUser; sessionToken: string } | { kind: 'refused' } | Limited;

/** A yes/no outcome that a rate limit can also refuse. */
export type Checked = boolean | Limited;

/**
 * The roles `user_role` can grant (migration `..._identity`, `editor` added in
 * `..._editor-role` for T-261).
 *
 * `editor` is not `moderator`, and the difference is deliberate: moderation is
 * about conduct, editorial review is about whether a piece of writing is good
 * enough to publish under the platform's name. One role for both would make
 * every moderator an editor by accident, and would leave no way to appoint
 * somebody to read analysis without also handing them the power to sanction.
 */
export type UserRole = 'admin' | 'founder' | 'moderator' | 'editor';

/**
 * Registration, sessions, e-mail verification and password reset (T-040).
 *
 * The rules that matter for security live here, in one place:
 *
 *   - A login always mints a new session token. Whatever cookie the client
 *     sent is ignored, never upgraded: that is the session-fixation defence.
 *   - "Wrong password" and "no such account" are the same answer, and take
 *     the same time (a decoy hash is verified when the account is unknown).
 *   - Forgotten-password requests answer identically whether or not the
 *     address is known.
 *   - A password reset revokes every session of the account.
 *   - E-mail tokens are single-use, decided by the database.
 *   - Signing in, signing up, asking for a reset e-mail and using an e-mailed
 *     link are rate limited per network address and per identifier typed
 *     (T-810, D-093), and the refusal is checked before the password is: it
 *     says when to try again and is the same whether or not an account exists.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly store: PostgresIdentityStore,
    private readonly deletion: PostgresAccountDeletionStore,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
    private readonly limits: AuthRateLimiter,
  ) {}

  async register(
    input: RegisterRequest,
    userAgent: string | null,
    clientIp: string | null = null,
  ): Promise<RegisterOutcome> {
    const taken = await this.limits.take(
      this.checks(clientIp, 'register_ip', input.email, 'register_account'),
    );
    if (!taken.ok) return limited(taken);

    const created = await this.store.createUser({
      username: input.username,
      displayName: input.display_name,
      email: input.email,
      countryId: input.country_id,
      preferredLanguage: input.preferred_language,
      timezone: input.timezone,
      passwordHash: await hashPassword(input.password),
    });

    if (!created.ok) {
      if (created.conflict === 'country') {
        return { kind: 'invalid', fields: { country_id: 'unknown country' } };
      }
      return { kind: 'conflict', fields: { [created.conflict]: 'already taken' } };
    }

    const user = toAuthUser(created.user);
    await this.sendVerificationEmail(user);
    const sessionToken = await this.startSession(user.id, userAgent);

    return { kind: 'created', user, sessionToken };
  }

  async login(
    input: LoginRequest,
    userAgent: string | null,
    clientIp: string | null = null,
  ): Promise<LoginOutcome> {
    // Counted before the password is checked and given back on success, so a
    // burst of parallel guesses cannot all be checked before any is counted.
    const checks = this.checks(
      clientIp,
      'login_failure_ip',
      input.identifier,
      'login_failure_account',
    );
    const taken = await this.limits.take(checks);
    if (!taken.ok) return limited(taken);

    const found = await this.store.findForLogin(input.identifier);

    // Verify against something even when there is nothing, so the response
    // time does not say whether the identifier exists.
    const storedHash = found?.passwordHash ?? (await decoyHash());
    const matches = await verifyPassword(input.password, storedHash);

    if (found === null || found.passwordHash === null || !matches) return { kind: 'refused' };

    await this.limits.giveBack(checks);
    const sessionToken = await this.startSession(found.user.id, userAgent);
    return { kind: 'signed_in', user: toAuthUser(found.user), sessionToken };
  }

  /** The user behind a session cookie value, or `null`. */
  async authenticate(sessionToken: string | undefined): Promise<AuthUser | null> {
    if (sessionToken === undefined || sessionToken === '') return null;
    const row = await this.store.findSessionUser(this.hash(sessionToken));
    return row === null ? null : toAuthUser(row);
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken === undefined || sessionToken === '') return;
    await this.store.revokeSession(this.hash(sessionToken));
  }

  async verifyEmail(token: string, clientIp: string | null = null): Promise<Checked> {
    const taken = await this.limits.take(this.checks(clientIp, 'email_token_ip'));
    if (!taken.ok) return limited(taken);

    const userId = await this.store.consumeEmailToken(this.hash(token), 'verify_email');
    if (userId === null) return false;
    await this.store.markEmailVerified(userId);
    return true;
  }

  /**
   * Always resolves the same way; whether mail was sent is not revealed. The
   * limit is counted on the address typed, so it refuses a known and an
   * unknown address alike.
   */
  async requestPasswordReset(
    email: string,
    clientIp: string | null = null,
  ): Promise<{ kind: 'accepted' } | Limited> {
    const taken = await this.limits.take(
      this.checks(clientIp, 'password_forgot_ip', email, 'password_forgot_account'),
    );
    if (!taken.ok) return limited(taken);

    const user = await this.store.findByEmail(email);
    if (user === null) return { kind: 'accepted' };

    const token = newToken();
    await this.store.createEmailToken(
      user.id,
      'reset_password',
      this.hash(token),
      this.expiry(this.options.resetPasswordTtlSeconds),
    );
    await this.mailer.send({
      to: user.email,
      subject: 'Reset your FMIP password',
      text: [
        `Hello ${user.display_name},`,
        '',
        'Someone asked to reset the password for this address. If it was you, open:',
        `${this.options.webBaseUrl}/en/reset-password?token=${token}`,
        '',
        `The link works once and expires in ${Math.round(this.options.resetPasswordTtlSeconds / 60)} minutes.`,
        'If it was not you, nothing has changed and you can ignore this message.',
      ].join('\n'),
    });
    return { kind: 'accepted' };
  }

  /**
   * Sets the new password and signs the account out everywhere. The failed
   * sign-ins counted against the account's username and address are
   * forgotten: whoever reset it has proved they hold the mailbox, and must
   * not stay locked out by guesses somebody else made.
   */
  async resetPassword(
    token: string,
    password: string,
    clientIp: string | null = null,
  ): Promise<Checked> {
    const taken = await this.limits.take(this.checks(clientIp, 'email_token_ip'));
    if (!taken.ok) return limited(taken);

    const userId = await this.store.consumeEmailToken(this.hash(token), 'reset_password');
    if (userId === null) return false;

    await this.store.setPassword(userId, await hashPassword(password));
    await this.store.revokeAllSessions(userId);

    const user = await this.store.findById(userId);
    if (user !== null) {
      await this.limits.clear(
        [user.username, user.email].map((identifier) => ({
          action: 'login_failure_account' as const,
          subject: subjectOf('account', identifier.toLowerCase(), this.options.sessionSecret),
        })),
      );
    }
    return true;
  }

  /**
   * Deletes the signed-in member's account (T-812, D-094), confirmed by their
   * password and their username typed again. Everything happens in one
   * transaction with its audit row (actor: the member); the sessions go with
   * it, so the cookie that asked is dead when this returns `deleted`.
   *
   * The password is checked before the confirmation, so a wrong username
   * never tells a stranger at an unlocked screen whether the password was
   * right.
   */
  async deleteAccount(userId: string, input: DeleteAccountRequest): Promise<DeleteAccountOutcome> {
    const found = await this.deletion.credentialsOf(userId);
    const storedHash = found?.passwordHash ?? (await decoyHash());
    const matches = await verifyPassword(input.password, storedHash);
    if (found === null) return 'unknown';
    if (found.passwordHash === null || !matches) return 'wrong_password';
    if (input.confirm !== found.username) return 'wrong_confirmation';

    const done = await this.deletion.delete(userId, {
      actorId: userId,
      reason: SELF_SERVICE_DELETION,
    });
    return done === null ? 'unknown' : 'deleted';
  }

  /** For other boundaries that hold a user id and need the account as the API describes it. */
  async userById(userId: string): Promise<AuthUser | null> {
    const row = await this.store.findById(userId);
    return row === null ? null : toAuthUser(row);
  }

  /** The public account behind a username (profiles, ratings), or null. */
  async userByUsername(username: string): Promise<AuthUser | null> {
    const row = await this.store.findByUsername(username);
    return row === null ? null : toAuthUser(row);
  }

  /** The active account behind an e-mail address, for an operator's tool (T-502), or null. */
  async userByEmail(email: string): Promise<AuthUser | null> {
    const row = await this.store.findByEmail(email.trim().toLowerCase());
    return row === null ? null : toAuthUser(row);
  }

  /** Granted roles only (user_role); ordinary members have none. */
  async hasRole(userId: string, role: UserRole): Promise<boolean> {
    return this.store.hasRole(userId, role);
  }

  /** The ids of the active accounts holding a role: who an administrator's alert is for (T-802). */
  holdersOf(role: UserRole): Promise<string[]> {
    return this.store.holdersOf(role);
  }

  /** display_name lives on the account; the profile boundary changes it through here. */
  async updateDisplayName(userId: string, displayName: string): Promise<void> {
    await this.store.updateDisplayName(userId, displayName);
  }

  sessionCookie(sessionToken: string): string {
    return serializeSessionCookie(sessionToken, {
      maxAge: this.options.sessionTtlSeconds,
      secure: this.options.cookieSecure,
    });
  }

  clearedSessionCookie(): string {
    return clearSessionCookie({ secure: this.options.cookieSecure });
  }

  private async startSession(userId: string, userAgent: string | null): Promise<string> {
    const token = newToken();
    await this.store.createSession(
      userId,
      this.hash(token),
      this.expiry(this.options.sessionTtlSeconds),
      userAgent === null ? null : userAgent.slice(0, 200),
    );
    return token;
  }

  private async sendVerificationEmail(user: AuthUser): Promise<void> {
    const token = newToken();
    await this.store.createEmailToken(
      user.id,
      'verify_email',
      this.hash(token),
      this.expiry(this.options.verifyEmailTtlSeconds),
    );
    await this.mailer.send({
      to: user.email,
      subject: 'Verify your FMIP e-mail address',
      text: [
        `Hello ${user.display_name},`,
        '',
        'Confirm this address to unlock predictions:',
        `${this.options.webBaseUrl}/en/verify-email?token=${token}`,
        '',
        `The link works once and expires in ${Math.round(this.options.verifyEmailTtlSeconds / 3600)} hours.`,
      ].join('\n'),
    });
  }

  /**
   * The counters one request takes from: the address's when the web app named
   * one, and the identifier's when there is one. No address means no
   * per-address ceiling, never one shared bucket for everybody.
   */
  private checks(
    clientIp: string | null,
    ipAction: AuthRateCheck['action'],
    identifier?: string,
    accountAction?: AuthRateCheck['action'],
  ): AuthRateCheck[] {
    const secret = this.options.sessionSecret;
    const checks: AuthRateCheck[] = [];
    if (clientIp !== null) {
      checks.push({ action: ipAction, subject: subjectOf('ip', clientIp, secret) });
    }
    if (identifier !== undefined && accountAction !== undefined) {
      checks.push({
        action: accountAction,
        subject: subjectOf('account', identifier.trim().toLowerCase(), secret),
      });
    }
    return checks;
  }

  private hash(token: string): string {
    return hashToken(token, this.options.sessionSecret);
  }

  private expiry(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }
}

function limited(outcome: Extract<AuthRateOutcome, { ok: false }>): Limited {
  return { kind: 'limited', retryAfterSeconds: outcome.retryAfterSeconds };
}
