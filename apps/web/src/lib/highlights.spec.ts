import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHTS_MAX_PAGE,
  highlightsApiQuery,
  highlightsHref,
  pageCount,
  readHighlightsQuery,
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
