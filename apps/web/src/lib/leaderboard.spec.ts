import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE,
  apiQuery,
  boardExplainer,
  emptyBoardSentence,
  monthLabel,
  pageCount,
  pageHref,
  periodSentence,
  ratingLabel,
  readLeaderboardQuery,
  statusLabel,
  tierLabel,
  type LeaderboardPageQuery,
} from './leaderboard';

/** The default board: everyone, all time, the floor, page one. */
const DEFAULT: LeaderboardPageQuery = {
  min: null,
  page: 1,
  scope: 'everyone',
  period: 'all',
  month: null,
  season: null,
};
const at = (change: Partial<LeaderboardPageQuery>): LeaderboardPageQuery => ({
  ...DEFAULT,
  ...change,
});

describe('readLeaderboardQuery', () => {
  it('defaults to the floor, page one, everyone and all time', () => {
    expect(readLeaderboardQuery({})).toEqual(DEFAULT);
  });

  it('reads a filter and a page, first value of a repeat', () => {
    expect(readLeaderboardQuery({ min: '50', page: ['3', '9'] })).toEqual(at({ min: 50, page: 3 }));
  });

  it('treats a bad value as absent rather than failing the page', () => {
    expect(readLeaderboardQuery({ min: 'lots', page: '0' })).toEqual(DEFAULT);
    expect(readLeaderboardQuery({ min: '-5', page: '1.5' })).toEqual(DEFAULT);
    expect(readLeaderboardQuery({ scope: 'world', period: 'week' })).toEqual(DEFAULT);
  });

  it('reads the friends scope and a month or season (T-641)', () => {
    expect(readLeaderboardQuery({ scope: 'friends' })).toEqual(at({ scope: 'friends' }));
    expect(readLeaderboardQuery({ period: 'month', month: '2026-09' })).toEqual(
      at({ period: 'month', month: '2026-09' }),
    );
    expect(readLeaderboardQuery({ period: 'season', season: '2025/26' })).toEqual(
      at({ period: 'season', season: '2025/26' }),
    );
  });

  it('drops a month or season that does not belong to the period, or is malformed', () => {
    expect(readLeaderboardQuery({ month: '2026-09', season: '2025/26' })).toEqual(DEFAULT);
    expect(readLeaderboardQuery({ period: 'month', month: '2026-13' })).toEqual(
      at({ period: 'month' }),
    );
    expect(readLeaderboardQuery({ period: 'season', month: '2026-09' })).toEqual(
      at({ period: 'season' }),
    );
  });
});

describe('apiQuery', () => {
  it('leaves the filter to the API floor when none is chosen', () => {
    expect(apiQuery(DEFAULT)).toBe(`limit=${PAGE_SIZE}&offset=0`);
  });

  it('passes the filter and turns the page into an offset', () => {
    expect(apiQuery(at({ min: 100, page: 3 }))).toBe(
      `min_settled=100&limit=${PAGE_SIZE}&offset=100`,
    );
  });

  it('passes the scope and the period with its picker (T-641)', () => {
    expect(apiQuery(at({ scope: 'friends', period: 'month', month: '2026-09' }))).toBe(
      `limit=${PAGE_SIZE}&offset=0&scope=friends&period=month&month=2026-09`,
    );
    expect(apiQuery(at({ period: 'season', season: '2025/26' }))).toBe(
      `limit=${PAGE_SIZE}&offset=0&period=season&season=2025%2F26`,
    );
    // No month chosen: the API's default (this month), not one invented here.
    expect(apiQuery(at({ period: 'month' }))).toBe(`limit=${PAGE_SIZE}&offset=0&period=month`);
  });
});

describe('pageHref', () => {
  it('drops defaults from the URL', () => {
    expect(pageHref('en', at({ min: 50, page: 2 }), { min: null, page: 1 })).toBe(
      '/en/leaderboard',
    );
  });

  it('keeps the filter while changing the page, and the page while changing the filter', () => {
    expect(pageHref('fa', at({ min: 50 }), { page: 2 })).toBe('/fa/leaderboard?min=50&page=2');
    expect(pageHref('fa', at({ min: 50, page: 2 }), { min: 100 })).toBe(
      '/fa/leaderboard?min=100&page=2',
    );
  });

  it('switches scope and period with plain links, keeping the rest (T-641)', () => {
    const month = at({ period: 'month', month: '2026-08', min: 50 });
    expect(pageHref('en', month, { scope: 'friends', page: 1 })).toBe(
      '/en/leaderboard?scope=friends&period=month&month=2026-08&min=50',
    );
    // Changing the period drops the old period's picker.
    expect(pageHref('en', month, { period: 'season', month: null, season: null })).toBe(
      '/en/leaderboard?period=season&min=50',
    );
    expect(pageHref('ar', at({ scope: 'friends' }), { scope: 'everyone' })).toBe('/ar/leaderboard');
    expect(pageHref('en', at({ period: 'season' }), { season: '2025/26' })).toBe(
      '/en/leaderboard?period=season&season=2025%2F26',
    );
  });
});

describe('period sentences (T-641)', () => {
  const month = {
    kind: 'month',
    month: '2026-09',
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
  } as const;

  it('names the month in UTC, whatever the server zone', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
  });

  it('says what each board ranks', () => {
    expect(periodSentence({ kind: 'all' })).toBe('Ranked by current Performance Rating');
    expect(periodSentence(month)).toContain('settled in September 2026 (UTC) only');
    expect(periodSentence({ kind: 'season', label: '2025/26' })).toContain(
      '2025/26 season fixtures, in every competition',
    );
  });

  it('explains the filter and, on a period board, the privacy rule', () => {
    const all = boardExplainer({
      scope: 'everyone',
      period: { kind: 'all' },
      min_settled: 30,
      floor: 30,
    });
    expect(all).toContain('at least 30 settled predictions.');
    expect(all).not.toContain('visible to you');
    const friends = boardExplainer({ scope: 'friends', period: month, min_settled: 50, floor: 30 });
    expect(friends).toContain('among you and your friends');
    expect(friends).toContain('at least 50 settled predictions in that period');
    expect(friends).toContain('prediction history is visible to you');
  });

  it('states why a board is empty rather than drawing a table of nobody', () => {
    expect(emptyBoardSentence('everyone', { kind: 'all' }, 30, false)).toBe(
      'No member has 30 settled predictions yet.',
    );
    expect(emptyBoardSentence('friends', month, 30, false)).toBe(
      'Neither you nor any of your friends has 30 settled predictions in September 2026 yet.',
    );
    expect(emptyBoardSentence('everyone', { kind: 'season', label: '2025/26' }, 50, false)).toBe(
      'No member has 50 settled predictions on 2025/26 season fixtures yet.',
    );
    expect(emptyBoardSentence('everyone', { kind: 'season', label: null }, 30, false)).toBe(
      'No season has a settled prediction yet, so there is no season board.',
    );
    expect(emptyBoardSentence('everyone', { kind: 'all' }, 30, true)).toBe(
      'There is nobody on this page of the board.',
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
