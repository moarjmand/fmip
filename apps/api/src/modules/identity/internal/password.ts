import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';

// promisify() drops the overload that takes options, so wrap by hand.
function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * Password hashing with Node's built-in scrypt (D-026): no dependency, memory-
 * hard, and the parameters travel with the hash so they can be raised later
 * without a migration. Format, all base64url:
 *
 *     scrypt$<N>$<r>$<p>$<salt>$<hash>
 */
const N = 16384; // 2^14: ~16 MiB per hash, tens of milliseconds.
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });

  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/**
 * Constant-time comparison against a stored hash. A malformed stored value is
 * treated as "does not match" rather than thrown, so a corrupt row cannot
 * become a way in.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');

  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0) || expected.length === 0) return false;

  const actual = await scrypt(password, salt, expected.length, { N: n, r, p });

  return timingSafeEqual(actual, expected);
}

/**
 * A hash of a random password, verified against when the account does not
 * exist, so that a login attempt costs the same time whether or not the
 * identifier is known. Computed once per process.
 */
let decoy: Promise<string> | undefined;

export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString('base64url'));
  return decoy;
}
