import { describe, expect, it } from 'vitest';
import { withLocale } from './locale-query';

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
