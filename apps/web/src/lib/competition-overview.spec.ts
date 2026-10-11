import type { CompetitionPage, SeasonFixture, TableRow } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MATCHWEEK_LIMIT,
  availableTabs,
  currentMatchweek,
  hasTable,
  leagueNumbers,
  perMatch,
  readTabParam,
  roundGroups,
  seasonDigits,
  sharePercent,
  tabHref,
} from './competition-overview';

/**
 * The Hybrid competition page's helpers (T-1385, D-203): the tab the URL
 * opens, which round the Overview shows, fixtures by round with no provider
 * label printed, and the season's figures counted from stored results only.
 */

const SEASON = '00000000-0000-4000-8000-0000000000aa';
let n = 0;
function fx(over: Partial<SeasonFixture> = {}): SeasonFixture {
  n += 1;
  return {
    id: `f${String(n).padStart(3, '0')}`,
    kickoff_at: '2026-10-01T16:00:00.000Z',
    status: 'scheduled',
    round: 'Regular Season - 8',
    stage: { id: 'st', name: 'Regular Season' },
    home: { id: `h${n}`, name: `Home ${n}`, short_name: null },
    away: { id: `a${n}`, name: `Away ${n}`, short_name: null },
    score: null,
    ...over,
  };
}

const row = (id: string): TableRow => ({
  position: 1,
  team: { id, name: id, short_name: null },
  played: 1,
  won: 1,
  drawn: 0,
  lost: 0,
  goals_for: 1,
  goals_against: 0,
  goal_difference: 1,
  points: 3,
  form: ['W'],
});

const covered = <T>(data: T | null) => ({
  coverage: data === null ? ('not_supplied' as const) : ('available' as const),
  last_updated_at: null,
  data,
});

type Shape = Pick<CompetitionPage, 'table' | 'group_tables' | 'bracket'> & {
  competition: { kind: CompetitionPage['competition']['kind'] };
};
const shape = (over: Partial<Shape>): Shape => ({
  table: covered<TableRow[]>(null),
  group_tables: null,
  bracket: null,
  competition: { kind: 'league' },
  ...over,
});

describe('the tabs (T-1385)', () => {
  it('opens on the Overview for nothing or anything it does not know', () => {
    expect(readTabParam({})).toBe('overview');
    expect(readTabParam({ tab: 'table' })).toBe('table');
    expect(readTabParam({ tab: ['players', 'table'] })).toBe('players');
    expect(readTabParam({ tab: 'standings' })).toBe('overview');
  });

  it('keeps the season and the floor in a tab’s address; the Overview needs no tab', () => {
    const current = { id: SEASON, is_current: true };
    const old = { id: SEASON, is_current: false };
    expect(tabHref('en', 'c1', current, 'overview')).toBe('/en/competition/c1');
    expect(tabHref('fa', 'c1', current, 'results')).toBe('/fa/competition/c1?tab=results');
    expect(tabHref('en', 'c1', old, 'players', 900)).toBe(
      `/en/competition/c1?season=${SEASON}&min_minutes=900&tab=players`,
    );
  });

  it('gives a league a table, rows or none, and a knockout cup none', () => {
    expect(hasTable(shape({}))).toBe(true);
    expect(hasTable(shape({ competition: { kind: 'cup' } }))).toBe(false);
    expect(hasTable(shape({ competition: { kind: 'cup' }, table: covered([row('a')]) }))).toBe(
      true,
    );
    expect(hasTable(shape({ competition: { kind: 'cup' }, group_tables: covered([]) }))).toBe(true);
    expect(availableTabs(shape({ competition: { kind: 'cup' } }))).toEqual([
      'overview',
      'fixtures',
      'results',
      'players',
      'stats',
    ]);
    // A continental cup's knockout rounds still have a tab of their own.
    expect(
      availableTabs(shape({ competition: { kind: 'cup' }, bracket: { rounds: [] } })),
    ).toContain('table');
  });
});

describe('the Overview’s round (T-1385)', () => {
  it('takes the next scheduled match’s round, played and unplayed alike, by kick-off', () => {
    const played = fx({
      status: 'finished',
      kickoff_at: '2026-09-30T16:00:00.000Z',
      score: { home: 1, away: 0 },
    });
    const old = fx({
      status: 'finished',
      round: 'Regular Season - 7',
      score: { home: 0, away: 0 },
    });
    const later = fx({ kickoff_at: '2026-10-02T16:00:00.000Z' });
    const next = fx({ kickoff_at: '2026-10-01T16:00:00.000Z' });
    const week = currentMatchweek('en', {
      results: [played, old],
      fixtures: [next, later],
    });
    expect(week?.state).toBe('next');
    expect(week?.label).toBe('Matchweek 8');
    expect(week?.fixtures.map((f) => f.id)).toEqual([played.id, next.id, later.id]);
  });

  it('lets a live match set the round, and a postponed old match never does', () => {
    const postponed = fx({
      status: 'postponed',
      round: 'Regular Season - 3',
      kickoff_at: '2026-08-01T16:00:00.000Z',
    });
    const live = fx({ status: 'live', round: 'Regular Season - 9' });
    expect(currentMatchweek('en', { results: [], fixtures: [postponed, live] })?.label).toBe(
      'Matchweek 9',
    );
    expect(currentMatchweek('en', { results: [], fixtures: [postponed, fx()] })?.label).toBe(
      'Matchweek 8',
    );
  });

  it('shows the last round played when nothing is left, and nothing for an empty season', () => {
    const last = fx({
      status: 'finished',
      round: 'Final',
      stage: null,
      score: { home: 2, away: 1 },
    });
    const week = currentMatchweek('en', { results: [last], fixtures: [] });
    expect(week?.state).toBe('latest');
    expect(week?.label).toBe('Final');
    expect(currentMatchweek('en', { results: [], fixtures: [] })).toBeNull();
  });

  it('never prints a round we cannot name, and gathers the week instead of a null round', () => {
    const unknown = fx({ round: 'Something New', stage: null });
    expect(currentMatchweek('en', { results: [], fixtures: [unknown] })?.label).toBeNull();
    const a = fx({ round: null, stage: null, kickoff_at: '2026-10-01T16:00:00.000Z' });
    const b = fx({ round: null, stage: null, kickoff_at: '2026-10-05T16:00:00.000Z' });
    const c = fx({ round: null, stage: null, kickoff_at: '2026-10-20T16:00:00.000Z' });
    const week = currentMatchweek('en', { results: [], fixtures: [a, b, c] });
    expect(week?.label).toBeNull();
    expect(week?.fixtures.map((f) => f.id)).toEqual([a.id, b.id]);
  });

  it('shows at most a dozen matches of a big round and counts the rest', () => {
    const many = Array.from({ length: MATCHWEEK_LIMIT + 4 }, () =>
      fx({ round: '3rd Round', stage: null }),
    );
    const week = currentMatchweek('en', { results: [], fixtures: many });
    expect(week?.fixtures).toHaveLength(MATCHWEEK_LIMIT);
    expect(week?.more).toBe(4);
  });

  it('names the round in Persian, with Persian digits', () => {
    expect(currentMatchweek('fa', { results: [], fixtures: [fx()] })?.label).toBe('هفته‌ی ۸');
  });
});

describe('fixtures by round (T-1385)', () => {
  // English says a round in its own words (T-1391, D-207); Persian is tested below.
  it('groups each round once, in the list’s order, headed in our words', () => {
    const a = fx({ round: 'Regular Season - 9' });
    const b = fx({ round: 'Regular Season - 8' });
    const c = fx({ round: 'Regular Season - 9' });
    const groups = roundGroups('en', [a, b, c]);
    expect(groups.map((g) => g.label)).toEqual(['Matchweek 9', 'Matchweek 8']);
    expect(groups[0]?.fixtures.map((f) => f.id)).toEqual([a.id, c.id]);
  });

  it('keeps a stage and its round apart in a cup, and never shows a provider label', () => {
    const groups = roundGroups('en', [
      fx({ round: 'League Stage - 2', stage: { id: 'ls', name: 'League Stage' } }),
      fx({ round: 'Round of 16', stage: { id: 'ko', name: 'Round of 16' } }),
      fx({ round: 'Something New', stage: { id: 'x', name: 'Something New' } }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['League phase, matchday 2', 'Round of 16', null]);
    expect(JSON.stringify(groups.map((g) => g.label))).not.toContain('Something New');
  });
});

describe('the season in figures (T-1385)', () => {
  it('counts from results with a score and says what it left out', () => {
    const numbers = leagueNumbers([
      fx({ status: 'finished', score: { home: 2, away: 1 } }),
      fx({ status: 'finished', score: { home: 0, away: 0 } }),
      fx({ status: 'finished', score: { home: 1, away: 1 } }),
      fx({ status: 'finished', score: { home: 0, away: 3 } }),
      fx({ status: 'finished', score: null }),
    ]);
    expect(numbers).toEqual({
      coverage: 'limited',
      counted: 4,
      unscored: 1,
      goals: 8,
      homeWins: 1,
      draws: 2,
      goalless: 1,
    });
    expect(perMatch('en', numbers.goals, numbers.counted)).toBe('2.00');
    expect(sharePercent('en', numbers.draws, numbers.counted)).toBe('50%');
  });

  it('is not supplied without a scored result, never a row of noughts', () => {
    expect(leagueNumbers([]).coverage).toBe('not_supplied');
    expect(leagueNumbers([fx({ status: 'finished', score: null })]).coverage).toBe('not_supplied');
  });

  it('writes figures and the season label in Persian digits', () => {
    expect(perMatch('fa', 7, 4)).toBe('۱٫۷۵');
    expect(sharePercent('fa', 1, 4)).toMatch(/۲۵/);
    expect(seasonDigits('fa', '2026/27')).toBe('۲۰۲۶/۲۷');
    expect(seasonDigits('en', '2026/27')).toBe('2026/27');
  });
});
