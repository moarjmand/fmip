import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale, localeFromPathname } from './locales';

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
});

describe('localeFromPathname', () => {
  it('reads the locale segment', () => {
    expect(localeFromPathname('/en')).toBe('en');
    expect(localeFromPathname('/en/match/123')).toBe('en');
  });

  it('returns undefined when the path carries no shipped locale', () => {
    expect(localeFromPathname('/')).toBeUndefined();
    expect(localeFromPathname('/match/123')).toBeUndefined();
    expect(localeFromPathname('/fr/match')).toBeUndefined();
  });
});
