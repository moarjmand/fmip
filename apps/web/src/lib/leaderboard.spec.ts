import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAGE_SIZE,
  apiQuery,
  boardExplainer,
  emptyBoardSentence,
  languageLabel,
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
  competition: null,
  language: null,
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

describe('a competition board (T-843)', () => {
  const CUP = '00000000-0000-4000-8000-0000000002AB';
  const cup = CUP.toLowerCase();

  it('reads a competition id, and drops anything else', () => {
    expect(readLeaderboardQuery({ competition: CUP })).toEqual(at({ competition: cup }));
    expect(readLeaderboardQuery({ competition: 'premier-league' })).toEqual(DEFAULT);
  });

  it('asks the API for it and keeps it in every link until changed', () => {
    expect(apiQuery(at({ competition: cup }))).toBe(
      `limit=${PAGE_SIZE}&offset=0&competition=${cup}`,
    );
    const q = at({ competition: cup, period: 'month', month: '2026-09' });
    expect(pageHref('en', q, { page: 2 })).toBe(
      `/en/leaderboard?period=month&month=2026-09&competition=${cup}&page=2`,
    );
    expect(pageHref('en', q, { competition: null })).toBe(
      '/en/leaderboard?period=month&month=2026-09',
    );
  });

  it('says only that competition is rated, per member, behind the same privacy as a period', () => {
    expect(periodSentence({ kind: 'all' }, 'en', 'Cup')).toBe(
      'Ranked by the Performance Rating computed over predictions on Cup fixtures only',
    );
    expect(periodSentence({ kind: 'season', label: '2025/26' }, 'en', 'Cup')).toContain(
      'on Cup fixtures in its 2025/26 season only',
    );
    const text = boardExplainer({
      scope: 'everyone',
      period: { kind: 'all' },
      min_settled: 30,
      floor: 30,
      competition: { id: cup, name: 'Cup' },
    });
    expect(text).toContain('at least 30 settled predictions in that competition');
    expect(text).toContain('prediction history is visible to you');
    expect(emptyBoardSentence('everyone', { kind: 'all' }, 30, false, 'en', 'Cup')).toBe(
      'No member has 30 settled predictions in Cup yet.',
    );
  });

  it('offers the competitions with settled predictions as links on the page', () => {
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'leaderboard', 'page.tsx'),
      'utf8',
    );
    expect(page).toContain('data-testid="competition-picker"');
    expect(page).toContain('result.data.available_competitions');
    expect(page).toContain('pageHref(locale, q, { competition: competition.id, page: 1 })');
    expect(page).toContain('result.data.competition?.name ?? null');
  });
});

describe('a language board (T-844)', () => {
  it('reads a language code, and drops a tag it cannot use', () => {
    expect(readLeaderboardQuery({ language: 'AR' })).toEqual(at({ language: 'ar' }));
    expect(readLeaderboardQuery({ language: 'pt-BR' })).toEqual(DEFAULT);
  });

  it('asks the API for it and keeps it in every link until changed', () => {
    expect(apiQuery(at({ language: 'ar' }))).toBe(`limit=${PAGE_SIZE}&offset=0&language=ar`);
    expect(pageHref('en', at({ language: 'ar', scope: 'friends' }), { page: 2 })).toBe(
      '/en/leaderboard?scope=friends&language=ar&page=2',
    );
  });

  it('names the language in the reader language, and the privacy rule', () => {
    expect(languageLabel('ar')).toBe('Arabic');
    expect(languageLabel('ar', 'fr')).toBe('arabe');
    const text = boardExplainer({
      scope: 'everyone',
      period: { kind: 'all' },
      min_settled: 30,
      floor: 30,
      competition: null,
      language: 'ar',
    });
    expect(text).toContain('among members who use FMIP in Arabic');
    expect(text).toContain('prediction history is visible to you');
  });

  it('says so when no member of that language reaches the floor', () => {
    expect(emptyBoardSentence('everyone', { kind: 'all' }, 30, false, 'en', null, 'tr')).toBe(
      'No member who uses FMIP in Turkish has 30 settled predictions yet.',
    );
  });

  it('offers the site languages as links on the page', () => {
    const page = readFileSync(
      join(__dirname, '..', 'app', '[locale]', 'leaderboard', 'page.tsx'),
      'utf8',
    );
    expect(page).toContain('data-testid="language-picker"');
    expect(page).toContain("['en', ...UNFINISHED_LOCALES]");
    expect(page).toContain('"leaderboard.language.note"');
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
