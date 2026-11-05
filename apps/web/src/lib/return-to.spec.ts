import { describe, expect, it } from 'vitest';
import {
  RETURN_MAX_LENGTH,
  RETURN_PARAM,
  loginHref,
  registerHref,
  safeReturnPath,
  withReturn,
} from './return-to';

describe('safeReturnPath (T-1736, D-358)', () => {
  it('accepts a path under the page’s own locale, with its query and fragment', () => {
    for (const path of [
      '/en',
      '/en/following',
      '/en/following/saved',
      '/en/settings/notifications',
      '/en/scores?unpicked=1',
      '/en/match/00000000-0000-4000-8000-000000000901?pick=away#pick',
      '/en/u/some_one/compare',
      '/en/groups/caf%C3%A9',
    ]) {
      expect(safeReturnPath('en', path), path).toBe(path);
    }
    expect(safeReturnPath('fa', '/fa/friends')).toBe('/fa/friends');
  });

  it('reads the first value of a repeated parameter', () => {
    expect(safeReturnPath('en', ['/en/friends', 'https://evil.example'])).toBe('/en/friends');
    expect(safeReturnPath('en', ['https://evil.example', '/en/friends'])).toBeNull();
  });

  it('refuses nothing, an empty value and anything too long', () => {
    expect(safeReturnPath('en', undefined)).toBeNull();
    expect(safeReturnPath('en', null)).toBeNull();
    expect(safeReturnPath('en', '')).toBeNull();
    expect(safeReturnPath('en', [])).toBeNull();
    const long = `/en/${'a'.repeat(RETURN_MAX_LENGTH)}`;
    expect(safeReturnPath('en', long)).toBeNull();
    expect(safeReturnPath('en', `/en/${'a'.repeat(RETURN_MAX_LENGTH - 4)}`)).not.toBeNull();
  });

  it('refuses another origin however it is written', () => {
    for (const hostile of [
      'https://evil.example/en/following',
      'http://evil.example',
      '//evil.example/en/following',
      '///evil.example',
      'javascript:alert(1)',
      'data:text/html,x',
      'mailto:someone@example.com',
      'evil.example/en',
      'en/following',
      '/\\evil.example',
      '\\\\evil.example',
      '/en\\..\\evil',
      '/en/\\evil.example',
      '/en//evil.example',
      '/en/%5Cevil.example',
      '/en/%2F%2Fevil.example',
      '/%2Fevil.example',
      ' /en/following',
      '/en/following ',
    ]) {
      expect(safeReturnPath('en', hostile), JSON.stringify(hostile)).toBeNull();
    }
  });

  it('refuses control characters, written or encoded', () => {
    for (const hostile of [
      '/en/following\n',
      '/en/\tfollowing',
      '/en/follow\r\nSet-Cookie: x=1',
      '/en/follow\u0000ing',
      '/en/follow\u007fing',
      '/en/follow\u0085ing',
      '/en/follow%0d%0aing',
      '/en/follow%00ing',
      '/en/follow%09ing',
      '/en/follow%20ing',
    ]) {
      expect(safeReturnPath('en', hostile), JSON.stringify(hostile)).toBeNull();
    }
  });

  it('refuses a path that climbs out of the locale or cannot be decoded', () => {
    for (const hostile of [
      '/en/../admin',
      '/en/./following',
      '/en/..',
      '/en/%2e%2e/admin',
      '/en/%2E%2E%2Fadmin',
      '/en/%',
      '/en/%E0%A4%A',
    ]) {
      expect(safeReturnPath('en', hostile), hostile).toBeNull();
    }
  });

  it('refuses a path outside the page’s locale', () => {
    for (const elsewhere of ['/', '/fa/following', '/following', '/english/following', '/EN/x']) {
      expect(safeReturnPath('en', elsewhere), elsewhere).toBeNull();
    }
    expect(safeReturnPath('fa', '/en/following')).toBeNull();
  });

  it('refuses the account pages and the first run as destinations', () => {
    for (const page of [
      '/en/login',
      '/en/login?next=/en/following',
      '/en/register',
      '/en/Register',
      '/en/forgot-password',
      '/en/reset-password?token=x',
      '/en/verify-email?token=x',
      '/en/account-deleted',
      '/en/welcome?step=language',
      '/en/%6Cogin',
    ]) {
      expect(safeReturnPath('en', page), page).toBeNull();
    }
    // A page that only starts with the same letters is a page of its own.
    expect(safeReturnPath('en', '/en/login-history')).toBe('/en/login-history');
  });
});

describe('the links that carry the return address', () => {
  it('encodes the address once, under the one parameter name', () => {
    expect(RETURN_PARAM).toBe('next');
    expect(withReturn('/en/login', '/en/scores?unpicked=1')).toBe(
      '/en/login?next=%2Fen%2Fscores%3Funpicked%3D1',
    );
    expect(withReturn('/en/register?invited_by=sam', '/en/friends')).toBe(
      '/en/register?invited_by=sam&next=%2Fen%2Ffriends',
    );
    expect(withReturn('/en/login', null)).toBe('/en/login');
    expect(withReturn('/en/login', undefined)).toBe('/en/login');
  });

  it('round-trips through a query string', () => {
    const next = '/en/match/00000000-0000-4000-8000-000000000901?pick=away#pick';
    const href = loginHref('en', next);
    const read = new URL(href, 'https://stadiomind.example').searchParams.get(RETURN_PARAM);
    expect(safeReturnPath('en', read)).toBe(next);
  });

  it('drops an address it would not follow', () => {
    expect(loginHref('en', 'https://evil.example')).toBe('/en/login');
    expect(loginHref('en', '/fa/following')).toBe('/en/login');
    expect(loginHref('en')).toBe('/en/login');
    expect(registerHref('fa', '/fa/groups')).toBe('/fa/register?next=%2Ffa%2Fgroups');
    expect(registerHref('fa', '/fa/login')).toBe('/fa/register');
  });
});
