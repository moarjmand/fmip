import type {
  AccuracyPoint,
  CompetitionPage,
  PublicModelAccuracyResponse,
  SeasonFixture,
  TableRow,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MATCHWEEK_LIMIT,
  availableTabs,
  currentMatchweek,
  hasTable,
  lastResultDay,
  leagueModel,
  leagueNumbers,
  mainResults,
  nextMatchDay,
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

describe('the tabs (T-1385, T-1498)', () => {
  it('opens on the Overview for nothing or anything it does not know', () => {
    expect(readTabParam({})).toBe('overview');
    expect(readTabParam({ tab: 'table' })).toBe('table');
    expect(readTabParam({ tab: ['players', 'table'] })).toBe('players');
    expect(readTabParam({ tab: 'standings' })).toBe('overview');
  });

  it('opens a retired Hybrid tab’s address on the tab that holds it now (T-1498)', () => {
    expect(readTabParam({ tab: 'fixtures' })).toBe('matches');
    expect(readTabParam({ tab: 'results' })).toBe('matches');
    expect(readTabParam({ tab: 'stats' })).toBe('overview');
    expect(readTabParam({ tab: 'model' })).toBe('model');
  });

  it('keeps the season and the floor in a tab’s address; the Overview needs no tab', () => {
    const current = { id: SEASON, is_current: true };
    const old = { id: SEASON, is_current: false };
    expect(tabHref('en', 'c1', current, 'overview')).toBe('/en/competition/c1');
    expect(tabHref('fa', 'c1', current, 'matches')).toBe('/fa/competition/c1?tab=matches');
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
      'matches',
      'players',
      'model',
      'news',
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
      qualifying: 0,
      goals: 8,
      homeWins: 1,
      draws: 2,
      goalless: 1,
    });
    expect(perMatch('en', numbers.goals, numbers.counted)).toBe('2.00');
    expect(sharePercent('en', numbers.draws, numbers.counted)).toBe('50%');
  });

  it("counts a cup's main competition only, and names the qualifying matches left out (T-1394)", () => {
    // The Champions League on 11 October 2026: 90 qualifying matches stored
    // with the 18 of the league phase's first matchday. "108 results" was the
    // two read as one season.
    const qualifying = Array.from({ length: 90 }, () =>
      fx({ status: 'finished', score: { home: 4, away: 0 }, qualifying: true }),
    );
    const leaguePhase = [
      ...Array.from({ length: 9 }, () =>
        fx({ status: 'finished', score: { home: 2, away: 1 }, qualifying: false }),
      ),
      ...Array.from({ length: 5 }, () =>
        fx({ status: 'finished', score: { home: 1, away: 1 }, qualifying: false }),
      ),
      ...Array.from({ length: 4 }, () =>
        fx({ status: 'finished', score: { home: 0, away: 2 }, qualifying: false }),
      ),
    ];
    const numbers = leagueNumbers([...qualifying, ...leaguePhase]);
    expect(numbers).toMatchObject({
      coverage: 'available',
      counted: 18,
      qualifying: 90,
      homeWins: 9,
      draws: 5,
      goalless: 0,
      goals: 45,
    });
    expect(perMatch('en', numbers.goals, numbers.counted)).toBe('2.50');
    expect(mainResults([...qualifying, ...leaguePhase])).toHaveLength(18);
    // A league season has no qualifying match: every result is counted.
    expect(mainResults(leaguePhase)).toHaveLength(18);
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

describe('the day of matches (T-1498)', () => {
  const now = Date.parse('2026-10-25T09:00:00.000Z');
  const season = (fixtures: SeasonFixture[], results: SeasonFixture[] = []) => ({
    fixtures,
    results,
  });

  it('takes the day of the next match in the reader’s zone, finished matches that day included', () => {
    const early = fx({ id: 'e', kickoff_at: '2026-10-25T13:00:00.000Z' });
    const late = fx({ id: 'l', kickoff_at: '2026-10-25T16:30:00.000Z' });
    const done = fx({
      id: 'd',
      kickoff_at: '2026-10-25T08:00:00.000Z',
      status: 'finished',
      score: { home: 1, away: 0 },
    });
    const tomorrow = fx({ id: 't', kickoff_at: '2026-10-26T19:00:00.000Z' });
    const day = nextMatchDay(season([late, early, tomorrow], [done]), 'Europe/London', now);
    expect(day?.day).toBe('2026-10-25');
    expect(day?.fixtures.map((f) => f.id)).toEqual(['d', 'e', 'l']);
  });

  it('reads the day in the reader’s zone: 23:30 in London is the next day in Tehran', () => {
    const f = fx({ kickoff_at: '2026-10-25T22:30:00.000Z' });
    expect(nextMatchDay(season([f]), 'Europe/London', now)?.day).toBe('2026-10-25');
    expect(nextMatchDay(season([f]), 'Asia/Tehran', now)?.day).toBe('2026-10-26');
  });

  it('lets a live match set the day, and never an old match the feed left scheduled', () => {
    const stale = fx({ id: 's', kickoff_at: '2026-10-20T13:00:00.000Z' });
    const next = fx({ id: 'n', kickoff_at: '2026-10-28T13:00:00.000Z' });
    expect(nextMatchDay(season([stale, next]), 'UTC', now)?.day).toBe('2026-10-28');
    const live = fx({ id: 'v', kickoff_at: '2026-10-25T08:30:00.000Z', status: 'live' });
    expect(nextMatchDay(season([live, next]), 'UTC', now)?.day).toBe('2026-10-25');
  });

  it('has no day when nothing is left to play', () => {
    const done = fx({ status: 'finished', score: { home: 0, away: 0 } });
    expect(nextMatchDay(season([], [done]), 'UTC', now)).toBeNull();
    expect(nextMatchDay(season([fx({ status: 'postponed' })]), 'UTC', now)).toBeNull();
  });

  it('gives the latest day of results before the match day, finished matches only', () => {
    const sat = (id: string, h: number) =>
      fx({
        id,
        kickoff_at: `2026-10-24T1${h}:00:00.000Z`,
        status: 'finished',
        score: { home: h, away: 0 },
      });
    const sun = fx({
      id: 'sun',
      kickoff_at: '2026-10-25T08:00:00.000Z',
      status: 'finished',
      score: { home: 2, away: 2 },
    });
    const off = fx({ id: 'off', kickoff_at: '2026-10-24T18:00:00.000Z', status: 'postponed' });
    const page = season([off], [sun, sat('b', 6), sat('a', 4)]);
    expect(lastResultDay(page, 'UTC', '2026-10-25')?.fixtures.map((f) => f.id)).toEqual(['a', 'b']);
    expect(lastResultDay(page, 'UTC', null)?.day).toBe('2026-10-25');
    expect(lastResultDay(season([]), 'UTC', null)).toBeNull();
  });
});

describe('the model in this league (T-1498)', () => {
  const metrics = (matches: number, over: Partial<AccuracyPoint> = {}): AccuracyPoint => ({
    period: '2026-10',
    period_start: '2026-10-01',
    forecasts: matches * 2,
    matches,
    coverage: matches === 0 ? 'not_supplied' : matches < 30 ? 'limited' : 'available',
    log_loss: matches === 0 ? null : 1,
    brier: matches === 0 ? null : 0.6,
    rps: matches === 0 ? null : 0.225,
    accuracy: matches === 0 ? null : 0.52,
    uniform_rps: matches === 0 ? null : 0.244,
    ...over,
  });
  const answer = (
    competitions: PublicModelAccuracyResponse['competitions'],
  ): PublicModelAccuracyResponse => ({
    period: 'month',
    minimum_matches: 30,
    reference: { uniform_log_loss: 1.0986, uniform_brier: 0.6667, uniform_accuracy: 1 / 3 },
    overall: { competition: null, model_versions: ['m@1'], total: metrics(40), points: [] },
    competitions,
    last_updated_at: '2026-10-25T06:00:00.000Z',
  });

  it('is unreachable when the answer did not come', () => {
    expect(leagueModel(null, 'c1')).toEqual({ state: 'unreachable' });
  });

  it('is not supplied for a league the model has not forecast, or has scored nothing in', () => {
    expect(leagueModel(answer([]), 'c1').state).toBe('not_supplied');
    const empty = answer([
      {
        competition: { id: 'c1', name: 'Premier League' },
        model_versions: [],
        total: metrics(0),
        points: [],
      },
    ]);
    expect(leagueModel(empty, 'c1').state).toBe('not_supplied');
  });

  it('takes the newest scored month, keeps every month newest first, and the league’s total', () => {
    const series = {
      competition: { id: 'c1', name: 'Premier League' },
      model_versions: ['dixon-coles-elo@0.6.0'],
      total: metrics(55),
      points: [
        metrics(30, { period: '2026-09', period_start: '2026-09-01' }),
        metrics(25, { period: '2026-10', period_start: '2026-10-01' }),
      ],
    };
    const model = leagueModel(answer([series]), 'c1');
    expect(model.state).toBe('scored');
    if (model.state !== 'scored') return;
    expect(model.latest.period).toBe('2026-10');
    expect(model.latest.coverage).toBe('limited');
    expect(model.months.map((m) => m.period)).toEqual(['2026-10', '2026-09']);
    expect(model.total.matches).toBe(55);
    expect(model.modelVersions).toEqual(['dixon-coles-elo@0.6.0']);
    // The answer is never mutated: its points stay oldest first.
    expect(series.points[0]!.period).toBe('2026-09');
  });
});
