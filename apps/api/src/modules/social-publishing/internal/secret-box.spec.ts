import { describe, expect, it } from 'vitest';
import { SecretBox, SecretUnreadable, credentialAad, secretBoxFromEnv } from './secret-box';

const SECRET = 'a-session-secret-of-at-least-32-characters';
const KEY = 'buffer-personal-key-0123456789abcdef';
const AAD = credentialAad('buffer', '7f1c2a9e-0000-4000-8000-000000000001');

const flip = (b: Buffer, at = 0): Buffer => {
  const copy = Buffer.from(b);
  copy[at] = copy[at]! ^ 0x01;
  return copy;
};

describe('the secret box (AES-256-GCM, HKDF from SESSION_SECRET)', () => {
  it('round-trips, with a fresh nonce each time and the key nowhere in the sealed bytes', () => {
    const box = new SecretBox(SECRET);
    const a = box.seal(KEY, AAD);
    const b = box.seal(KEY, AAD);
    expect(box.open(a, AAD)).toBe(KEY);
    expect(box.open(b, AAD)).toBe(KEY);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.iv).toHaveLength(12);
    expect(a.tag).toHaveLength(16);
    const stored = Buffer.concat([a.iv, a.tag, a.ciphertext]).toString('latin1');
    expect(stored).not.toContain(KEY);
  });

  it('refuses a changed tag, a changed ciphertext and a changed nonce', () => {
    const box = new SecretBox(SECRET);
    const sealed = box.seal(KEY, AAD);
    expect(() => box.open({ ...sealed, tag: flip(sealed.tag) }, AAD)).toThrow(SecretUnreadable);
    expect(() => box.open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, AAD)).toThrow(
      SecretUnreadable,
    );
    expect(() => box.open({ ...sealed, iv: flip(sealed.iv) }, AAD)).toThrow(SecretUnreadable);
    expect(() => box.open({ ...sealed, tag: sealed.tag.subarray(0, 8) }, AAD)).toThrow(
      SecretUnreadable,
    );
  });

  it('refuses another row or provider as associated data', () => {
    const box = new SecretBox(SECRET);
    const sealed = box.seal(KEY, AAD);
    expect(() =>
      box.open(sealed, credentialAad('buffer', '7f1c2a9e-0000-4000-8000-000000000002')),
    ).toThrow(SecretUnreadable);
    expect(() =>
      box.open(sealed, credentialAad('other', '7f1c2a9e-0000-4000-8000-000000000001')),
    ).toThrow(SecretUnreadable);
  });

  it('refuses another SESSION_SECRET, and its error never carries the key', () => {
    const sealed = new SecretBox(SECRET).seal(KEY, AAD);
    const other = new SecretBox(`${SECRET}-rotated`);
    let caught: unknown;
    try {
      other.open(sealed, AAD);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretUnreadable);
    expect(String((caught as Error).message)).not.toContain(KEY);
    expect(JSON.stringify(caught)).not.toContain(KEY);
  });

  it('gives no box for a missing or short SESSION_SECRET', () => {
    expect(secretBoxFromEnv({})).toBeNull();
    expect(secretBoxFromEnv({ SESSION_SECRET: 'short' })).toBeNull();
    expect(secretBoxFromEnv({ SESSION_SECRET: SECRET })).toBeInstanceOf(SecretBox);
    expect(() => new SecretBox('short')).toThrow(/at least 32/);
  });
});
