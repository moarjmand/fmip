import type { ForecastVersion, ScoreCard, ScoresGroup } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_LENGTH,
  type PostCompetition,
  type PostMatch,
  composeDailyPost,
  dayLabel,
  kickoffTime,
  matchUrl,
  percentages,
  postDay,
  selectMatches,
} from './daily-post';

const ORIGIN = 'https://fmip.example';
const DAY = '2026-09-27';
const MORNING = new Date('2026-09-27T06:41:00Z');

let next = 0;
const id = (): string => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

function card(overrides: Partial<ScoreCard> = {}): ScoreCard {
  return {
    id: id(),
    kickoff_at: '2026-09-27T14:00:00.000Z',
    status: 'scheduled',
    minute: null,
    competition: { id: 'c', name: 'Premier League', short_name: null, country_id: 'e' },
    season: { id: 's', label: '2026/27' },
    stage: null,
    round: null,
    leg: null,
    home: { id: 'h', name: 'Arsenal', short_name: null, code: null },
    away: { id: 'a', name: 'Chelsea', short_name: null, code: null },
    scores: {
      current: null,
      half_time: null,
      full_time: null,
      extra_time: null,
      penalties: null,
      aggregate: null,
    },
    red_cards: { home: 0, away: 0 },
    incidents: [],
    venue: null,
    coverage: 'available',
    last_updated_at: '2026-09-26T00:00:00.000Z',
    freshness: null,
    pinned: false,
    ...overrides,
  };
}

function group(name: string, country: string | null, fixtures: ScoreCard[]): ScoresGroup {
  return {
    country: country === null ? null : { id: country, name: country, code: 'XXX' },
    competition: { id: name, name, short_name: null },
    fixtures,
  };
}

function forecast(fixtureId: string, overrides: Partial<ForecastVersion> = {}): ForecastVersion {
  return {
    id: id(),
    fixture_id: fixtureId,
    version_number: 1,
    kind: 'early',
    model_version: 'dixon-coles@1.0.0',
    computed_at: '2026-09-26T12:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.4823, draw: 0.2712, away: 0.2465 },
    expected_goals: null,
    most_likely_scorelines: null,
    leading_factors: null,
    data_completeness: 'available',
    inputs: null,
    unavailable_reason: null,
    unavailable_detail: null,
    ...overrides,
  };
}

function match(overrides: Partial<PostMatch> = {}): PostMatch {
  return {
    fixtureId: id(),
    kickoffAt: '2026-09-27T14:00:00.000Z',
    home: 'Arsenal',
    away: 'Chelsea',
    forecast: {
      percentages: { home: 48.2, draw: 27.1, away: 24.7 },
      modelVersion: 'dixon-coles@1.0.0',
      limited: false,
    },
    ...overrides,
  };
}

describe('the day and its times', () => {
  it('is the UTC day, whatever the hour', () => {
    expect(postDay(new Date('2026-09-26T23:59:59Z'))).toBe('2026-09-26');
    expect(postDay(new Date('2026-09-27T00:00:00Z'))).toBe('2026-09-27');
  });

  it('writes the day in words and the kick-off in UTC', () => {
    expect(dayLabel(DAY)).toBe('Sunday 27 September 2026');
    expect(kickoffTime('2026-09-27T19:45:00.000Z')).toBe('19:45');
    expect(kickoffTime('2026-09-27T00:05:00.000Z')).toBe('00:05');
  });

  it('links each match to its page on the public site, in English', () => {
    expect(matchUrl('https://fmip.example/', 'abc')).toBe('https://fmip.example/en/match/abc');
  });
});

describe('percentages', () => {
  it('rounds to one decimal and totals exactly 100', () => {
    expect(percentages({ home: 0.4823, draw: 0.2712, away: 0.2465 })).toEqual({
      home: 48.2,
      draw: 27.1,
      away: 24.7,
    });
    const thirds = percentages({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 });
    expect(Math.round((thirds.home + thirds.draw + thirds.away) * 10)).toBe(1000);
  });

  it('lets the largest absorb the rounding gap, as the web does', () => {
    // 0.33349 + 0.33349 + 0.33302 rounds to 33.3 + 33.3 + 33.3 = 99.9.
    expect(percentages({ home: 0.33349, draw: 0.33349, away: 0.33302 })).toEqual({
      home: 33.4,
      draw: 33.3,
      away: 33.3,
    });
  });
});

describe('selectMatches', () => {
  it('keeps the product order and only matches still to come', () => {
    const early = card({ kickoff_at: '2026-09-27T02:30:00.000Z' });
    const live = card({ status: 'live', minute: 10 });
    const postponed = card({ status: 'postponed' });
    const later = card({ kickoff_at: '2026-09-27T19:00:00.000Z' });
    const unsupplied = card({ coverage: 'not_supplied' });
    const cup = card({ kickoff_at: '2026-09-27T18:45:00.000Z' });
    const selected = selectMatches(
      [
        group('Premier League', 'England', [early, live, postponed, later]),
        group('Nowhere League', 'Nowhere', [unsupplied]),
        group('Champions League', null, [cup]),
      ],
      new Map(),
      MORNING,
    );
    expect(selected.map((c) => c.title)).toEqual(['England · Premier League', 'Champions League']);
    expect(selected[0]?.matches.map((m) => m.fixtureId)).toEqual([later.id]);
    expect(selected[1]?.matches.map((m) => m.fixtureId)).toEqual([cup.id]);
  });

  it('takes only an available forecast, and says when the model had limited data', () => {
    const withForecast = card();
    const limited = card();
    const unavailable = card();
    const none = card();
    const latest = new Map<string, ForecastVersion | null>([
      [withForecast.id, forecast(withForecast.id)],
      [limited.id, forecast(limited.id, { data_completeness: 'limited' })],
      [
        unavailable.id,
        forecast(unavailable.id, {
          status: 'unavailable',
          probabilities: null,
          data_completeness: null,
          unavailable_reason: 'no_history',
        }),
      ],
      [none.id, null],
    ]);
    const [premier] = selectMatches(
      [group('Premier League', 'England', [withForecast, limited, unavailable, none])],
      latest,
      MORNING,
    );
    expect(premier?.matches.map((m) => m.forecast)).toEqual([
      {
        percentages: { home: 48.2, draw: 27.1, away: 24.7 },
        modelVersion: 'dixon-coles@1.0.0',
        limited: false,
      },
      {
        percentages: { home: 48.2, draw: 27.1, away: 24.7 },
        modelVersion: 'dixon-coles@1.0.0',
        limited: true,
      },
      null,
      null,
    ]);
  });
});

describe('composeDailyPost', () => {
  it('posts nothing on a day with no matches', () => {
    expect(composeDailyPost(DAY, [], ORIGIN)).toBeNull();
    expect(composeDailyPost(DAY, [{ title: 'Empty', matches: [] }], ORIGIN)).toBeNull();
  });

  it("is labelled as the statistical model's, names its version and links every match", () => {
    const arsenal = match({ fixtureId: 'f1' });
    const none = match({ fixtureId: 'f2', home: 'Everton', away: 'Fulham', forecast: null });
    const post = composeDailyPost(
      DAY,
      [{ title: 'England · Premier League', matches: [arsenal, none] }],
      ORIGIN,
    );
    expect(post).not.toBeNull();
    expect(post?.messages).toEqual([
      [
        "FMIP · The statistical model's forecast · Sunday 27 September 2026",
        'Home win, draw and away win probabilities from the statistical model (dixon-coles@1.0.0). Kick-off times in UTC.',
        '',
        'England · Premier League',
        '',
        '14:00  Arsenal v Chelsea',
        'Arsenal 48.2% · Draw 27.1% · Chelsea 24.7%',
        'https://fmip.example/en/match/f1',
        '',
        '14:00  Everton v Fulham',
        'No forecast from the statistical model',
        'https://fmip.example/en/match/f2',
      ].join('\n'),
    ]);
    expect(post).toMatchObject({
      day: DAY,
      fixtures: 2,
      forecasts: 1,
      modelVersions: ['dixon-coles@1.0.0'],
    });
  });

  it('never borrows a number for a match the model has no forecast for', () => {
    const post = composeDailyPost(
      DAY,
      [{ title: 'Iran · Persian Gulf Pro League', matches: [match({ forecast: null })] }],
      ORIGIN,
    );
    const text = post?.messages[0] ?? '';
    expect(text).toContain('The statistical model has no forecast for these matches.');
    expect(text).toContain('No forecast from the statistical model');
    expect(text).not.toMatch(/\d%/);
    expect(post).toMatchObject({ fixtures: 1, forecasts: 0, modelVersions: [] });
  });

  it('names the version on each line when the day mixes two, and says when data was limited', () => {
    const post = composeDailyPost(
      DAY,
      [
        {
          title: 'England · Premier League',
          matches: [
            match(),
            match({
              forecast: {
                percentages: { home: 30, draw: 30, away: 40 },
                modelVersion: 'dixon-coles@1.1.0',
                limited: true,
              },
            }),
          ],
        },
      ],
      ORIGIN,
    );
    const text = post?.messages[0] ?? '';
    expect(text).toContain('(dixon-coles@1.0.0, dixon-coles@1.1.0; each line names its version)');
    expect(text).toContain('Arsenal 48.2% · Draw 27.1% · Chelsea 24.7% · dixon-coles@1.0.0');
    expect(text).toContain(
      'Arsenal 30% · Draw 30% · Chelsea 40% · limited data · dixon-coles@1.1.0',
    );
  });

  it('splits between competitions, in order, every message labelled and within the limit', () => {
    const competitions: PostCompetition[] = Array.from({ length: 12 }, (_, i) => ({
      title: `Country ${i} · League ${i}`,
      matches: Array.from({ length: 6 }, () => match()),
    }));
    const post = composeDailyPost(DAY, competitions, ORIGIN);
    const messages = post?.messages ?? [];
    expect(messages.length).toBeGreaterThan(1);
    messages.forEach((text, i) => {
      expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
      expect(text.startsWith("FMIP · The statistical model's forecast · ")).toBe(true);
      expect(text.split('\n')[0]).toMatch(new RegExp(`\\(${i + 1}/${messages.length}\\)$`));
    });
    // Each competition whole, in one message, and the order kept across them.
    const seen = competitions.map((c) => messages.findIndex((text) => text.includes(c.title)));
    competitions.forEach((c) => {
      expect(messages.filter((text) => text.includes(`${c.title}\n`)).length).toBe(1);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(post?.fixtures).toBe(72);
    const links = messages.join('\n').match(/https:\/\/fmip\.example\/en\/match\//g) ?? [];
    expect(links.length).toBe(72);
  });

  it('cuts one competition longer than a message between its matches, naming it again', () => {
    const cup: PostCompetition = {
      title: 'England · FA Cup',
      matches: Array.from({ length: 60 }, () => match()),
    };
    const after: PostCompetition = { title: 'Spain · LaLiga', matches: [match()] };
    const messages = composeDailyPost(DAY, [cup, after], ORIGIN)?.messages ?? [];
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((text) => text.length <= MAX_MESSAGE_LENGTH)).toBe(true);
    const cupMessages = messages.filter((text) => text.includes('England · FA Cup'));
    expect(cupMessages.length).toBeGreaterThan(1);
    expect(cupMessages[0]).toContain('England · FA Cup\n');
    expect(
      cupMessages.slice(1).every((text) => text.includes('England · FA Cup (continued)')),
    ).toBe(true);
    expect(messages.join('\n').match(/14:00 {2}Arsenal v Chelsea/g)?.length).toBe(61);
    expect(messages.at(-1)).toContain('Spain · LaLiga');
  });

  it('keeps every message within a smaller limit too', () => {
    const competitions: PostCompetition[] = Array.from({ length: 4 }, (_, i) => ({
      title: `League ${i}`,
      matches: Array.from({ length: 3 }, () => match()),
    }));
    const messages = composeDailyPost(DAY, competitions, ORIGIN, 900)?.messages ?? [];
    expect(messages.length).toBeGreaterThan(2);
    expect(messages.every((text) => text.length <= 900)).toBe(true);
  });
});
