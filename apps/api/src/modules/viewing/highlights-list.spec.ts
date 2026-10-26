import type { HighlightListItem, ViewingTerritory } from '@fmip/contracts';
import { NO_MEDIA } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { EMPTY_MEDIA_INDEX, type MediaIndex } from '../media/media.service';
import { offeredEverywhere, offeredIn } from './internal/highlight-feed';
import type { FeedIndexRow } from './internal/viewing-read-store';
import { pageOf } from './viewing.controller';
import { highlightsPage, withHighlightMedia } from './viewing.service';

/**
 * The Highlights list's choices (T-1434, D-226): which clips a reader is
 * offered (the match page's territory rule, or every territory when none is
 * chosen), the competitions the filter offers, the total and the page.
 */

const row = (
  id: string,
  competition: string,
  allowed: string[] = [],
  blocked: string[] = [],
): FeedIndexRow => ({
  id,
  competition_id: competition,
  competition_name: competition === 'pl' ? 'Premier League' : 'La Liga',
  competition_short_name: null,
  allowed_territories: allowed,
  blocked_territories: blocked,
  kickoff_at: new Date('2026-10-18T15:00:00Z'),
});

// Newest first, as the store answers.
const INDEX: FeedIndexRow[] = [
  row('a', 'pl'),
  row('b', 'liga', ['DE', 'FR']),
  row('c', 'pl', [], ['IR']),
  row('d', 'liga'),
  row('e', 'pl'),
];

const GB: ViewingTerritory = { state: 'chosen', territory: { code: 'GB', name: 'United Kingdom' } };
const IR: ViewingTerritory = { state: 'chosen', territory: { code: 'IR', name: 'Iran' } };
const DE: ViewingTerritory = { state: 'chosen', territory: { code: 'DE', name: 'Germany' } };
const NONE: ViewingTerritory = { state: 'not_chosen' };

describe('offered everywhere', () => {
  it('is no allow list and nothing blocked, and then offered in any territory', () => {
    expect(offeredEverywhere({ allowed: [], blocked: [] })).toBe(true);
    expect(offeredEverywhere({ allowed: ['DE'], blocked: [] })).toBe(false);
    expect(offeredEverywhere({ allowed: [], blocked: ['IR'] })).toBe(false);
    for (const code of ['GB', 'IR', 'DE', 'US']) {
      expect(offeredIn({ allowed: [], blocked: [] }, code)).toBe(true);
    }
  });
});

describe('a page of the Highlights list', () => {
  it("offers a chosen territory exactly what the match page's rule offers there", () => {
    expect(highlightsPage(INDEX, GB, null, 1).ids).toEqual(['a', 'c', 'd', 'e']);
    expect(highlightsPage(INDEX, IR, null, 1).ids).toEqual(['a', 'd', 'e']);
    expect(highlightsPage(INDEX, DE, null, 1).ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('lists a reader with no territory every clip, and says which are restricted', () => {
    const page = highlightsPage(INDEX, NONE, null, 1);
    expect(page.ids).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(page.total).toBe(5);
    expect(page.restricted).toEqual(['b', 'c']);
  });

  it('restricts nothing with a territory chosen, and only the page shown', () => {
    expect(highlightsPage(INDEX, DE, null, 1).restricted).toEqual([]);
    expect(highlightsPage(INDEX, NONE, null, 2, 2).restricted).toEqual(['c']);
  });

  it('filters by competition, and offers every competition with a clip, most first', () => {
    const page = highlightsPage(INDEX, GB, 'liga', 1);
    expect(page.ids).toEqual(['d']);
    expect(page.total).toBe(1);
    expect(page.competitions).toEqual([
      { id: 'pl', name: 'Premier League', short_name: null, count: 3 },
      { id: 'liga', name: 'La Liga', short_name: null, count: 1 },
    ]);
    // A competition with no clip offered here is not offered as a filter.
    expect(highlightsPage(INDEX, IR, null, 1).competitions).toEqual([
      { id: 'pl', name: 'Premier League', short_name: null, count: 2 },
      { id: 'liga', name: 'La Liga', short_name: null, count: 1 },
    ]);
  });

  it('pages newest first, and a page past the end is empty with the total kept', () => {
    expect(highlightsPage(INDEX, DE, null, 1, 2).ids).toEqual(['a', 'b']);
    expect(highlightsPage(INDEX, DE, null, 3, 2).ids).toEqual(['e']);
    const past = highlightsPage(INDEX, DE, null, 4, 2);
    expect(past.ids).toEqual([]);
    expect(past.total).toBe(5);
  });

  it('is empty for an empty feed (rule 3: the page says so)', () => {
    expect(highlightsPage([], GB, null, 1)).toEqual({
      ids: [],
      restricted: [],
      total: 0,
      competitions: [],
    });
  });
});

describe('?page=', () => {
  it('is a whole number from 1, absent is 1, anything else refused', () => {
    expect(pageOf(undefined)).toBe(1);
    expect(pageOf('')).toBe(1);
    expect(pageOf('3')).toBe(3);
    expect(pageOf(['2', '9'])).toBe(2);
    expect(pageOf('0')).toBeNull();
    expect(pageOf('-1')).toBeNull();
    expect(pageOf('1.5')).toBeNull();
    expect(pageOf('501')).toBeNull();
    expect(pageOf('abc')).toBeNull();
  });
});

describe("the Highlights page's images (T-1614, D-285)", () => {
  const crest = (id: string) => ({
    coverage: 'available' as const,
    url: `/api/media/crest/${id}/abc.png`,
  });
  const logo = (id: string) => ({
    coverage: 'available' as const,
    url: `/api/media/logo/${id}/def.svg`,
  });
  // Only the home side and the Premier League have an image stored.
  const media: MediaIndex = {
    ...EMPTY_MEDIA_INDEX,
    crest: (id) => (id === 'home' ? crest(id) : NO_MEDIA),
    logo: (id) => (id === 'pl' ? logo(id) : NO_MEDIA),
  };
  const item: HighlightListItem = {
    id: 'clip',
    url: 'https://www.youtube.com/watch?v=x',
    publisher: 'Premier League',
    source: { id: 'src', name: 'Highlightly', rights: 'link' },
    fixture: {
      id: 'fx',
      kickoff_at: '2026-10-25T15:00:00.000Z',
      status: 'finished',
      competition: { id: 'pl', name: 'Premier League', short_name: null },
      home: { id: 'home', name: 'Home FC', short_name: null },
      away: { id: 'away', name: 'Away FC', short_name: null },
      score: { home: 2, away: 1 },
      penalties: null,
    },
    restricted: false,
    last_updated_at: '2026-10-25T18:00:00.000Z',
  };

  it("gives each clip its crests and its competition's logo, and each filter entry its logo", () => {
    const dressed = withHighlightMedia(
      [item],
      [
        { id: 'pl', name: 'Premier League', short_name: null, count: 1 },
        { id: 'liga', name: 'La Liga', short_name: null, count: 1 },
      ],
      media,
    );
    expect(dressed.items[0]!.fixture.home.crest).toEqual(crest('home'));
    expect(dressed.items[0]!.fixture.competition.logo).toEqual(logo('pl'));
    expect(dressed.competitions.map((c) => c.logo)).toEqual([logo('pl'), NO_MEDIA]);
  });

  it('says not_supplied for an image not stored, never an empty address (rule 3)', () => {
    const dressed = withHighlightMedia([item], [], EMPTY_MEDIA_INDEX);
    expect(dressed.items[0]!.fixture.away.crest).toEqual(NO_MEDIA);
    expect(dressed.items[0]!.fixture.home.crest).toEqual(NO_MEDIA);
    expect(dressed.items[0]!.fixture.competition.logo).toEqual(NO_MEDIA);
  });

  it('leaves the clip itself as it was', () => {
    const [dressed] = withHighlightMedia([item], [], media).items;
    const { crest: _home, ...home } = dressed!.fixture.home;
    expect(home).toEqual(item.fixture.home);
    expect(dressed!.url).toBe(item.url);
    expect(dressed!.restricted).toBe(false);
    expect(item.fixture.home).not.toHaveProperty('crest');
  });
});
