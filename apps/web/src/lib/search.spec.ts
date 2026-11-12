import {
  type CompetitionDirectoryEntry,
  NO_MEDIA,
  SEARCH_TYPES,
  type ScoresResponse,
  type SearchEntityType,
  type SearchResult,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { imageClasses } from '@/components/entity-image';
import {
  RESULT_IMAGE_KIND,
  SECTION_NONE_KEY,
  SECTION_TITLE_KEY,
  TODAY_CHIPS,
  apiQuery,
  communityQuery,
  entityQuery,
  entitySections,
  groupHref,
  keywordsAsAsked,
  matchNote,
  memberHref,
  noneLine,
  ofType,
  readSearchTerm,
  resultHref,
  resultLine,
  searchChips,
  splitSections,
} from './search';

describe("a result's image (T-1617)", () => {
  it('draws a team as a crest, a competition as a logo on its tile and a person as a round photo', () => {
    expect(RESULT_IMAGE_KIND).toEqual({ team: 'crest', competition: 'logo', person: 'photo' });
    expect(imageClasses(RESULT_IMAGE_KIND.competition, 22)).toContain('bg-logo-tile');
    expect(imageClasses(RESULT_IMAGE_KIND.team, 22)).toContain('crest-halo');
    expect(imageClasses(RESULT_IMAGE_KIND.person, 22)).toContain('rounded-full');
  });
});

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

  it('gives every kind a heading and its own word for the line of kinds with none', () => {
    for (const type of SEARCH_TYPES) {
      expect(SECTION_TITLE_KEY[type]).toBe(`search.section.${type}`);
      expect(SECTION_NONE_KEY[type]).toBe(`search.none.${type}`);
    }
    expect(new Set(Object.values(SECTION_NONE_KEY)).size).toBe(SEARCH_TYPES.length);
  });

  it('sends a group to its page by slug and a member to their profile', () => {
    expect(groupHref('en', 'kop-end')).toBe('/en/groups/kop-end');
    expect(memberHref('fa', 'ali_7')).toBe('/fa/u/ali_7');
  });

  it('notes the alias that matched', () => {
    expect(matchNote('en', { matched_on: 'alias', alias: 'Man Utd' })).toBe(
      'also known as Man Utd',
    );
    expect(matchNote('en', { matched_on: 'name', alias: null })).toBeNull();
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

describe('telling results apart and saying less when nothing matches (T-1803, D-401)', () => {
  const team = (over: Partial<SearchResult> = {}): SearchResult => ({
    type: 'team',
    id: 't',
    name: 'Arsenal',
    secondary: null,
    matched_on: 'name',
    alias: null,
    score: 1,
    ...over,
  });
  const ground = { id: 'g', name: 'Emirates Stadium', city: 'London' };
  const league = { id: 'l', name: 'Premier League' };

  it("names a team's league, else its ground's town, else says it holds neither", () => {
    expect(resultLine('en', team({ team_context: { league, ground } }))).toEqual([
      'Premier League',
    ]);
    expect(
      resultLine('en', team({ team_context: { league: null, ground: { ...ground, city: null } } })),
    ).toEqual(['Emirates Stadium']);
    expect(resultLine('en', team({ team_context: { league: null, ground } }))).toEqual(['London']);
    expect(resultLine('en', team({ team_context: { league: null, ground: null } }))).toEqual([
      'No league or ground on record',
    ]);
    expect(resultLine('fa', team({ team_context: { league: null, ground: null } }))).toEqual([
      'لیگ یا ورزشگاهی ثبت نشده',
    ]);
  });

  it('keeps the country first, and says nothing it was not told by an older answer', () => {
    expect(
      resultLine('en', team({ secondary: 'England', team_context: { league, ground: null } })),
    ).toEqual(['England', 'Premier League']);
    // No `team_context` at all: an API older than T-1803, so no claim either way.
    expect(resultLine('en', team())).toEqual([]);
    expect(resultLine('en', team({ secondary: 'England' }))).toEqual(['England']);
    expect(
      resultLine('en', team({ type: 'person', secondary: 'Arsenal', name: 'Bukayo Saka' })),
    ).toEqual(['Arsenal']);
  });

  it('keeps a section only for a kind that found something', () => {
    expect(
      splitSections([
        { type: 'team', count: 4 },
        { type: 'competition', count: 0 },
        { type: 'person', count: 0 },
        { type: 'story', count: 10 },
        { type: 'group', count: 0 },
        { type: 'member', count: 0 },
      ]),
    ).toEqual({ shown: ['team', 'story'], none: ['competition', 'person', 'group', 'member'] });
  });

  it('names every kind with no hit in one line, in the reader’s language', () => {
    expect(noneLine('en', [])).toBeNull();
    expect(noneLine('en', ['competition', 'person', 'group', 'member'])).toBe(
      'No competitions, players, groups, or members match.',
    );
    expect(noneLine('en', ['member'])).toBe('No members match.');
    const fa = noneLine('fa', ['competition', 'person']);
    expect(fa).toContain('رقابتی');
    expect(fa).toContain('بازیکنی');
    expect(fa).toMatch(/پیدا نشد\.$/);
  });

  it('offers the big five and the competitions playing today, from our own lists only', () => {
    const entry = (
      id: string,
      code: string | null,
      kind: CompetitionDirectoryEntry['kind'] = 'league',
      order: number | null = null,
    ): CompetitionDirectoryEntry => ({
      id,
      name: id,
      short_name: null,
      scope: 'domestic',
      kind,
      country: code === null ? null : { id: code, name: code, code },
      order,
      logo: NO_MEDIA,
      season: null,
      next_kickoff_at: null,
    });
    const directory = [
      entry('Premier League', 'ENG', 'league', 1),
      entry('Championship', 'ENG', 'league', 2),
      entry('La Liga', 'ESP', 'league', 3),
      entry('Copa del Rey', 'ESP', 'cup'),
    ];
    const scores = {
      groups: [
        { competition: { id: 'Copa del Rey' }, fixtures: [{}] },
        { competition: { id: 'Championship' }, fixtures: [] },
      ],
    } as unknown as ScoresResponse;
    const chips = searchChips(directory, scores, 'en');
    expect(chips.bigFive.map((c) => c.id)).toEqual(['Premier League', 'La Liga']);
    expect(chips.today?.map((c) => c.id)).toEqual(['Copa del Rey']);
    expect(chips.more).toBe(false);
    // No scores: no "Playing today" at all rather than an empty one (rule 3).
    expect(searchChips(directory, null, 'en').today).toBeNull();
    expect(searchChips(null, scores, 'en')).toEqual({ bigFive: [], today: null, more: false });
    // A long day is cut short, and says so.
    const many = Array.from({ length: TODAY_CHIPS + 3 }, (_, i) => entry(`Cup ${i}`, 'BRA', 'cup'));
    const busy = {
      groups: many.map((c) => ({ competition: { id: c.id }, fixtures: [{}] })),
    } as unknown as ScoresResponse;
    const cut = searchChips(many, busy, 'en');
    expect(cut.today).toHaveLength(TODAY_CHIPS);
    expect(cut.more).toBe(true);
  });
});
