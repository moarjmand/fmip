import { describe, expect, it } from 'vitest';
import { signupHost, signupReferrerHost, signupSource } from './identity';

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

describe('signupReferrerHost (T-1821, D-415)', () => {
  it('cuts a host to its main domain, keeping a two-part suffix', () => {
    expect(signupReferrerHost('t.me')).toBe('t.me');
    expect(signupReferrerHost('john-smith.github.io')).toBe('github.io');
    expect(signupReferrerHost('mail.google.com')).toBe('google.com');
    expect(signupReferrerHost('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(signupReferrerHost('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(signupReferrerHost('a.b.example.com.au')).toBe('example.com.au');
    expect(signupReferrerHost('varzesh3.com')).toBe('varzesh3.com');
    expect(signupReferrerHost('ut.ac.ir')).toBe('ut.ac.ir');
  });

  it('counts no address, localhost or one-label name', () => {
    for (const value of ['192.168.1.10', '3232235777', 'localhost', 'intranet', '10.0.0.1:8080']) {
      expect(signupReferrerHost(value)).toBeNull();
    }
  });

  it('passes an app referrer by its plain name only', () => {
    expect(signupReferrerHost('telegram')).toBe('telegram');
    expect(signupReferrerHost('whatsapp')).toBeNull();
  });
});

describe('signupSource (T-1821, D-415)', () => {
  it('passes a known entry and a host', () => {
    expect(signupSource({ entry: 'match', referrer_host: 't.me' })).toEqual({
      entry: 'match',
      referrer_host: 't.me',
    });
    expect(signupSource({ entry: 'news', referrer_host: 'name.github.io' })).toEqual({
      entry: 'news',
      referrer_host: 'github.io',
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
