import { describe, expect, it } from 'vitest';
import { entryOfPath, entryParam, signupSourceOf } from './signup-source';

const SITE = ['traveltohormuz.ir', 'traveltohormuz.ir'];

describe('entryOfPath (T-1821, D-415)', () => {
  it('names the kind of page, with or without its locale', () => {
    expect(entryOfPath('/en')).toBe('home');
    expect(entryOfPath('/fa/')).toBe('home');
    expect(entryOfPath('/en/match/0f0e?x=1')).toBe('match');
    expect(entryOfPath('/fa/team/abc')).toBe('team');
    expect(entryOfPath('/en/competition/abc')).toBe('competition');
    expect(entryOfPath('/en/competitions')).toBe('competition');
    expect(entryOfPath('/en/news/story/1')).toBe('news');
    expect(entryOfPath('/en/player/1')).toBe('other');
    expect(entryOfPath('/en/login')).toBe('other');
    expect(entryOfPath('/fa/register')).toBeNull();
    expect(entryOfPath(null)).toBeNull();
    expect(entryOfPath('https://t.me/x')).toBeNull();
  });

  it('takes only a known kind from the link', () => {
    expect(entryParam('team')).toBe('team');
    expect(entryParam(['news', 'home'])).toBe('news');
    expect(entryParam('campaign')).toBeNull();
    expect(entryParam(undefined)).toBeNull();
  });
});

describe('signupSourceOf (T-1821, D-415)', () => {
  it('prefers the link’s from, then the return path, then this site’s referring page', () => {
    const base = { referer: 'https://traveltohormuz.ir/en/team/1', siteHosts: SITE };
    expect(signupSourceOf({ ...base, from: 'home', next: '/en/match/1' })).toEqual({
      entry: 'home',
      referrer_host: null,
    });
    expect(signupSourceOf({ ...base, from: undefined, next: '/en/match/1' })).toEqual({
      entry: 'match',
      referrer_host: null,
    });
    // The header's button: the page it was clicked on, from the request alone.
    expect(signupSourceOf({ ...base, from: undefined, next: null })).toEqual({
      entry: 'team',
      referrer_host: null,
    });
  });

  it('names another site by its host only, when it linked straight to the register page', () => {
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'https://www.Google.com/search?q=stadiomind',
        siteHosts: SITE,
      }),
    ).toEqual({ entry: 'none', referrer_host: 'google.com' });
    // Its main domain only: a personal subdomain never names a person.
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'https://john-smith.github.io/cv',
        siteHosts: SITE,
      }),
    ).toEqual({ entry: 'none', referrer_host: 'github.io' });
    // An address or a one-label name is no site.
    for (const referer of ['http://192.168.1.10/x', 'https://localhost/', 'https://intranet/']) {
      expect(
        signupSourceOf({ from: undefined, next: null, referer, siteHosts: SITE }).referrer_host,
      ).toBeNull();
    }
  });

  it('names Telegram’s Android app, and no other app', () => {
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'android-app://org.telegram.messenger/',
        siteHosts: SITE,
      }),
    ).toEqual({ entry: 'none', referrer_host: 'telegram' });
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'android-app://com.whatsapp/',
        siteHosts: SITE,
      }).referrer_host,
    ).toBeNull();
  });

  it('keeps the kind a register page’s own link carried across a language switch', () => {
    const switched = (referer: string) =>
      signupSourceOf({ from: undefined, next: null, referer, siteHosts: SITE });
    expect(switched('https://traveltohormuz.ir/en/register?from=team')).toEqual({
      entry: 'team',
      referrer_host: null,
    });
    expect(switched('https://traveltohormuz.ir/en/register')).toEqual({
      entry: 'none',
      referrer_host: null,
    });
  });

  it('says no host for this site or its subdomains, nor for a missing or malformed referrer', () => {
    const none = { entry: 'none', referrer_host: null };
    for (const referer of [null, '', 'not a url', 'ftp://example.com/']) {
      expect(signupSourceOf({ from: undefined, next: null, referer, siteHosts: SITE })).toEqual(
        none,
      );
    }
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'https://agents.traveltohormuz.ir/agents',
        siteHosts: SITE,
      }),
    ).toEqual({ entry: 'other', referrer_host: null });
  });

  it('compares hosts without a port or www.', () => {
    expect(
      signupSourceOf({
        from: undefined,
        next: null,
        referer: 'http://localhost:3000/en/news',
        siteHosts: ['localhost:3000', 'www.example.com'],
      }),
    ).toEqual({ entry: 'news', referrer_host: null });
  });
});
