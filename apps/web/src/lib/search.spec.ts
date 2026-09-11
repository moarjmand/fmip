import { describe, expect, it } from 'vitest';
import { apiQuery, matchNote, readSearchTerm, resultHref } from './search';

describe('search helpers', () => {
  it('reads the term from the URL, collapsing whitespace', () => {
    expect(readSearchTerm({})).toBe('');
    expect(readSearchTerm({ q: '  Man   Utd ' })).toBe('Man Utd');
    expect(readSearchTerm({ q: ['real', 'x'] })).toBe('real');
  });

  it('asks the API only once the term is long enough', () => {
    expect(apiQuery('r')).toBeNull();
    expect(apiQuery('Real Madrid')).toBe('q=Real%20Madrid&limit=20');
    expect(apiQuery('پرسپولیس', 5)).toBe(`q=${encodeURIComponent('پرسپولیس')}&limit=5`);
  });

  it('sends each kind of result to its page', () => {
    expect(resultHref('en', { type: 'team', id: 't1' })).toBe('/en/team/t1');
    expect(resultHref('fa', { type: 'competition', id: 'c1' })).toBe('/fa/competition/c1');
    expect(resultHref('en', { type: 'person', id: 'p1' })).toBe('/en/player/p1');
  });

  it('notes the alias that matched', () => {
    expect(matchNote({ matched_on: 'alias', alias: 'Man Utd' })).toBe('also known as Man Utd');
    expect(matchNote({ matched_on: 'name', alias: null })).toBeNull();
  });
});
