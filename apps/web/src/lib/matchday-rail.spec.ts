import {
  type CompetitionDirectoryEntry,
  NO_MEDIA,
  type ScoreCard,
  type ScoresGroup,
  type ScoresResponse,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  drawerFixtures,
  openLeague,
  railLeagues,
  railStatus,
  railStatusText,
} from './matchday-rail';

/**
 * The matchday rail's rules (T-1624, D-292): which leagues, in which order,
 * with which status, and which league's matches the drawer opens on.
 */

/** Saturday 24 October 2026, 18:00 UTC (19:00 in London, 21:30 in Tehran). */
const NOW = Date.parse('2026-10-24T18:00:00.000Z');
const ZONE = 'Europe/London';

function entry(
  id: string,
  over: Partial<CompetitionDirectoryEntry> = {},
): CompetitionDirectoryEntry {
  return {
    id,
    name: id.toUpperCase(),
    short_name: null,
    scope: 'domestic',
    kind: 'league',
    country: null,
    order: null,
    logo: NO_MEDIA,
    season: null,
    next_kickoff_at: null,
    ...over,
  };
}

function card(id: string, over: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id,
    kickoff_at: '2026-10-24T14:00:00.000Z',
    status: 'finished',
    minute: null,
    competition: { id: 'c', name: 'C', short_name: null, country_id: null },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Home', short_name: null, code: 'HOM' },
    away: { id: 'a', name: 'Away', short_name: null, code: 'AWA' },
    scores: {
      current: { home: 1, away: 0 },
      half_time: null,
      full_time: { home: 1, away: 0 },
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-10-24T17:59:50.000Z',
    freshness: null,
    pinned: false,
    ...over,
  };
}

const live = (id: string) => card(id, { status: 'live', minute: 60 });
const at = (id: string, kickoff: string) =>
  card(id, {
    status: 'scheduled',
    kickoff_at: kickoff,
    scores: { ...card('x').scores, current: null, full_time: null },
  });

function group(id: string, fixtures: ScoreCard[], name = id.toUpperCase()): ScoresGroup {
  return { country: null, competition: { id, name, short_name: null }, fixtures };
}

function answer(groups: ScoresGroup[]): ScoresResponse {
  return {
    filters: {
      from: '2026-10-24',
      to: '2026-10-24',
      timezone: ZONE,
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    },
    generated_at: '2026-10-24T17:59:55.000Z',
    total: groups.reduce((n, g) => n + g.fixtures.length, 0),
    pinned: [],
    groups,
  };
}

describe('a league’s status', () => {
  it('is how many are live when any match is being played', () => {
    expect(
      railStatus(
        group('a', [live('1'), live('2'), at('3', '2026-10-24T20:00:00Z')]),
        null,
        NOW,
        ZONE,
      ),
    ).toEqual({ kind: 'live', count: 2 });
  });

  it('is the next kick-off today when none is live, the earliest of those yet to start', () => {
    expect(
      railStatus(
        group('a', [card('1'), at('2', '2026-10-24T20:00:00Z'), at('3', '2026-10-24T19:30:00Z')]),
        '2026-10-31T15:00:00Z',
        NOW,
        ZONE,
      ),
    ).toEqual({ kind: 'later', at: '2026-10-24T19:30:00Z' });
  });

  it('is the next match day after today, by the reader’s calendar', () => {
    // Every match today over: the directory's next kick-off counts.
    expect(railStatus(group('a', [card('1')]), '2026-10-27T19:00:00Z', NOW, ZONE)).toEqual({
      kind: 'day',
      at: '2026-10-27T19:00:00Z',
      days: 3,
    });
    // 23:30 in London is still Saturday; in Tehran it is Sunday.
    expect(railStatus(null, '2026-10-24T22:30:00Z', NOW, ZONE)).toEqual({
      kind: 'later',
      at: '2026-10-24T22:30:00Z',
    });
    expect(railStatus(null, '2026-10-24T22:30:00Z', NOW, 'Asia/Tehran')).toMatchObject({
      kind: 'day',
      days: 1,
    });
  });

  it('is none when nothing is known, or the known kick-off has passed', () => {
    expect(railStatus(null, null, NOW, ZONE)).toEqual({ kind: 'none' });
    expect(railStatus(null, undefined, NOW, ZONE)).toEqual({ kind: 'none' });
    expect(railStatus(null, '2026-10-24T17:00:00Z', NOW, ZONE)).toEqual({ kind: 'none' });
    expect(railStatus(null, 'not a date', NOW, ZONE)).toEqual({ kind: 'none' });
    expect(railStatus(group('a', [card('1')]), null, NOW, ZONE)).toEqual({ kind: 'none' });
  });
});

describe('the rail’s order', () => {
  const directory = [
    entry('pgpl', { next_kickoff_at: '2026-10-30T15:00:00Z' }),
    entry('ucl'),
    entry('epl'),
    entry('laliga'),
    entry('seriea'),
    entry('ligue1', { next_kickoff_at: '2026-11-20T19:00:00Z' }),
  ];
  const scores = answer([
    group('laliga', [at('l1', '2026-10-24T20:00:00Z')]),
    group('epl', [card('e1'), live('e2')]),
    group('seriea', [at('s1', '2026-10-24T19:45:00Z')]),
    group('ucl', [card('u1')]),
    group('empty', []),
  ]);

  it('puts the live leagues first, then those playing later today by kick-off, then the product’s order', () => {
    const leagues = railLeagues(directory, scores, NOW, ZONE);
    expect(leagues.map((l) => l.id)).toEqual(['epl', 'seriea', 'laliga', 'pgpl', 'ucl', 'ligue1']);
    expect(leagues.map((l) => l.status.kind)).toEqual([
      'live',
      'later',
      'later',
      'day',
      'none',
      'day',
    ]);
    // A league whose matches today are over still opens them.
    expect(leagues.find((l) => l.id === 'ucl')?.today?.fixtures).toHaveLength(1);
    expect(leagues.find((l) => l.id === 'pgpl')?.today).toBeNull();
  });

  it('keeps the product’s order inside the live band', () => {
    const both = answer([group('laliga', [live('l')]), group('epl', [live('e')])]);
    expect(
      railLeagues(directory, both, NOW, ZONE)
        .slice(0, 2)
        .map((l) => l.id),
    ).toEqual(['epl', 'laliga']);
  });

  it('names the bar’s first leagues and every league playing today, however far down', () => {
    const leagues = railLeagues(directory, answer([group('ligue1', [live('f')])]), NOW, ZONE, 2);
    expect(leagues.map((l) => l.id)).toEqual(['ligue1', 'pgpl', 'ucl']);
  });

  it('draws a league playing today from today’s answer when the directory could not be read', () => {
    const leagues = railLeagues(
      [],
      answer([group('epl', [live('e')], 'Premier League')]),
      NOW,
      ZONE,
    );
    expect(leagues).toEqual([
      expect.objectContaining({
        id: 'epl',
        name: 'Premier League',
        logo: null,
        status: { kind: 'live', count: 1 },
      }),
    ]);
  });

  it('is the product’s order with no answer for today', () => {
    expect(railLeagues(directory, null, NOW, ZONE).map((l) => l.id)).toEqual(
      directory.map((e) => e.id),
    );
  });
});

describe('the drawer', () => {
  it('opens on the first league in the rail’s order that plays today', () => {
    const scores = answer([
      group('laliga', [at('l', '2026-10-24T20:00:00Z')]),
      group('epl', [live('e')]),
    ]);
    expect(openLeague(railLeagues([entry('laliga'), entry('epl')], scores, NOW, ZONE))).toBe('epl');
  });

  it('is none on a day with no match, or when today could not be read', () => {
    expect(
      openLeague(railLeagues([entry('epl')], answer([group('epl', [])]), NOW, ZONE)),
    ).toBeNull();
    expect(openLeague(railLeagues([entry('epl')], null, NOW, ZONE))).toBeNull();
  });

  it('lists the live matches first, then those to come, then the finished', () => {
    const cards = [
      { id: 'early-ft', status: 'finished', kickoff_at: '2026-10-26T13:30:00Z' },
      { id: 'late', status: 'scheduled', kickoff_at: '2026-10-26T21:00:00Z' },
      { id: 'live-b', status: 'live', kickoff_at: '2026-10-26T19:00:00Z' },
      { id: 'soon', status: 'scheduled', kickoff_at: '2026-10-26T20:00:00Z' },
      { id: 'live-a', status: 'live', kickoff_at: '2026-10-26T18:45:00Z' },
    ];
    expect(drawerFixtures(cards).map((c) => c.id)).toEqual([
      'live-a',
      'live-b',
      'soon',
      'late',
      'early-ft',
    ]);
  });
});

describe('a status in words', () => {
  const count = (n: number) => `${n} live`;

  it('says how many are live, the time in the reader’s zone, the weekday within six days', () => {
    expect(railStatusText({ kind: 'live', count: 2 }, 'en', ZONE, NOW, count)).toBe('2 live');
    expect(
      railStatusText({ kind: 'later', at: '2026-10-24T19:00:00Z' }, 'en', ZONE, NOW, count),
    ).toBe('20:00');
    expect(
      railStatusText({ kind: 'day', at: '2026-10-27T19:00:00Z', days: 3 }, 'en', ZONE, NOW, count),
    ).toBe('Tue');
    expect(railStatusText({ kind: 'none' }, 'en', ZONE, NOW, count)).toBeNull();
  });

  it('gives a short date further away, with the year when it is not this one', () => {
    expect(
      railStatusText({ kind: 'day', at: '2026-11-07T15:00:00Z', days: 14 }, 'en', ZONE, NOW, count),
    ).toBe('7 Nov');
    expect(
      railStatusText(
        { kind: 'day', at: '2099-01-01T15:00:00Z', days: 26000 },
        'en',
        ZONE,
        NOW,
        count,
      ),
    ).toBe('1 Jan 2099');
    // The year by the reader's calendar: 10 January 2027 is still 1405 on /fa.
    const january = { kind: 'day', at: '2027-01-10T12:00:00Z', days: 78 } as const;
    expect(railStatusText(january, 'en', ZONE, NOW, count)).toBe('10 Jan 2027');
    expect(railStatusText(january, 'fa', 'Asia/Tehran', NOW, count)).toBe('۲۰ دی');
  });

  it('is in Persian words and digits on /fa', () => {
    expect(
      railStatusText(
        { kind: 'later', at: '2026-10-24T17:00:00Z' },
        'fa',
        'Asia/Tehran',
        NOW,
        count,
      ),
    ).toBe('۲۰:۳۰');
    const day = railStatusText(
      { kind: 'day', at: '2026-10-27T15:00:00Z', days: 3 },
      'fa',
      'Asia/Tehran',
      NOW,
      count,
    );
    expect(day).toBe('سه‌شنبه');
    expect(day).not.toMatch(/[0-9A-Za-z]/);
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-10-24', '2026-10-25')).toBe(1);
    expect(daysBetween('2026-10-24', '2026-10-24')).toBe(0);
    expect(daysBetween('2026-12-31', '2027-01-07')).toBe(7);
  });
});
