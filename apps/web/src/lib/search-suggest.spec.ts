import { NO_MEDIA, type SearchResponse, type SearchResult } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  SUGGEST_FETCH,
  SUGGEST_LIMIT,
  buildSuggestions,
  startsAWord,
  suggestApiQuery,
  suggestTerm,
  suggestWords,
} from './search-suggest';

/** The suggestions under a search field (T-1844, D-435): what is asked, kept, grouped and said. */

const hit = (
  type: SearchResult['type'],
  id: string,
  name: string,
  over: Partial<SearchResult> = {},
): SearchResult => ({
  type,
  id,
  name,
  secondary: null,
  matched_on: 'name',
  alias: null,
  score: 1,
  image: NO_MEDIA,
  ...over,
});

const answer = (results: SearchResult[]): SearchResponse => ({
  query: 'x',
  types: ['team', 'competition', 'person'],
  results,
  stories: null,
  groups: null,
  members: null,
});

describe('the term', () => {
  it('is asked from two characters to 64, whitespace collapsed', () => {
    expect(suggestTerm(null)).toBeNull();
    expect(suggestTerm(' m ')).toBeNull();
    expect(suggestTerm('  man   utd ')).toBe('man utd');
    expect(suggestTerm('x'.repeat(64))).toHaveLength(64);
    expect(suggestTerm('x'.repeat(65))).toBeNull();
  });

  it('asks the three kinds, more rows than shown, names in the reader language', () => {
    expect(suggestApiQuery('man utd', 'fa')).toBe(
      `q=man%20utd&types=team,competition,person&limit=${SUGGEST_FETCH}&locale=fa`,
    );
    // The right-to-left test locale reads English names.
    expect(suggestApiQuery('ab', 'x-rtl')).toContain('&locale=en');
    expect(SUGGEST_FETCH).toBeGreaterThan(SUGGEST_LIMIT);
  });
});

describe('a word start', () => {
  it('matches a word of the name, accents folded, every word of the term in order', () => {
    expect(startsAWord('Lionel Messi', 'messi')).toBe(true);
    expect(startsAWord('Kylian Mbappé', 'mbappe')).toBe(true);
    expect(startsAWord('Manchester United', 'manchester un')).toBe(true);
    expect(startsAWord('Manchester United', 'united man')).toBe(false);
    expect(startsAWord('Pedro Preijs', 'premier')).toBe(false);
    expect(startsAWord('Ivo Prekazi', 'pre')).toBe(true);
  });

  it('folds Arabic letter forms as Persian writes them', () => {
    expect(startsAWord('علی كريمی', 'کریمی')).toBe(true);
  });

  it('cannot judge a name shown in another script than the term', () => {
    // "messi" on the Persian site finds the player by his canonical name.
    expect(startsAWord('لیونل مسی', 'messi')).toBe(true);
  });
});

describe('the answer', () => {
  it('keeps the API order within each kind, groups team, competition, player, at most six', () => {
    const results = [
      hit('person', 'p1', 'Marcus Rashford', { secondary: 'Barcelona' }),
      hit('team', 't1', 'Manchester United', {
        secondary: 'England',
        team_context: { league: { id: 'l1', name: 'Premier League' }, ground: null },
      }),
      hit('competition', 'c1', 'Major League Soccer', { secondary: 'USA' }),
      hit('team', 't2', 'Manchester City'),
      hit('person', 'p2', 'Mason Mount'),
      hit('team', 't3', 'Mansfield Town'),
      hit('person', 'p3', 'Mario Balotelli'),
      hit('team', 't4', 'Manly'),
    ];
    const found = buildSuggestions('en', 'ma', answer(results));
    expect(found.term).toBe('ma');
    expect(found.groups.map((g) => [g.type, g.heading, g.rows.map((r) => r.id)])).toEqual([
      ['team', 'Teams', ['t1', 't2', 't3']],
      ['competition', 'Competitions', ['c1']],
      ['person', 'Players', ['p1', 'p2']],
    ]);
    const united = found.groups[0]!.rows[0]!;
    expect(united).toMatchObject({
      name: 'Manchester United',
      line: 'England · Premier League',
      href: '/en/team/t1',
      imageKind: 'crest',
    });
    expect(found.groups[2]!.rows[0]).toMatchObject({ line: 'Barcelona', href: '/en/player/p1' });
  });

  it('leaves out a player no word of whose name or alias starts with the term', () => {
    const results = [
      hit('person', 'fuzzy', 'Pedro Preijs', { score: 0.6 }),
      hit('person', 'alias', 'Edson Arantes', { matched_on: 'alias', alias: 'Pelé' }),
      hit('team', 'near', 'Prem Tigers', { score: 0.5 }),
    ];
    const found = buildSuggestions('en', 'pele', answer(results));
    expect(found.groups.flatMap((g) => g.rows.map((r) => r.id))).toEqual(['near', 'alias']);
  });

  it('draws no group for a kind with nothing, and nothing at all when nothing matched', () => {
    expect(buildSuggestions('en', 'zz', answer([])).groups).toEqual([]);
    const teamsOnly = buildSuggestions('en', 'ars', answer([hit('team', 't', 'Arsenal')]));
    expect(teamsOnly.groups.map((g) => g.type)).toEqual(['team']);
    expect(teamsOnly.groups[0]!.rows[0]!.line).toBeNull();
  });

  it('heads the groups in the reader language, and links in it', () => {
    const fa = buildSuggestions('fa', 'استقلال', answer([hit('team', 't', 'استقلال')]));
    expect(fa.groups[0]).toMatchObject({ headingLang: null });
    expect(fa.groups[0]!.heading).not.toBe('Teams');
    expect(fa.groups[0]!.rows[0]!.href).toBe('/fa/team/t');
  });
});

describe('the words', () => {
  it('are the reader language, the English marked where it stands in', () => {
    const fa = suggestWords('fa');
    expect(fa.seeAll.text).toBe('همه‌ی نتایج برای «{term}»');
    expect(fa.seeAll.lang).toBeUndefined();
    const de = suggestWords('de');
    expect(de.seeAll).toEqual({ text: 'See all results for “{term}”', lang: 'en' });
    expect(suggestWords('en').none.lang).toBeUndefined();
  });
});
