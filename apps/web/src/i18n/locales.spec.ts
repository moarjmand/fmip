import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  PSEUDO_LOCALES,
  directionOf,
  isLocale,
  isPseudoLocale,
  localeFromPathname,
} from './locales';

describe('locales', () => {
  it('ships English and treats it as the default', () => {
    expect(LOCALES).toContain('en');
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
  });

  it('rejects anything that is not a shipped locale', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });

  it('routes the RTL pseudo-locale but marks it as one', () => {
    expect(isLocale('x-rtl')).toBe(true);
    expect(isPseudoLocale('x-rtl')).toBe(true);
    expect(isPseudoLocale('en')).toBe(false);
    expect(PSEUDO_LOCALES).toContain('x-rtl');
  });

  it('never makes a pseudo-locale the default', () => {
    expect(isPseudoLocale(DEFAULT_LOCALE)).toBe(false);
  });
});

describe('directionOf', () => {
  it('returns ltr for left-to-right languages', () => {
    expect(directionOf('en')).toBe('ltr');
    expect(directionOf('de')).toBe('ltr');
  });

  it('returns rtl for right-to-left languages', () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('fa')).toBe('rtl');
    expect(directionOf('he')).toBe('rtl');
  });

  it('resolves regional variants by their language subtag', () => {
    expect(directionOf('ar-EG')).toBe('rtl');
    expect(directionOf('en-GB')).toBe('ltr');
  });

  it('is case insensitive', () => {
    expect(directionOf('AR')).toBe('rtl');
  });

  it('treats the pseudo-locale as right-to-left', () => {
    // `x-rtl`.split('-')[0] is `x`, which is not a language, so this only works
    // because the tag is matched before the language-subtag lookup.
    expect(directionOf('x-rtl')).toBe('rtl');
  });
});

describe('localeFromPathname', () => {
  it('reads the locale segment', () => {
    expect(localeFromPathname('/en')).toBe('en');
    expect(localeFromPathname('/en/match/123')).toBe('en');
  });

  it('reads the pseudo-locale segment', () => {
    expect(localeFromPathname('/x-rtl')).toBe('x-rtl');
    expect(localeFromPathname('/x-rtl/match/123')).toBe('x-rtl');
  });

  it('returns undefined when the path carries no shipped locale', () => {
    expect(localeFromPathname('/')).toBeUndefined();
    expect(localeFromPathname('/match/123')).toBeUndefined();
    expect(localeFromPathname('/fr/match')).toBeUndefined();
  });
});
