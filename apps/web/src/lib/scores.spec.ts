import type { ScoreCard } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  apiQuery,
  dayStrip,
  formatKickoff,
  pageHref,
  readScoresQuery,
  scoreLabel,
  shiftDate,
  statusLabel,
} from './scores';

const NOW = new Date('2025-01-05T22:30:00Z');

const card = (over: Partial<ScoreCard>): ScoreCard => ({
  id: 'f1',
  kickoff_at: '2025-01-05T16:30:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c', name: 'Premier League', short_name: null, country_id: null },
  season: { id: 's', label: '2024/25' },
  stage: null,
  round: null,
  leg: null,
  home: { id: 'h', name: 'Liverpool', short_name: null, code: 'LIV' },
  away: { id: 'a', name: 'Manchester United', short_name: null, code: 'MUN' },
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
  coverage: 'limited',
  last_updated_at: '2025-01-05T10:00:00.000Z',
  pinned: false,
  ...over,
});

describe('readScoresQuery', () => {
  it('prefers ?tz, then the member zone, then UTC, and computes today in it', () => {
    expect(readScoresQuery({}, null, NOW)).toMatchObject({
      timezone: 'UTC',
      today: '2025-01-05',
      date: '2025-01-05',
      explicitTimezone: false,
    });
    expect(readScoresQuery({}, 'Asia/Tehran', NOW)).toMatchObject({
      timezone: 'Asia/Tehran',
      today: '2025-01-06',
      date: '2025-01-06',
    });
    expect(readScoresQuery({ tz: 'Europe/London' }, 'Asia/Tehran', NOW)).toMatchObject({
      timezone: 'Europe/London',
      explicitTimezone: true,
    });
    expect(readScoresQuery({ tz: 'Nowhere/Land' }, null, NOW).timezone).toBe('UTC');
  });

  it('falls back to today on a bad date and reads the flags', () => {
    expect(readScoresQuery({ date: '2025-13-40' }, null, NOW).date).toBe('2025-01-05');
    expect(
      readScoresQuery({ date: '2025-01-09', live: '1', favourites: 'true' }, null, NOW),
    ).toMatchObject({ date: '2025-01-09', live: true, favourites: true });
  });
});

describe('links', () => {
  const q = readScoresQuery({ date: '2025-01-07' }, 'Asia/Tehran', NOW);

  it('builds the API query for one day in the zone', () => {
    expect(apiQuery(q)).toBe('from=2025-01-07&to=2025-01-07&tz=Asia%2FTehran');
    expect(apiQuery({ ...q, live: true, favourites: true })).toContain('live=1&favourites=1');
  });

  it('keeps state across page links and drops what is default', () => {
    expect(pageHref('en', q)).toBe('/en/scores?date=2025-01-07');
    expect(pageHref('en', q, { date: q.today })).toBe('/en/scores');
    expect(pageHref('en', { ...q, explicitTimezone: true, live: true }, { date: q.today })).toBe(
      '/en/scores?tz=Asia%2FTehran&live=1',
    );
  });

  it('lists yesterday, today and the next five days, marking today and the selection', () => {
    const strip = dayStrip(q);
    expect(strip.map((d) => d.date)).toEqual([
      '2025-01-05',
      '2025-01-06',
      '2025-01-07',
      '2025-01-08',
      '2025-01-09',
      '2025-01-10',
      '2025-01-11',
    ]);
    expect(strip.map((d) => d.label).slice(0, 3)).toEqual(['Yesterday', 'Today', 'Tomorrow']);
    expect(strip.find((d) => d.isToday)?.date).toBe('2025-01-06');
    expect(strip.find((d) => d.isSelected)?.date).toBe('2025-01-07');
    expect(shiftDate('2025-01-31', 1)).toBe('2025-02-01');
  });
});

describe('card labels', () => {
  it('shows the clock, the abbreviation or the local kick-off', () => {
    expect(statusLabel(card({ status: 'live', minute: 67 }), 'UTC')).toBe('67′');
    expect(statusLabel(card({ status: 'live' }), 'UTC')).toBe('Live');
    expect(statusLabel(card({ status: 'finished' }), 'UTC')).toBe('FT');
    expect(
      statusLabel(
        card({
          status: 'finished',
          scores: { ...card({}).scores, extra_time: { home: 1, away: 1 } },
        }),
        'UTC',
      ),
    ).toBe('AET');
    expect(statusLabel(card({}), 'Asia/Tehran')).toBe('20:00');
    expect(statusLabel(card({ status: 'postponed' }), 'UTC')).toBe('Postponed');
    expect(formatKickoff('2025-01-05T16:30:00.000Z', 'Europe/London')).toBe('16:30');
  });

  it('never shows a score it does not have', () => {
    expect(scoreLabel(card({}))).toBe('–');
    expect(
      scoreLabel(
        card({ status: 'live', scores: { ...card({}).scores, current: { home: 0, away: 1 } } }),
      ),
    ).toBe('0 – 1');
    expect(
      scoreLabel(
        card({
          status: 'finished',
          scores: {
            ...card({}).scores,
            current: { home: 2, away: 2 },
            full_time: { home: 2, away: 2 },
          },
        }),
      ),
    ).toBe('2 – 2');
  });
});
