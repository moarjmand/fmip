import { describe, expect, it } from 'vitest';
import type {
  CompetitionPage,
  ForecastVersion,
  MatchHeader,
  PredictionHistoryItem,
  Rating,
  TableRow,
} from '@fmip/contracts';
import {
  kickoffUtc,
  matchCardText,
  memberCardText,
  nameSize,
  tableCardText,
  TABLE_CARD_ROWS,
} from './share-card';

/**
 * T-520: a share card says what its page says and nothing more, the same way
 * for everybody who sees the chat it was pasted into.
 */

const header = (over: Partial<MatchHeader> = {}): MatchHeader => ({
  id: 'f1',
  kickoff_at: '2026-10-04T14:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c1', name: 'Premier League', short_name: 'PL', country_id: null },
  season: { id: 's1', label: '2026/27' },
  stage: null,
  round: 'Regular Season - 7',
  group_name: null,
  leg: null,
  home: {
    id: 'a',
    name: 'Arsenal',
    short_name: 'ARS',
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['home'],
  away: {
    id: 'b',
    name: 'Chelsea',
    short_name: 'CHE',
    code: null,
    red_cards: 0,
    formation: null,
    coach: null,
  } as MatchHeader['away'],
  scores: {
    current: null,
    half_time: null,
    full_time: null,
    extra_time: null,
    penalties: null,
    aggregate: null,
  },
  venue: null,
  is_neutral_venue: false,
  referee: null,
  attendance: null,
  periods: [],
  last_updated_at: '2026-10-04T14:00:00.000Z',
  freshness: null,
  ...over,
});

const forecast = (over: Partial<ForecastVersion> = {}): ForecastVersion =>
  ({
    id: 'v1',
    fixture_id: 'f1',
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles@1.0.0',
    computed_at: '2026-10-01T10:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.4547, draw: 0.2913, away: 0.254 },
    expected_goals: null,
    most_likely_scorelines: null,
    leading_factors: null,
    data_completeness: 'available',
    inputs: null,
    unavailable_reason: null,
    unavailable_detail: null,
    ...over,
  }) as ForecastVersion;

describe('the match card', () => {
  it('writes the kick-off in UTC and says so, since a preview is the same for everyone', () => {
    expect(kickoffUtc('2026-10-04T14:00:00.000Z')).toBe('Sun 4 Oct 2026 · 14:00 UTC');
    const text = matchCardText(header(), null);
    expect(text).toMatchObject({
      eyebrow: 'Premier League · 2026/27 · Regular Season - 7',
      home: 'Arsenal',
      away: 'Chelsea',
      centre: 'v',
      status: 'Sun 4 Oct 2026 · 14:00 UTC',
      forecast: null,
    });
  });

  it('shows the score and the minute live, and full time after', () => {
    const live = matchCardText(
      header({
        status: 'live',
        minute: 67,
        scores: { ...header().scores, current: { home: 2, away: 1 } },
      }),
      null,
    );
    expect([live.centre, live.status]).toEqual(['2 – 1', 'Live 67′']);
    const done = matchCardText(
      header({
        status: 'finished',
        scores: { ...header().scores, full_time: { home: 0, away: 0 } },
      }),
      null,
    );
    expect([done.centre, done.status]).toEqual(['0 – 0', 'Full time']);
    expect(matchCardText(header({ status: 'postponed' }), null)).toMatchObject({
      centre: 'v',
      status: 'Postponed',
    });
  });

  it('names the model beside its forecast, totalling 100, and shows none that is unavailable', () => {
    const text = matchCardText(header(), forecast());
    expect(text.forecast?.line).toBe('Arsenal 45.5% · Draw 29.1% · Chelsea 25.4%');
    expect(text.forecast?.source).toContain('statistical model');
    expect(text.forecast?.source).toContain('dixon-coles@1.0.0');
    expect(
      matchCardText(header(), forecast({ status: 'unavailable', probabilities: null })).forecast,
    ).toBeNull();
  });
});

describe('the table card', () => {
  const row = (position: number): TableRow => ({
    position,
    team: { id: `t${position}`, name: `Team ${position}`, short_name: null },
    played: 7,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 22 - position,
    form: [],
  });
  const page = (rows: TableRow[] | null): CompetitionPage =>
    ({
      competition: { name: 'Premier League' },
      season: { label: '2026/27' },
      table: { data: rows },
    }) as unknown as CompetitionPage;

  it('shows the top of the table, as many rows as fit', () => {
    const text = tableCardText(page(Array.from({ length: 20 }, (_, i) => row(i + 1))));
    expect(text.rows).toHaveLength(TABLE_CARD_ROWS);
    expect(text.rows[0]).toEqual({ position: 1, team: 'Team 1', played: 7, points: 21 });
    expect(text.absence).toBeNull();
  });

  it('says there is no table rather than drawing an empty one', () => {
    expect(tableCardText(page(null))).toMatchObject({ rows: [], absence: expect.any(String) });
    expect(tableCardText(page([])).absence).not.toBeNull();
  });
});

describe('team names on the match card', () => {
  it('gets smaller as a name gets longer, so two lines still sit beside the score', () => {
    expect(nameSize('Arsenal')).toBe(58);
    expect(nameSize('Omonia Nicosia')).toBe(50);
    expect(nameSize('Gençlerbirliği S.K.')).toBe(42);
  });
});

describe('the member card', () => {
  const settled = (home: string, outcome: 'home' | 'draw' | 'away', right: boolean) =>
    ({
      fixture: {
        id: home,
        kickoff_at: '2026-09-20T14:00:00.000Z',
        status: 'finished',
        competition: { id: 'c', name: 'Premier League' },
        home: { id: 'h', name: home, short_name: null },
        away: { id: 'a', name: 'Chelsea', short_name: null },
        score: { home: 2, away: 1 },
      },
      prediction: {
        latest: { outcome },
        settlement: { status: 'settled', actual: { home: 2, away: 1 }, outcome_correct: right },
      },
    }) as unknown as PredictionHistoryItem;

  it('shows the rating as the profile does, and the latest settled predictions', () => {
    const text = memberCardText(
      { display_name: 'Mo', username: 'mosiop' },
      { rating: 62.44, established: true, settled_count: 55 } as Rating,
      [settled('Arsenal', 'home', true), settled('Spurs', 'away', false)],
    );
    expect(text).toMatchObject({ name: 'Mo', handle: '@mosiop' });
    expect(text.rating).toBe('Rating 62.4 · established · 55 settled');
    expect(text.recent).toEqual([
      { match: 'Arsenal 2–1 Chelsea', verdict: 'Home win · right' },
      { match: 'Spurs 2–1 Chelsea', verdict: 'Away win · wrong' },
    ]);
  });

  it('says there is no rating yet, and leaves open and void predictions off', () => {
    const open = {
      ...settled('Leeds', 'draw', false),
      prediction: { latest: { outcome: 'draw' }, settlement: null },
    } as unknown as PredictionHistoryItem;
    const text = memberCardText({ display_name: 'New', username: 'newbie' }, null, [open]);
    expect(text.rating).toBe('No settled predictions yet');
    expect(text.recent).toEqual([]);
  });
});
