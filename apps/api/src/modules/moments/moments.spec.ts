import type { FixtureStatus, MomentKind, ScoreCard, ScoresResponse } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  forecastCandidates,
  momentForecast,
  parseMomentsQuery,
  pickMoments,
  readRange,
  type PickedMoments,
} from './internal/moments';

/**
 * The moments' rule engine (T-1641, D-299) without a database: every
 * threshold at its edge, the priority between kinds, the caps, the quiet
 * day, and a match without a forecast. "Now" is Thursday 29 October 2026,
 * 18:00 UTC.
 */
const NOW = new Date('2026-10-29T18:00:00.000Z');
const at = (minutes: number): string => new Date(NOW.getTime() + minutes * 60_000).toISOString();
const HOUR = 60;

interface CardSpec {
  id: string;
  competition?: string;
  kickoff?: string;
  status?: FixtureStatus;
  minute?: number | null;
  current?: [number, number] | null;
  fullTime?: [number, number] | null;
  home?: string;
  away?: string;
}

function card(spec: CardSpec): ScoreCard {
  const status = spec.status ?? 'scheduled';
  const line = (pair: [number, number] | null | undefined) =>
    pair === null || pair === undefined ? null : { home: pair[0], away: pair[1] };
  return {
    id: spec.id,
    kickoff_at: spec.kickoff ?? at(-HOUR),
    status,
    minute: status === 'live' ? (spec.minute ?? null) : null,
    competition: {
      id: spec.competition ?? 'C0',
      name: 'League',
      short_name: null,
      country_id: null,
    },
    season: { id: 'season', label: '2026-27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: spec.home ?? `${spec.id}-home`, name: 'Home', short_name: null, code: null },
    away: { id: spec.away ?? `${spec.id}-away`, name: 'Away', short_name: null, code: null },
    scores: {
      current: line(spec.current),
      half_time: null,
      full_time: line(spec.fullTime),
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: at(-1),
    live_answered_at: null,
    freshness: null,
    pinned: false,
  };
}

const live = (
  id: string,
  minute: number | null,
  current: [number, number] | null,
  competition = 'C0',
) => card({ id, competition, status: 'live', minute, current, kickoff: at(-(minute ?? 0) - 15) });

interface Setup {
  cards: ScoreCard[];
  /** The answer's competition order; by first appearance when absent. */
  order?: string[];
  unplaced?: string[];
  forecasts?: Record<string, [number, number, number]>;
  featured?: string[];
  followed?: string[];
  timeZone?: string;
}

function run(setup: Setup): PickedMoments {
  const competitions = setup.order ?? [...new Set(setup.cards.map((c) => c.competition.id))];
  const scores: ScoresResponse = {
    filters: {
      from: '2026-10-27',
      to: '2026-11-11',
      timezone: setup.timeZone ?? 'UTC',
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    },
    generated_at: NOW.toISOString(),
    total: setup.cards.length,
    pinned: [],
    groups: competitions.map((id) => ({
      country: null,
      competition: { id, name: id, short_name: null },
      fixtures: setup.cards.filter((c) => c.competition.id === id),
    })),
  };
  const unplaced = new Set(setup.unplaced ?? []);
  return pickMoments({
    now: NOW,
    timeZone: setup.timeZone ?? 'UTC',
    scores,
    statedOrder: new Map(
      competitions.map((id, index) => [id, unplaced.has(id) ? null : index + 1]),
    ),
    featured: new Set(setup.featured ?? []),
    forecasts: new Map(
      Object.entries(setup.forecasts ?? {}).map(([id, [home, draw, away]]) => [
        id,
        { home, draw, away, model_version: 'dixon-coles@1.4.0', computed_at: at(-10 * HOUR) },
      ]),
    ),
    followedTeams: new Set(setup.followed ?? []),
  });
}

const kindOf = (result: PickedMoments, id: string): MomentKind | null =>
  result.moments.find((m) => m.fixture.id === id)?.kind ?? null;
const momentOf = (result: PickedMoments, id: string) =>
  result.moments.find((m) => m.fixture.id === id);
const idsOf = (result: PickedMoments, kind?: MomentKind) =>
  result.moments.filter((m) => kind === undefined || m.kind === kind).map((m) => m.fixture.id);

/** Six competitions with a match tomorrow evening: the homepage's hero is tomorrow's, so no big one today. */
const BIG_TOMORROW = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'].map((competition, index) =>
  card({ id: `tomorrow-${index}`, competition, kickoff: at(26 * HOUR + index) }),
);

describe('against_forecast', () => {
  it('needs minute 60 and a leader the model gave at most 0.35', () => {
    const result = run({
      cards: [
        live('at60', 60, [0, 1]),
        live('at59', 59, [0, 1]),
        live('chance36', 70, [0, 1]),
        live('noMinute', null, [0, 1]),
        live('noForecast', 70, [0, 1]),
        live('noScore', 70, null),
      ],
      forecasts: {
        at60: [0.4, 0.25, 0.35],
        at59: [0.4, 0.25, 0.35],
        chance36: [0.4, 0.24, 0.36],
        noMinute: [0.6, 0.2, 0.2],
        noScore: [0.6, 0.2, 0.2],
      },
    });
    expect(momentOf(result, 'at60')).toMatchObject({
      kind: 'against_forecast',
      side: 'away',
      minutes_left: null,
      forecast: { home: 0.4, draw: 0.25, away: 0.35, model_version: 'dixon-coles@1.4.0' },
    });
    expect(idsOf(result)).toEqual(['at60']);
  });
});

describe('level_late', () => {
  it('needs minute 75 and a level score, and counts to the 90th minute', () => {
    const result = run({
      cards: [
        live('at75', 75, [1, 1]),
        live('at74', 74, [1, 1]),
        live('added', 95, [2, 2]),
        live('notLevel', 80, [2, 1]),
      ],
    });
    expect(momentOf(result, 'at75')).toMatchObject({
      kind: 'level_late',
      minutes_left: 15,
      side: null,
    });
    expect(momentOf(result, 'added')).toMatchObject({ kind: 'level_late', minutes_left: 0 });
    expect(kindOf(result, 'at74')).toBeNull();
    expect(kindOf(result, 'notLevel')).toBeNull();
  });

  it('needs no forecast, and then carries none', () => {
    const result = run({ cards: [live('bare', 80, [0, 0])] });
    expect(momentOf(result, 'bare')).toMatchObject({ kind: 'level_late', forecast: null });
  });
});

describe('favourite_held', () => {
  it('needs minute 46 and a side given at least 0.65 that is not winning', () => {
    const result = run({
      cards: [
        live('at46', 46, [0, 0]),
        live('at45', 45, [0, 0]),
        live('chance64', 50, [0, 0]),
        live('winning', 50, [1, 0]),
        live('awayBehind', 50, [2, 1]),
        live('noForecast', 50, [0, 1]),
      ],
      forecasts: {
        at46: [0.65, 0.2, 0.15],
        at45: [0.65, 0.2, 0.15],
        chance64: [0.64, 0.2, 0.16],
        winning: [0.7, 0.2, 0.1],
        awayBehind: [0.1, 0.2, 0.7],
      },
    });
    expect(momentOf(result, 'at46')).toMatchObject({ kind: 'favourite_held', side: 'home' });
    expect(momentOf(result, 'awayBehind')).toMatchObject({ kind: 'favourite_held', side: 'away' });
    expect(kindOf(result, 'at45')).toBeNull();
    expect(kindOf(result, 'chance64')).toBeNull();
    expect(kindOf(result, 'winning')).toBeNull();
    expect(kindOf(result, 'noForecast')).toBeNull();
  });
});

describe('one moment per fixture, the highest kind', () => {
  it('ranks against_forecast over level_late over favourite_held', () => {
    const result = run({
      cards: [live('levelFavourite', 80, [1, 1]), live('upsetFavourite', 70, [0, 1])],
      forecasts: { levelFavourite: [0.7, 0.2, 0.1], upsetFavourite: [0.7, 0.2, 0.1] },
    });
    expect(result.moments.map((m) => [m.fixture.id, m.kind, m.side])).toEqual([
      ['upsetFavourite', 'against_forecast', 'away'],
      ['levelFavourite', 'level_late', null],
    ]);
  });
});

describe('big_one', () => {
  it('is the homepage hero while it is still to come today', () => {
    const result = run({
      cards: [
        card({ id: 'big', competition: 'C0', kickoff: at(3 * HOUR) }),
        card({ id: 'smaller', competition: 'C1', kickoff: at(HOUR) }),
      ],
    });
    expect(momentOf(result, 'big')).toMatchObject({ kind: 'big_one', side: null, forecast: null });
    expect(kindOf(result, 'smaller')).not.toBe('big_one');
  });

  it('is none while the hero is in play', () => {
    const result = run({
      cards: [live('playing', 30, [0, 0]), card({ id: 'later', kickoff: at(3 * HOUR) })],
    });
    expect(idsOf(result, 'big_one')).toEqual([]);
  });

  it('puts a featured match before the competitions’ order', () => {
    const result = run({
      cards: [
        card({ id: 'first', competition: 'C0', kickoff: at(HOUR) }),
        card({ id: 'featured', competition: 'C3', kickoff: at(2 * HOUR) }),
      ],
      featured: ['featured'],
    });
    expect(idsOf(result, 'big_one')).toEqual(['featured']);
  });

  it('is none when the hero is tomorrow, and a seventh competition is not big', () => {
    const result = run({
      cards: [...BIG_TOMORROW, card({ id: 'seventh', competition: 'C6', kickoff: at(2 * HOUR) })],
    });
    expect(idsOf(result, 'big_one')).toEqual([]);
    expect(kindOf(result, 'seventh')).toBeNull();
  });

  it('ranks among the homepage’s competitions only: one with nothing from today on does not count', () => {
    const result = run({
      cards: [
        card({
          id: 'yesterday',
          competition: 'P',
          status: 'finished',
          kickoff: at(-24 * HOUR),
          fullTime: [1, 0],
        }),
        ...BIG_TOMORROW.slice(0, 5),
        card({ id: 'sixth', competition: 'C5', kickoff: at(2 * HOUR) }),
      ],
      order: ['P', 'C0', 'C1', 'C2', 'C3', 'C4', 'C5'],
    });
    expect(idsOf(result, 'big_one')).toEqual(['sixth']);
  });
});

describe('starting_soon', () => {
  it('takes a ranked competition’s match within 30 minutes, at most two', () => {
    const result = run({
      cards: [
        ...BIG_TOMORROW,
        card({ id: 'in30', competition: 'C6', kickoff: at(30) }),
        card({ id: 'in31', competition: 'C6', kickoff: at(31) }),
        card({ id: 'in10', competition: 'C7', kickoff: at(10) }),
        card({ id: 'in20', competition: 'C8', kickoff: at(20) }),
        card({ id: 'unranked', competition: 'U', kickoff: at(5) }),
      ],
      order: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'U'],
      unplaced: ['U'],
    });
    expect(idsOf(result, 'starting_soon')).toEqual(['in30', 'in10']);
    expect(kindOf(result, 'in31')).toBeNull();
    expect(kindOf(result, 'in20')).toBeNull();
    expect(kindOf(result, 'unranked')).toBeNull();
  });
});

describe('closest_call', () => {
  it('is the lowest top probability among forecasts kicking off within 12 hours', () => {
    const result = run({
      cards: [
        ...BIG_TOMORROW,
        card({ id: 'even', competition: 'C6', kickoff: at(11 * HOUR) }),
        card({ id: 'lean', competition: 'C6', kickoff: at(2 * HOUR) }),
        card({ id: 'beyond', competition: 'C6', kickoff: at(12 * HOUR + 1) }),
        card({ id: 'noForecast', competition: 'C6', kickoff: at(HOUR) }),
      ],
      forecasts: {
        even: [0.34, 0.33, 0.33],
        lean: [0.4, 0.3, 0.3],
        beyond: [0.33, 0.34, 0.33],
      },
    });
    expect(idsOf(result, 'closest_call')).toEqual(['even']);
    expect(kindOf(result, 'lean')).toBeNull();
    expect(kindOf(result, 'noForecast')).toBeNull();
  });

  it('is no card when the most even match already holds a higher kind', () => {
    const result = run({
      cards: [
        card({ id: 'big', competition: 'C0', kickoff: at(3 * HOUR) }),
        card({ id: 'second', competition: 'C1', kickoff: at(4 * HOUR) }),
      ],
      forecasts: { big: [0.34, 0.33, 0.33], second: [0.4, 0.3, 0.3] },
    });
    expect(kindOf(result, 'big')).toBe('big_one');
    expect(idsOf(result, 'closest_call')).toEqual([]);
  });
});

describe('upset', () => {
  // Three level matches late on make the day not quiet.
  const busy = [live('l1', 80, [0, 0]), live('l2', 81, [1, 1]), live('l3', 82, [2, 2])];

  it('takes a finish in the last 12 hours whose winner had at most 0.30', () => {
    const result = run({
      cards: [
        ...busy,
        card({ id: 'p30', status: 'finished', kickoff: at(-13 * HOUR), fullTime: [0, 1] }),
        card({ id: 'p31', status: 'finished', kickoff: at(-13 * HOUR), fullTime: [0, 1] }),
        card({ id: 'early', status: 'finished', kickoff: at(-14 * HOUR - 1), fullTime: [0, 1] }),
        card({ id: 'draw', status: 'finished', kickoff: at(-5 * HOUR), fullTime: [1, 1] }),
        card({ id: 'noForecast', status: 'finished', kickoff: at(-5 * HOUR), fullTime: [0, 1] }),
        card({ id: 'void', status: 'abandoned', kickoff: at(-5 * HOUR), fullTime: [0, 1] }),
      ],
      forecasts: {
        p30: [0.5, 0.2, 0.3],
        p31: [0.49, 0.2, 0.31],
        early: [0.8, 0.1, 0.1],
        draw: [0.45, 0.1, 0.45],
        void: [0.8, 0.1, 0.1],
      },
    });
    expect(momentOf(result, 'p30')).toMatchObject({ kind: 'upset', side: 'away' });
    expect(idsOf(result, 'upset')).toEqual(['p30']);
  });

  it('looks 36 hours back on a quiet day, two at most, the latest first', () => {
    const result = run({
      cards: [
        card({ id: 'recent', status: 'finished', kickoff: at(-13 * HOUR), fullTime: [0, 1] }),
        card({ id: 'yesterday', status: 'finished', kickoff: at(-20 * HOUR), fullTime: [2, 0] }),
        card({ id: 'lastNight', status: 'finished', kickoff: at(-15 * HOUR), fullTime: [0, 3] }),
        card({ id: 'tooOld', status: 'finished', kickoff: at(-38 * HOUR - 1), fullTime: [0, 1] }),
      ],
      forecasts: {
        recent: [0.6, 0.2, 0.2],
        yesterday: [0.2, 0.2, 0.6],
        lastNight: [0.7, 0.2, 0.1],
        tooOld: [0.8, 0.1, 0.1],
      },
    });
    expect(idsOf(result, 'upset')).toEqual(['recent', 'lastNight']);
  });
});

describe('followed', () => {
  const cards = [
    // Featured, so the hero even while two big matches are in play.
    card({ id: 'big', competition: 'C0', kickoff: at(4 * HOUR) }),
    card({ id: 'mine', competition: 'C3', kickoff: at(5 * HOUR), home: 'T1' }),
    card({ id: 'mineTomorrow', competition: 'C3', kickoff: at(30 * HOUR), away: 'T1' }),
    {
      ...live('mineLive', 80, [1, 1], 'C3'),
      away: { id: 'T1', name: 'Mine', short_name: null, code: null },
    },
    live('other', 70, [0, 1]),
  ];
  const forecasts: Setup['forecasts'] = { other: [0.6, 0.2, 0.2] };
  const featured = ['big'];

  it('keeps a followed match’s own kind, marks the rest of today’s as followed, and ranks them first', () => {
    const result = run({ cards, forecasts, featured, order: ['C0', 'C3'], followed: ['T1'] });
    expect(result.moments.map((m) => [m.fixture.id, m.kind, m.followed])).toEqual([
      ['mineLive', 'level_late', true],
      ['mine', 'followed', true],
      ['other', 'against_forecast', false],
      ['big', 'big_one', false],
    ]);
  });

  it('marks nothing followed for a guest', () => {
    const result = run({ cards, forecasts, featured, order: ['C0', 'C3'] });
    expect(result.moments.map((m) => [m.fixture.id, m.kind, m.followed])).toEqual([
      ['other', 'against_forecast', false],
      ['mineLive', 'level_late', false],
      ['big', 'big_one', false],
    ]);
  });
});

describe('the answer', () => {
  it('holds at most eight moments, the latest minute first within a kind', () => {
    const cards = Array.from({ length: 10 }, (_, i) => live(`level${80 + i}`, 80 + i, [1, 1]));
    const result = run({ cards });
    expect(idsOf(result)).toEqual([89, 88, 87, 86, 85, 84, 83, 82].map((m) => `level${m}`));
    expect(result.live_count).toBe(10);
  });

  it('orders a kind by the competitions’ importance before the minute', () => {
    const result = run({
      cards: [live('minor', 89, [0, 0], 'C1'), live('major', 76, [0, 0], 'C0')],
      order: ['C0', 'C1'],
    });
    expect(idsOf(result)).toEqual(['major', 'minor']);
  });

  it('adds the top competitions’ next matches on a quiet day, three at most within 72 hours', () => {
    const cards = [
      ...['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((competition, i) =>
        card({ id: `next-${competition}`, competition, kickoff: at(20 * HOUR + i) }),
      ),
      card({ id: 'afar', competition: 'C0', kickoff: at(72 * HOUR + 1) }),
    ];
    const quiet = run({ cards });
    expect(idsOf(quiet, 'coming_up')).toEqual(['next-C0', 'next-C1', 'next-C2']);

    const busy = run({
      cards: [...cards, live('l1', 80, [0, 0]), live('l2', 81, [1, 1]), live('l3', 82, [2, 2])],
    });
    expect(idsOf(busy, 'coming_up')).toEqual([]);
  });

  it('counts today in the reader’s zone and every match in play', () => {
    const cards = [
      live('playing', 30, [0, 0]),
      card({ id: 'evening', kickoff: '2026-10-29T20:00:00.000Z' }), // 23:30 in Tehran
      card({ id: 'late', kickoff: '2026-10-29T21:00:00.000Z' }), // 00:30 on the 30th in Tehran
      card({
        id: 'yesterday',
        status: 'finished',
        kickoff: '2026-10-28T12:00:00.000Z',
        fullTime: [1, 0],
      }),
    ];
    expect(run({ cards })).toMatchObject({ live_count: 1, today_count: 3 });
    expect(run({ cards, timeZone: 'Asia/Tehran' })).toMatchObject({
      live_count: 1,
      today_count: 2,
    });
  });

  it('reads the forecast of every fixture it can pick, and of no far-off one', () => {
    const cards = [
      live('playing', 70, [0, 1]),
      card({ id: 'soon', kickoff: at(20) }),
      card({ id: 'finished', status: 'finished', kickoff: at(-13 * HOUR), fullTime: [0, 1] }),
      card({ id: 'farOff', kickoff: at(72 * HOUR + 1) }),
      card({ id: 'longAgo', status: 'finished', kickoff: at(-38 * HOUR - 1), fullTime: [0, 1] }),
    ];
    const candidates = forecastCandidates(cards, 'UTC', NOW);
    expect(candidates).toEqual(['playing', 'soon', 'finished']);
    const result = run({
      cards,
      forecasts: { playing: [0.7, 0.2, 0.1], finished: [0.7, 0.2, 0.1] },
    });
    expect(idsOf(result).every((id) => candidates.includes(id))).toBe(true);
    expect(result.moments.length).toBeGreaterThan(0);
  });
});

describe('reading the request and the stored forecast', () => {
  it('reads the zone as /scores does, UTC by default, `tz` as well', () => {
    expect(parseMomentsQuery({})).toEqual({ ok: true, timeZone: 'UTC' });
    expect(parseMomentsQuery({ timezone: 'Asia/Tehran' })).toEqual({
      ok: true,
      timeZone: 'Asia/Tehran',
    });
    expect(parseMomentsQuery({ tz: 'Europe/London' })).toEqual({
      ok: true,
      timeZone: 'Europe/London',
    });
    expect(parseMomentsQuery({ timezone: 'Nowhere/Town' })).toMatchObject({
      ok: false,
      fields: { timezone: expect.any(String) },
    });
    expect(parseMomentsQuery({ timezone: '+03:30' })).toMatchObject({ ok: false });
  });

  it('reads from two days before today to the end of the homepage’s fortnight', () => {
    expect(readRange('UTC', NOW)).toEqual({
      today: '2026-10-29',
      from: '2026-10-27',
      to: '2026-11-11',
    });
    expect(readRange('Asia/Tehran', new Date('2026-10-29T21:00:00Z')).today).toBe('2026-10-30');
  });

  it('carries an available version and never an unavailable one', () => {
    const summary = {
      version_number: 3,
      kind: 'early' as const,
      model_version: 'dixon-coles@1.4.0',
      computed_at: '2026-10-29T09:00:00.000Z',
      status: 'available' as const,
      probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
      unavailable_reason: null,
    };
    expect(momentForecast(summary)).toEqual({
      home: 0.5,
      draw: 0.3,
      away: 0.2,
      model_version: 'dixon-coles@1.4.0',
      computed_at: '2026-10-29T09:00:00.000Z',
    });
    expect(
      momentForecast({
        ...summary,
        status: 'unavailable',
        probabilities: null,
        unavailable_reason: 'no_history',
      }),
    ).toBeNull();
    expect(momentForecast(null)).toBeNull();
  });
});
