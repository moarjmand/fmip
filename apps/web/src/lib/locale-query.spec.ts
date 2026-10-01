import { describe, expect, it } from 'vitest';
import { withLocale, withReaderLocale } from './locale-query';

describe('withLocale', () => {
  it('starts a query string when there is none', () => {
    expect(withLocale('/teams/abc', 'es')).toBe('/teams/abc?locale=es');
  });

  it('joins an existing query string rather than starting a second one', () => {
    expect(withLocale('/competitions/abc?season=s1', 'ar')).toBe(
      '/competitions/abc?season=s1&locale=ar',
    );
  });

  it('leaves the path alone when there is no locale to ask for', () => {
    expect(withLocale('/teams/abc', undefined)).toBe('/teams/abc');
    expect(withLocale('/teams/abc', '')).toBe('/teams/abc');
  });

  it('never lets the tag break the query', () => {
    expect(withLocale('/teams/abc', 'x rtl&y=1')).toBe('/teams/abc?locale=x%20rtl%26y%3D1');
  });
});

describe('withReaderLocale (T-1312)', () => {
  it("adds the reader's locale to a read", () => {
    expect(withReaderLocale('/scores?from=2026-10-01', 'GET', 'fa')).toBe(
      '/scores?from=2026-10-01&locale=fa',
    );
  });

  it('sends English too, and English for a pseudo-locale (D-178)', () => {
    expect(withReaderLocale('/teams/x', 'GET', 'en')).toBe('/teams/x?locale=en');
    expect(withReaderLocale('/me/feed', 'GET', 'x-rtl')).toBe('/me/feed?locale=en');
  });

  it('leaves writes, the console, a chosen locale and an unknown one alone', () => {
    expect(withReaderLocale('/fixtures/x/predictions', 'POST', 'fa')).toBe(
      '/fixtures/x/predictions',
    );
    expect(withReaderLocale('/admin/overview', 'GET', 'fa')).toBe('/admin/overview');
    expect(withReaderLocale('/teams/x?locale=ar', 'GET', 'fa')).toBe('/teams/x?locale=ar');
    expect(withReaderLocale('/teams/x', 'GET', 'zz')).toBe('/teams/x');
    expect(withReaderLocale('/teams/x', 'GET', null)).toBe('/teams/x');
  });
});
