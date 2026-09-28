import { SEARCH_TYPES, type SearchEntityType, type SearchResult } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  SECTION_EMPTY_KEY,
  SECTION_TITLE_KEY,
  apiQuery,
  communityQuery,
  entityQuery,
  entitySections,
  groupHref,
  keywordsAsAsked,
  matchNote,
  memberHref,
  ofType,
  readSearchTerm,
  resultHref,
} from './search';

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

  it('asks the API for stories, groups and members once the term is long enough', () => {
    expect(communityQuery('r')).toBeNull();
    expect(communityQuery('Real Madrid')).toBe('q=Real%20Madrid&types=story,group,member&limit=10');
    expect(communityQuery('derby', 3)).toBe('q=derby&types=story,group,member&limit=3');
  });

  it('shows the catalog sections the question asked for, or all three', () => {
    expect(entitySections(null)).toEqual(['team', 'competition', 'person']);
    expect(entitySections([])).toEqual(['team', 'competition', 'person']);
    expect(entitySections(['person', 'team'])).toEqual(['team', 'person']);
  });

  it('splits the ranked catalog rows by kind without reordering them', () => {
    const row = (type: SearchEntityType, id: string): SearchResult => ({
      type,
      id,
      name: id,
      secondary: null,
      matched_on: 'name',
      alias: null,
      score: 1,
    });
    const results = [row('person', 'p1'), row('team', 't1'), row('person', 'p2')];
    expect(ofType(results, 'person').map((r) => r.id)).toEqual(['p1', 'p2']);
    expect(ofType(results, 'competition')).toEqual([]);
  });

  it('gives every kind a heading and its own empty sentence', () => {
    for (const type of SEARCH_TYPES) {
      expect(SECTION_TITLE_KEY[type]).toBe(`search.section.${type}`);
      expect(SECTION_EMPTY_KEY[type]).toBe(`search.empty.${type}`);
    }
    expect(new Set(Object.values(SECTION_EMPTY_KEY)).size).toBe(SEARCH_TYPES.length);
  });

  it('sends a group to its page by slug and a member to their profile', () => {
    expect(groupHref('en', 'kop-end')).toBe('/en/groups/kop-end');
    expect(memberHref('fa', 'ali_7')).toBe('/fa/u/ali_7');
  });

  it('notes the alias that matched', () => {
    expect(matchNote({ matched_on: 'alias', alias: 'Man Utd' })).toBe('also known as Man Utd');
    expect(matchNote({ matched_on: 'name', alias: null })).toBeNull();
  });
});

describe('keywords instead of a refused question (T-838)', () => {
  it('asks the keyword search for the catalog kinds only, and nothing for a short term', () => {
    expect(entityQuery('Inter')).toBe('q=Inter&types=team,competition,person&limit=20');
    expect(entityQuery('x')).toBeNull();
  });

  it('gives the rows in the shape /ask answers with, read by no model and with no reason', () => {
    const hit: SearchResult = {
      type: 'team',
      id: 'a',
      name: 'Inter',
      secondary: 'Italy',
      matched_on: 'name',
      alias: null,
      score: 1,
    };
    expect(keywordsAsAsked('Inter', { results: [hit] })).toEqual({
      question: 'Inter',
      interpretation: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: null,
      results: [hit],
    });
  });
});
