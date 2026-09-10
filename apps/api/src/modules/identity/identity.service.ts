import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser, LoginRequest, RegisterRequest } from '@fmip/contracts';
import { clearSessionCookie, serializeSessionCookie } from './internal/cookies';
import { PostgresIdentityStore, toAuthUser } from './internal/identity-store';
import { MAILER, type Mailer } from './internal/mailer';
import { decoyHash, hashPassword, verifyPassword } from './internal/password';
import { hashToken, newToken } from './internal/tokens';

// The module's public surface. Other modules import from this file only.
export { SESSION_COOKIE, parseCookies } from './internal/cookies';

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

export type RegisterOutcome =
  | { kind: 'created'; user: AuthUser; sessionToken: string }
  | { kind: 'conflict'; fields: Record<string, string> }
  | { kind: 'invalid'; fields: Record<string, string> };

export interface Login {
  user: AuthUser;
  sessionToken: string;
}

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
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly store: PostgresIdentityStore,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(IDENTITY_OPTIONS) private readonly options: IdentityOptions,
  ) {}

  async register(input: RegisterRequest, userAgent: string | null): Promise<RegisterOutcome> {
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

  async login(input: LoginRequest, userAgent: string | null): Promise<Login | null> {
    const found = await this.store.findForLogin(input.identifier);

    // Verify against something even when there is nothing, so the response
    // time does not say whether the identifier exists.
    const storedHash = found?.passwordHash ?? (await decoyHash());
    const matches = await verifyPassword(input.password, storedHash);

    if (found === null || found.passwordHash === null || !matches) return null;

    const sessionToken = await this.startSession(found.user.id, userAgent);
    return { user: toAuthUser(found.user), sessionToken };
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

  async verifyEmail(token: string): Promise<boolean> {
    const userId = await this.store.consumeEmailToken(this.hash(token), 'verify_email');
    if (userId === null) return false;
    await this.store.markEmailVerified(userId);
    return true;
  }

  /** Always resolves the same way; whether mail was sent is not revealed. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.store.findByEmail(email);
    if (user === null) return;

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
  }

  /** Sets the new password and signs the account out everywhere. */
  async resetPassword(token: string, password: string): Promise<boolean> {
    const userId = await this.store.consumeEmailToken(this.hash(token), 'reset_password');
    if (userId === null) return false;

    await this.store.setPassword(userId, await hashPassword(password));
    await this.store.revokeAllSessions(userId);
    return true;
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

  private hash(token: string): string {
    return hashToken(token, this.options.sessionSecret);
  }

  private expiry(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }
}
