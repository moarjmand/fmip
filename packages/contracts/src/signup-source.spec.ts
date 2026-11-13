import { describe, expect, it } from 'vitest';
import { signupHost, signupSource } from './identity';

describe('signupHost (T-1821, D-415)', () => {
  it('keeps a bare host, lower-case, without a port or www.', () => {
    expect(signupHost('t.me')).toBe('t.me');
    expect(signupHost('WWW.Google.com')).toBe('google.com');
    expect(signupHost('news.example.org:8443')).toBe('news.example.org');
  });

  it('refuses anything that is not a bare host: a URL, a path, a query, a user part', () => {
    for (const value of [
      'https://t.me/stadiomind',
      't.me/stadiomind',
      'google.com?q=x',
      'me@example.com',
      '',
      ' ',
      '-bad.com',
      'a'.repeat(254),
      42,
      null,
    ]) {
      expect(signupHost(value)).toBeNull();
    }
  });
});

describe('signupSource (T-1821, D-415)', () => {
  it('passes a known entry and a host', () => {
    expect(signupSource({ entry: 'match', referrer_host: 't.me' })).toEqual({
      entry: 'match',
      referrer_host: 't.me',
    });
  });

  it('reads anything malformed as none, never as a guess', () => {
    expect(signupSource(undefined)).toEqual({ entry: 'none', referrer_host: null });
    expect(signupSource({ entry: 'campaign', referrer_host: 'https://x.com/a' })).toEqual({
      entry: 'none',
      referrer_host: null,
    });
  });
});
