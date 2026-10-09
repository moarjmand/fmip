import type { ScoreCard } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  apiQuery,
  blockUpdatedLabel,
  dayStrip,
  firstMatchDay,
  formatKickoff,
  formatStamp,
  freshnessStamp,
  NEXT_DAY_WINDOWS,
  pageHref,
  readScoresQuery,
  scoreLabel,
  shiftDate,
  statusLabel,
} from './scores';
import { scoresWords } from './words-server';

const EN_WORDS = scoresWords('en').m;

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
  freshness: null,
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
    const strip = dayStrip(q, 'en');
    // 2025-01-08 is a Wednesday: "Wed 8" in English, and in Spanish it is
    // Spanish -- the whole reason the strip takes a locale.
    expect(strip[3]?.label).toBe('Wed 8');
    expect(dayStrip(q, 'es')[3]?.label).toMatch(/^mié/);
    expect(dayStrip(q, 'de')[3]?.label).toMatch(/^Mi/);
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
    expect(statusLabel(card({ status: 'live', minute: 67 }), 'en', 'UTC')).toBe('67′');
    expect(statusLabel(card({ status: 'live' }), 'en', 'UTC')).toBe('Live');
    // A live match whose data is behind never shows a minute as current (T-083).
    const behind = card({
      status: 'live',
      minute: 67,
      last_updated_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    });
    expect(statusLabel(behind, 'en', 'UTC', NOW.getTime())).toBe('Behind');
    expect(
      statusLabel(card({ status: 'live', minute: 67, freshness: 'stale' }), 'en', 'UTC', 0),
    ).toBe('Behind');
    expect(statusLabel(card({ status: 'finished' }), 'en', 'UTC')).toBe('FT');
    expect(
      statusLabel(
        card({
          status: 'finished',
          scores: { ...card({}).scores, extra_time: { home: 1, away: 1 } },
        }),
        'en',
        'UTC',
      ),
    ).toBe('AET');
    expect(statusLabel(card({}), 'en', 'Asia/Tehran')).toBe('20:00');
    expect(statusLabel(card({ status: 'postponed' }), 'en', 'UTC')).toBe('Postponed');
    expect(formatKickoff('en', '2025-01-05T16:30:00.000Z', 'Europe/London')).toBe('16:30');
    // A clock reading is the same digits in every language; the day strip is
    // where the language shows. Both pinned, because a helper that localised
    // the clock would have been "working" and wrong.
    expect(formatKickoff('es', '2025-01-05T16:30:00.000Z', 'Europe/London')).toBe('16:30');
    expect(formatKickoff('ar', '2025-01-05T16:30:00.000Z', 'Europe/London')).toMatch(/16.30/);
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

/** Late on 5 January 2025, still the 5th in UTC and in Tehran. */
const SAME_DAY = Date.parse('2025-01-05T18:00:00.000Z');

describe('blockUpdatedLabel', () => {
  it('says one time when every card in the block agrees', () => {
    expect(blockUpdatedLabel([card({}), card({})], 'en', 'UTC', EN_WORDS, SAME_DAY)).toBe(
      'Updated 10:00',
    );
  });

  it('says the oldest and the newest when they differ, never the newest alone', () => {
    const cards = [
      card({ last_updated_at: '2025-01-05T16:31:00.000Z' }),
      card({ last_updated_at: '2025-01-05T10:00:00.000Z' }),
      card({ last_updated_at: '2025-01-05T14:05:00.000Z' }),
    ];
    expect(blockUpdatedLabel(cards, 'en', 'Asia/Tehran', EN_WORDS, SAME_DAY)).toBe(
      'Updated between 13:30 and 20:01',
    );
  });

  it('dates a block whose oldest card is from another day (T-1371)', () => {
    const cards = [
      card({ last_updated_at: '2025-01-05T16:31:00.000Z' }),
      card({ last_updated_at: '2025-01-03T10:00:00.000Z' }),
    ];
    expect(blockUpdatedLabel(cards, 'en', 'UTC', EN_WORDS, SAME_DAY)).toBe(
      'Updated between 2 days ago (3 Jan 2025, 10:00) and 16:31',
    );
  });

  it('says nothing for an empty block', () => {
    expect(blockUpdatedLabel([], 'en', 'UTC', EN_WORDS)).toBeNull();
  });
});

// T-1371: "16:15" read on 8 October for a time on 26 September looked like
// this afternoon. A time says its day whenever that day is not today.
describe('freshnessStamp', () => {
  const NOW = Date.parse('2026-10-08T12:00:00.000Z');

  it('is the clock reading alone today', () => {
    expect(freshnessStamp('en', '2026-10-08T09:15:00.000Z', 'UTC', NOW)).toEqual({
      text: '09:15',
      days: 0,
      stale: false,
    });
  });

  it('says yesterday, with the date and time', () => {
    expect(formatStamp('en', '2026-10-07T16:15:00.000Z', 'UTC', NOW)).toBe(
      'yesterday (7 Oct 2026, 16:15)',
    );
  });

  it('says how many days ago an older time was, with the date and time', () => {
    expect(formatStamp('en', '2026-09-26T16:15:00.000Z', 'UTC', NOW)).toBe(
      '12 days ago (26 Sept 2026, 16:15)',
    );
    expect(freshnessStamp('en', '2026-09-26T16:15:00.000Z', 'UTC', NOW).days).toBe(12);
  });

  it('counts calendar days in the viewer zone, not 24-hour spans', () => {
    // 21:00 UTC on the 7th is already 00:30 on the 8th in Tehran: today there.
    const late = '2026-10-07T21:00:00.000Z';
    expect(formatStamp('en', late, 'Asia/Tehran', NOW)).toBe('00:30');
    expect(formatStamp('en', late, 'UTC', NOW)).toBe('yesterday (7 Oct 2026, 21:00)');
    // Ten minutes before midnight in Tehran is yesterday by morning, though
    // only hours old.
    const morning = Date.parse('2026-10-08T05:00:00.000Z');
    expect(formatStamp('en', '2026-10-07T20:20:00.000Z', 'Asia/Tehran', morning)).toBe(
      'yesterday (7 Oct 2026, 23:50)',
    );
  });

  it('says the reader its days in the reader language', () => {
    expect(formatStamp('fa', '2026-09-26T16:15:00.000Z', 'Asia/Tehran', NOW)).toMatch(
      /^۱۲ روز پیش \(.+۱۹:۴۵\)$/,
    );
    // The pseudo-locale formats as English rather than throwing.
    expect(formatStamp('x-rtl', '2026-10-07T16:15:00.000Z', 'UTC', NOW)).toBe(
      'yesterday (7 Oct 2026, 16:15)',
    );
  });

  it('is stale only beyond the threshold the surface gives', () => {
    const sixHours = 6 * 60 * 60 * 1000;
    expect(freshnessStamp('en', '2026-10-08T06:30:00.000Z', 'UTC', NOW, sixHours).stale).toBe(
      false,
    );
    expect(freshnessStamp('en', '2026-10-08T05:30:00.000Z', 'UTC', NOW, sixHours)).toEqual({
      text: '05:30',
      days: 0,
      stale: true,
    });
    // No threshold, no stale words, however old.
    expect(freshnessStamp('en', '2026-09-26T16:15:00.000Z', 'UTC', NOW).stale).toBe(false);
  });

  it('dates a time ahead of the clock rather than calling it today', () => {
    expect(formatStamp('en', '2026-10-09T08:00:00.000Z', 'UTC', NOW)).toBe('9 Oct 2026, 08:00');
  });
});

describe('the status cell in Persian (T-1303)', () => {
  const FA = scoresWords('fa').m;
  it('names the status and prints the minute and the score in Persian digits', () => {
    expect(statusLabel(card({ status: 'finished' }), 'fa', 'UTC', undefined, FA)).toBe('پایان');
    expect(statusLabel(card({ status: 'live', minute: 67 }), 'fa', 'UTC', undefined, FA)).toBe(
      '۶۷′',
    );
    expect(
      scoreLabel(
        card({ status: 'live', scores: { ...card({}).scores, current: { home: 2, away: 1 } } }),
        'fa',
      ),
    ).toBe('۲ – ۱');
  });
});

describe('the next match day after an empty one (T-1331)', () => {
  const at = (kickoff_at: string) => ({ kickoff_at }) as ScoreCard;

  it('is the earliest kick-off, dated in the viewer zone', () => {
    const data = {
      pinned: [],
      groups: [
        { fixtures: [at('2026-10-09T18:00:00Z')] },
        { fixtures: [at('2026-10-08T21:30:00Z'), at('2026-10-10T12:00:00Z')] },
      ],
    };
    expect(firstMatchDay(data, 'UTC')).toBe('2026-10-08');
    // 21:30 UTC is already the next day in Tehran.
    expect(firstMatchDay(data, 'Asia/Tehran')).toBe('2026-10-09');
  });

  it('counts a pinned card and is null when nothing is ahead', () => {
    expect(firstMatchDay({ pinned: [at('2026-10-02T10:00:00Z')], groups: [] }, 'UTC')).toBe(
      '2026-10-02',
    );
    expect(firstMatchDay({ pinned: [], groups: [] }, 'UTC')).toBeNull();
  });

  it('asks in windows the API accepts, covering four weeks without overlap', () => {
    for (const [start, end] of NEXT_DAY_WINDOWS) expect(end - start + 1).toBeLessThanOrEqual(14);
    expect(NEXT_DAY_WINDOWS.at(-1)?.[1]).toBe(28);
  });

  it('can ask for a range', () => {
    const q = readScoresQuery({ date: '2026-10-02' }, 'UTC');
    expect(apiQuery(q, '2026-10-15')).toContain('from=2026-10-02&to=2026-10-15');
  });
});
