import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * The social publisher's key at rest (T-1837, D-427 point 9): AES-256-GCM
 * with a 32-byte key derived by HKDF-SHA256 from `SESSION_SECRET`, info
 * `fmip/social-credential/v1`, `node:crypto` only -- no new variable, no
 * dependency. The associated data names the provider and the row
 * (`buffer:<row id>`), so a ciphertext copied into another row, or moved to
 * another provider, does not open.
 *
 * A changed `SESSION_SECRET` leaves the key unreadable: `open` throws
 * `SecretUnreadable` and publishing stops, said on `/health/social`. Nothing
 * here logs, and no error carries the plain text or the derived key.
 */

export const SECRET_BOX_INFO = 'fmip/social-credential/v1';

/** The box as the module provides it (null: no usable `SESSION_SECRET`, so no key is set or read). */
export const SOCIAL_SECRET_BOX = Symbol('SOCIAL_SECRET_BOX');

/** As `identity` requires of `SESSION_SECRET`; a shorter one gives no box at all. */
export const SECRET_BOX_MIN_SECRET_LENGTH = 32;

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedSecret {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/** The secret did not open: another `SESSION_SECRET`, a changed tag, ciphertext or associated data. */
export class SecretUnreadable extends Error {
  constructor() {
    super('the stored secret is unreadable (another SESSION_SECRET, or the row was changed)');
  }
}

/** The associated data of a provider's credential row. */
export const credentialAad = (provider: string, rowId: string): string => `${provider}:${rowId}`;

export class SecretBox {
  private readonly key: Buffer;

  constructor(sessionSecret: string) {
    if (sessionSecret.length < SECRET_BOX_MIN_SECRET_LENGTH) {
      throw new Error(
        `the secret box needs SESSION_SECRET of at least ${SECRET_BOX_MIN_SECRET_LENGTH} characters`,
      );
    }
    this.key = Buffer.from(
      hkdfSync('sha256', Buffer.from(sessionSecret, 'utf8'), Buffer.alloc(0), SECRET_BOX_INFO, 32),
    );
  }

  seal(plain: string, aad: string): SealedSecret {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { iv, tag: cipher.getAuthTag(), ciphertext };
  }

  open(sealed: SealedSecret, aad: string): string {
    if (sealed.iv.length !== IV_BYTES || sealed.tag.length !== TAG_BYTES) {
      throw new SecretUnreadable();
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(sealed.tag);
      return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Node's own message ("Unsupported state or unable to authenticate data") says nothing
      // secret, but the error is replaced all the same so no layer below is ever passed on.
      throw new SecretUnreadable();
    }
  }
}

/** The box from `SESSION_SECRET`, or null when it is missing or short (the API refuses to boot then anyway). */
export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | null {
  const secret = env.SESSION_SECRET ?? '';
  return secret.length < SECRET_BOX_MIN_SECRET_LENGTH ? null : new SecretBox(secret);
}
