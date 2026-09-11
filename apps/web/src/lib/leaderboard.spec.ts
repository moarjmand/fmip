import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE,
  apiQuery,
  pageCount,
  pageHref,
  ratingLabel,
  readLeaderboardQuery,
  statusLabel,
  tierLabel,
} from './leaderboard';

describe('readLeaderboardQuery', () => {
  it('defaults to the floor and page one', () => {
    expect(readLeaderboardQuery({})).toEqual({ min: null, page: 1 });
  });

  it('reads a filter and a page, first value of a repeat', () => {
    expect(readLeaderboardQuery({ min: '50', page: ['3', '9'] })).toEqual({ min: 50, page: 3 });
  });

  it('treats a bad value as absent rather than failing the page', () => {
    expect(readLeaderboardQuery({ min: 'lots', page: '0' })).toEqual({ min: null, page: 1 });
    expect(readLeaderboardQuery({ min: '-5', page: '1.5' })).toEqual({ min: null, page: 1 });
  });
});

describe('apiQuery', () => {
  it('leaves the filter to the API floor when none is chosen', () => {
    expect(apiQuery({ min: null, page: 1 })).toBe(`limit=${PAGE_SIZE}&offset=0`);
  });

  it('passes the filter and turns the page into an offset', () => {
    expect(apiQuery({ min: 100, page: 3 })).toBe(`min_settled=100&limit=${PAGE_SIZE}&offset=100`);
  });
});

describe('pageHref', () => {
  it('drops defaults from the URL', () => {
    expect(pageHref('en', { min: 50, page: 2 }, { min: null, page: 1 })).toBe('/en/leaderboard');
  });

  it('keeps the filter while changing the page, and the page while changing the filter', () => {
    expect(pageHref('fa', { min: 50, page: 1 }, { page: 2 })).toBe('/fa/leaderboard?min=50&page=2');
    expect(pageHref('fa', { min: 50, page: 2 }, { min: 100 })).toBe(
      '/fa/leaderboard?min=100&page=2',
    );
  });
});

describe('labels', () => {
  it('counts pages, at least one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
  });

  it('shows one decimal and the tier and status in words', () => {
    expect(ratingLabel({ rating: 72 })).toBe('72.0');
    expect(ratingLabel({ rating: 72.45 })).toBe('72.5');
    expect(tierLabel('platinum')).toBe('Platinum');
    expect(statusLabel({ provisional: false, established: true })).toBe('Established');
    expect(statusLabel({ provisional: false, established: false })).toBe('Building');
    expect(statusLabel({ provisional: true, established: false })).toBe('Provisional');
  });
});
