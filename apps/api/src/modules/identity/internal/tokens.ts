import { createHmac, randomBytes } from 'node:crypto';

/**
 * Opaque tokens for sessions and e-mailed links.
 *
 * The client holds 256 random bits; the database holds an HMAC of them keyed
 * with SESSION_SECRET. Guessing is hopeless, and a copy of the database is
 * useless without the secret. The HMAC is deterministic, so the row is found
 * by an equality lookup on a unique column.
 */
export const TOKEN_BYTES = 32;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('base64url');
}

/** A token as it arrives from a client: the right alphabet and length, or nothing. */
export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export const SESSION_SECRET_MIN_LENGTH = 32;

/**
 * Reads SESSION_SECRET, refusing a missing or short one. A weak secret would
 * not fail loudly anywhere else; it would just make every token forgeable.
 */
export function sessionSecretFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET;

  if (secret === undefined || secret.length < SESSION_SECRET_MIN_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be set and at least ${SESSION_SECRET_MIN_LENGTH} characters long; see .env.example.`,
    );
  }

  return secret;
}
