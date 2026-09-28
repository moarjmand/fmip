import { describe, expect, it } from 'vitest';
import { clientIpOf, refusalMessage, subjectOf } from './internal/auth-rate-limit';
import { clearSessionCookie, parseCookies, serializeSessionCookie } from './internal/cookies';
import { hashPassword, verifyPassword } from './internal/password';
import { hashToken, isWellFormedToken, newToken, sessionSecretFromEnv } from './internal/tokens';
import { passwordProblem, validateLogin, validateRegister } from './internal/validation';

describe('passwords', () => {
  it('hashes with scrypt and verifies only the right password', async () => {
    const stored = await hashPassword('correct horse battery');

    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored).not.toContain('correct horse');
    await expect(verifyPassword('correct horse battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse batterz', stored)).resolves.toBe(false);
  });

  it('salts: the same password hashes differently twice', async () => {
    const [a, b] = await Promise.all([
      hashPassword('same password!'),
      hashPassword('same password!'),
    ]);
    expect(a).not.toBe(b);
  });

  it('treats a corrupt stored value as a mismatch, not an exception', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'scrypt$x$8$1$$')).resolves.toBe(false);
  });

  it('rejects short, long and self-derived passwords', () => {
    expect(passwordProblem('short')).toMatch(/at least 10/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem('mostafa-arjmand-2026', ['mostafa'])).toMatch(/must not contain/);
    expect(passwordProblem('a perfectly fine one', ['mostafa'])).toBeUndefined();
  });
});

describe('tokens', () => {
  it('produces 256-bit base64url tokens and keyed hashes', () => {
    const token = newToken();

    expect(isWellFormedToken(token)).toBe(true);
    expect(hashToken(token, 'a'.repeat(32))).not.toBe(hashToken(token, 'b'.repeat(32)));
    expect(hashToken(token, 'a'.repeat(32))).toBe(hashToken(token, 'a'.repeat(32)));
  });

  it('refuses a missing or short SESSION_SECRET', () => {
    expect(() => sessionSecretFromEnv({})).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecretFromEnv({ SESSION_SECRET: 'short' })).toThrow(/at least 32/);
    expect(sessionSecretFromEnv({ SESSION_SECRET: 's'.repeat(32) })).toBe('s'.repeat(32));
  });
});

describe('cookies', () => {
  it('sets HttpOnly, SameSite=Lax, Path=/ and Secure only when asked', () => {
    const insecure = serializeSessionCookie('tok', { maxAge: 60, secure: false });
    const secure = serializeSessionCookie('tok', { maxAge: 60, secure: true });

    expect(insecure).toBe('fmip_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60');
    expect(secure).toBe('fmip_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=60; Secure');
    expect(clearSessionCookie({ secure: false })).toContain('Max-Age=0');
  });

  it('parses a Cookie header and skips junk', () => {
    expect(parseCookies('a=1; fmip_session=abc%20d; =x; novalue; b=2')).toEqual({
      a: '1',
      fmip_session: 'abc d',
      b: '2',
    });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('validateRegister', () => {
  const valid = {
    username: 'Mostafa_1',
    display_name: ' Mostafa ',
    email: 'Mostafa@Example.com',
    password: 'a long enough passphrase',
    country_id: '00000000-0000-4000-8000-000000000109',
    preferred_language: 'fa',
    timezone: 'Asia/Tehran',
    accept_rules: true,
  };

  it('normalises username and e-mail to lower case and trims the display name', () => {
    const result = validateRegister(valid);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.username).toBe('mostafa_1');
      expect(result.value.email).toBe('mostafa@example.com');
      expect(result.value.display_name).toBe('Mostafa');
    }
  });

  it('names every failing field at once', () => {
    const result = validateRegister({
      ...valid,
      username: 'no spaces here',
      email: 'not-an-email',
      password: 'short',
      timezone: 'Mars/Olympus',
      accept_rules: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fields).sort()).toEqual([
        'accept_rules',
        'email',
        'password',
        'timezone',
        'username',
      ]);
    }
  });

  it('rejects a password containing the username or the e-mail local part', () => {
    const result = validateRegister({ ...valid, password: 'xx mostafa_1 yy zz' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields.password).toMatch(/must not contain/);
  });
});

describe('validateLogin', () => {
  it('lower-cases the identifier and requires both fields', () => {
    expect(validateLogin({ identifier: 'Mostafa@Example.com', password: 'p' })).toEqual({
      ok: true,
      value: { identifier: 'mostafa@example.com', password: 'p' },
    });
    expect(validateLogin({ identifier: '', password: '' })).toEqual({
      ok: false,
      fields: { identifier: 'required', password: 'required' },
    });
  });
});

describe('rate limits before signing in (T-810)', () => {
  it('reads the forwarded address only when it is one', () => {
    expect(clientIpOf({ 'x-fmip-client-ip': '203.0.113.7' })).toBe('203.0.113.7');
    expect(clientIpOf({ 'x-fmip-client-ip': '2001:DB8::1' })).toBe('2001:db8::1');
    expect(clientIpOf({})).toBeNull();
    expect(clientIpOf({ 'x-fmip-client-ip': '' })).toBeNull();
    expect(clientIpOf({ 'x-fmip-client-ip': 'unknown' })).toBeNull();
    expect(clientIpOf({ 'x-fmip-client-ip': '203.0.113.7, 10.0.0.1' })).toBeNull();
  });

  it('hashes subjects, keyed and kept apart by kind', () => {
    const secret = 's'.repeat(32);
    const ip = subjectOf('ip', '203.0.113.7', secret);
    expect(ip).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ip).not.toContain('203');
    expect(subjectOf('ip', '203.0.113.7', secret)).toBe(ip);
    expect(subjectOf('account', '203.0.113.7', secret)).not.toBe(ip);
    expect(subjectOf('ip', '203.0.113.7', 't'.repeat(32))).not.toBe(ip);
  });

  it('says when to try again, in whole minutes, and nothing about an account', () => {
    expect(refusalMessage(1)).toBe('Too many attempts. Try again in 1 minute.');
    expect(refusalMessage(60)).toBe('Too many attempts. Try again in 1 minute.');
    expect(refusalMessage(61)).toBe('Too many attempts. Try again in 2 minutes.');
    expect(refusalMessage(3600)).toBe('Too many attempts. Try again in 60 minutes.');
  });
});
