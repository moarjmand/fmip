import type { HighlightCompetition, HighlightListItem } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  FILTER_LEAD,
  HIGHLIGHTS_MAX_PAGE,
  featuredOf,
  groupByDay,
  highlightsApiQuery,
  highlightsHref,
  pageCount,
  readHighlightsQuery,
  relativeDay,
  splitFilter,
} from './highlights';

/**
 * The Highlights page's address (T-1434): what it reads from the query, what
 * it asks the API, and the links that keep the filter, the page and a guest's
 * territory.
 */

const PL = '00000000-0000-4000-8000-000000000201';

describe('reading the query', () => {
  it('keeps a competition id, a page and a territory', () => {
    expect(
      readHighlightsQuery({ competition: PL.toUpperCase(), page: '3', territory: 'gb' }),
    ).toEqual({ competition: PL, page: 3, territory: 'GB' });
  });

  it('drops what cannot be one rather than sending it on', () => {
    expect(
      readHighlightsQuery({ competition: 'premier', page: '0', territory: 'Britain' }),
    ).toEqual({ competition: undefined, page: 1, territory: undefined });
    expect(readHighlightsQuery({ page: String(HIGHLIGHTS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readHighlightsQuery({ page: ['2', '5'] }).page).toBe(2);
    expect(readHighlightsQuery({}).page).toBe(1);
  });
});

describe('the links', () => {
  const q = { competition: PL, page: 2, territory: 'GB' };

  it('asks the API for exactly what the page shows', () => {
    expect(highlightsApiQuery(q)).toBe(`?competition=${PL}&page=2&territory=GB`);
    expect(highlightsApiQuery({ competition: undefined, page: 1, territory: undefined })).toBe('');
  });

  it('goes back to page 1 when the competition changes, and keeps the territory', () => {
    expect(highlightsHref('fa', q, { competition: null })).toBe('/fa/highlights?territory=GB');
    expect(highlightsHref('fa', q, { competition: 'x' })).toBe(
      '/fa/highlights?competition=x&territory=GB',
    );
    expect(highlightsHref('en', q, { page: 3 })).toBe(
      `/en/highlights?competition=${PL}&page=3&territory=GB`,
    );
    expect(highlightsHref('en', q)).toBe(`/en/highlights?competition=${PL}&page=2&territory=GB`);
  });

  it('counts at least one page', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });
});

/** The page's layout (T-1614, D-285): the filter's first chips, the featured clip, the days. */

const competition = (id: string, count: number): HighlightCompetition => ({
  id,
  name: `League ${id}`,
  short_name: null,
  count,
});

const clip = (id: string, kickoff: string): HighlightListItem => ({
  id,
  url: `https://www.youtube.com/watch?v=${id}`,
  publisher: null,
  source: { id: 'src', name: 'Highlightly', rights: 'link' },
  fixture: {
    id: `fx-${id}`,
    kickoff_at: kickoff,
    status: 'finished',
    competition: { id: 'c', name: 'League', short_name: null },
    home: { id: 'h', name: 'Home', short_name: null },
    away: { id: 'a', name: 'Away', short_name: null },
    score: { home: 1, away: 0 },
    penalties: null,
  },
  restricted: false,
  last_updated_at: kickoff,
});

describe('the filter', () => {
  const many = Array.from({ length: 15 }, (_, i) => competition(`c${i}`, 30 - i));

  it('shows the competitions with the most clips first, the rest behind "more"', () => {
    const { shown, more } = splitFilter(many, null);
    expect(shown.map((c) => c.id)).toEqual(many.slice(0, FILTER_LEAD).map((c) => c.id));
    expect(more.map((c) => c.id)).toEqual(['c11', 'c12', 'c13', 'c14']);
  });

  it('never hides the picked competition', () => {
    const { shown, more } = splitFilter(many, 'c13');
    expect(shown.at(-1)?.id).toBe('c13');
    expect(shown).toHaveLength(FILTER_LEAD + 1);
    expect(more.map((c) => c.id)).toEqual(['c11', 'c12', 'c14']);
    // Already shown: nothing moves.
    expect(splitFilter(many, 'c2').shown).toHaveLength(FILTER_LEAD);
  });

  it('has nothing behind "more" when every competition fits', () => {
    expect(splitFilter(many.slice(0, 3), 'c1')).toEqual({ shown: many.slice(0, 3), more: [] });
  });
});

describe('the featured clip', () => {
  const items = [clip('a', '2026-10-25T19:00:00Z'), clip('b', '2026-10-25T15:00:00Z')];

  it('is the newest on the first page, and is not repeated in the grid', () => {
    const { featured, rest } = featuredOf(items, 1);
    expect(featured?.id).toBe('a');
    expect(rest.map((c) => c.id)).toEqual(['b']);
  });

  it('is none on a later page or for an empty list', () => {
    expect(featuredOf(items, 2)).toEqual({ featured: null, rest: items });
    expect(featuredOf([], 1)).toEqual({ featured: null, rest: [] });
  });
});

describe('the days', () => {
  it("groups by the reader's day, not UTC's, in the API's order", () => {
    const items = [
      clip('late', '2026-10-25T22:30:00Z'), // 26 Oct in Tehran (+03:30)
      clip('eve', '2026-10-25T18:00:00Z'),
      clip('noon', '2026-10-24T12:00:00Z'),
    ];
    expect(groupByDay(items, 'Asia/Tehran').map((d) => [d.day, d.items.map((c) => c.id)])).toEqual([
      ['2026-10-26', ['late']],
      ['2026-10-25', ['eve']],
      ['2026-10-24', ['noon']],
    ]);
    expect(groupByDay(items, 'UTC').map((d) => d.items.length)).toEqual([2, 1]);
    expect(groupByDay([], 'UTC')).toEqual([]);
  });

  it('names today and yesterday, across a month and a year', () => {
    expect(relativeDay('2026-10-26', '2026-10-26')).toBe('today');
    expect(relativeDay('2026-10-25', '2026-10-26')).toBe('yesterday');
    expect(relativeDay('2026-10-24', '2026-10-26')).toBeNull();
    expect(relativeDay('2026-09-30', '2026-10-01')).toBe('yesterday');
    expect(relativeDay('2025-12-31', '2026-01-01')).toBe('yesterday');
    expect(relativeDay('2026-10-27', '2026-10-26')).toBeNull();
  });
});
