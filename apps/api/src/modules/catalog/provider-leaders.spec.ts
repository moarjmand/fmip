import { describe, expect, it } from 'vitest';
import { providerBoards, seasonYearOf, type ProviderLeaderLine } from './internal/provider-leaders';

// T-1441 (D-232): the provider's season totals as the competition page's boards.
const line = (over: Partial<ProviderLeaderLine>): ProviderLeaderLine => ({
  personId: 'p',
  personName: 'P',
  teamId: 't',
  teamName: 'T',
  appearances: 10,
  minutes: 900,
  goals: null,
  assists: null,
  yellowCards: null,
  redCards: null,
  fetchedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

describe('seasonYearOf', () => {
  it('reads the year a season label starts in', () => {
    expect(seasonYearOf('2025/26')).toBe(2025);
    expect(seasonYearOf('2020')).toBe(2020);
    expect(seasonYearOf('Apertura')).toBeNull();
  });
});

describe('providerBoards', () => {
  it('lists a player in a board only with a figure above nought; a missing figure is not a zero', () => {
    const boards = providerBoards([
      line({ personId: 'a', goals: 5, assists: null, yellowCards: 0, redCards: null }),
      line({ personId: 'b', goals: 0, assists: 3, yellowCards: 2, redCards: 1 }),
    ]);
    expect(boards.scorers.data!.map((r) => r.person.id)).toEqual(['a']);
    expect(boards.assists.data!.map((r) => r.person.id)).toEqual(['b']);
    expect(boards.cards.data!.map((r) => r.person.id)).toEqual(['b']);
  });

  it('is limited, never available: only the players the provider was asked about appear', () => {
    const boards = providerBoards([line({ goals: 1, assists: 1, yellowCards: 1 })]);
    expect(boards.scorers.coverage).toBe('limited');
    expect(boards.assists.coverage).toBe('limited');
    expect(boards.cards.coverage).toBe('limited');
  });

  it('says not_supplied for a board nothing fills, with the time of the lines when it has them', () => {
    const boards = providerBoards([line({ goals: 2 })]);
    expect(boards.assists).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(boards.scorers.last_updated_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('stamps a board with the newest line it was counted from', () => {
    const boards = providerBoards([
      line({ personId: 'a', goals: 2, fetchedAt: '2026-10-01T00:00:00.000Z' }),
      line({ personId: 'b', goals: 1, fetchedAt: '2026-10-05T00:00:00.000Z' }),
      line({ personId: 'c', assists: 4, fetchedAt: '2026-10-09T00:00:00.000Z' }),
    ]);
    expect(boards.scorers.last_updated_at).toBe('2026-10-05T00:00:00.000Z');
  });

  it("sums a player's lines for two teams into one appearances figure, with minutes only if all supplied", () => {
    const boards = providerBoards([
      line({ personId: 'a', teamId: 't1', appearances: 5, minutes: 400, goals: 1 }),
      line({ personId: 'a', teamId: 't2', appearances: 6, minutes: null, goals: 2 }),
    ]);
    expect(boards.minutes.get('a')).toMatchObject({
      coverage: 'limited',
      matches: 11,
      matches_with_minutes: 5,
      supplied_minutes: 400,
      total: null,
    });
    expect(boards.scorers.data!.map((r) => [r.team!.id, r.goals])).toEqual([
      ['t1', 1],
      ['t2', 2],
    ]);
  });
});
