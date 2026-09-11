import type { FavouriteIds, ScoreCard } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { arrange, onlyFollowed, rankOf } from './internal/arrange';
import {
  MAX_RANGE_DAYS,
  dateIn,
  isTimeZone,
  parseScoresQuery,
  spanDays,
} from './internal/scores-query';
import type { ScoredRow } from './internal/scores-store';

const NOW = new Date('2025-01-05T22:30:00Z');

describe('parseScoresQuery', () => {
  it('defaults to today in the given zone, and the zone to UTC', () => {
    const utc = parseScoresQuery({}, NOW);
    expect(utc).toMatchObject({
      ok: true,
      filters: { from: '2025-01-05', to: '2025-01-05', timezone: 'UTC' },
    });
    // 22:30 UTC is already 6 January in Tehran (+03:30).
    const tehran = parseScoresQuery({ tz: 'Asia/Tehran' }, NOW);
    expect(tehran).toMatchObject({ ok: true, filters: { from: '2025-01-06', to: '2025-01-06' } });
  });

  it('accepts yesterday to the next five days and refuses a range past the cap', () => {
    const week = parseScoresQuery({ from: '2025-01-04', to: '2025-01-10' }, NOW);
    expect(week.ok).toBe(true);
    expect(spanDays('2025-01-04', '2025-01-10')).toBe(7);
    const long = parseScoresQuery({ from: '2025-01-01', to: '2025-01-31' }, NOW);
    expect(long).toEqual({
      ok: false,
      fields: { to: `range must be at most ${MAX_RANGE_DAYS} days` },
    });
    const backwards = parseScoresQuery({ from: '2025-01-10', to: '2025-01-04' }, NOW);
    expect(backwards).toEqual({ ok: false, fields: { to: 'must not be before from' } });
  });

  it('names every bad field at once', () => {
    const parsed = parseScoresQuery(
      {
        from: '2025-02-30',
        tz: 'Mars/Olympus',
        live: 'maybe',
        country: 'x',
        gender: 'all',
        age: 'kids',
      },
      NOW,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fields).sort()).toEqual([
      'age',
      'country',
      'from',
      'gender',
      'live',
      'tz',
    ]);
  });

  it('reads flags and ids, taking the first of a repeated parameter', () => {
    const parsed = parseScoresQuery(
      {
        live: ['1', '0'],
        favourites: 'true',
        competition: '00000000-0000-4000-8000-000000000201',
        gender: 'women',
        age: 'youth',
      },
      NOW,
    );
    expect(parsed).toMatchObject({
      ok: true,
      filters: {
        live: true,
        favourites: true,
        competition_id: '00000000-0000-4000-8000-000000000201',
        gender: 'women',
        age: 'youth',
        country_id: null,
      },
    });
  });

  it('knows real zones from invented ones', () => {
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Asia/Tehran')).toBe(true);
    expect(isTimeZone('Nowhere/Land')).toBe(false);
    expect(dateIn('Pacific/Auckland', NOW)).toBe('2025-01-06');
    expect(dateIn('America/Los_Angeles', NOW)).toBe('2025-01-05');
  });
});

// ---------------------------------------------------------------------------

const card = (over: Partial<ScoreCard> & { id: string }): ScoreCard => ({
  kickoff_at: '2025-01-05T15:00:00.000Z',
  status: 'scheduled',
  minute: null,
  competition: { id: 'c-pl', name: 'Premier League', short_name: null, country_id: 'eng' },
  season: { id: 's1', label: '2024/25' },
  stage: null,
  round: null,
  leg: null,
  home: { id: 't-liv', name: 'Liverpool', short_name: null, code: 'LIV' },
  away: { id: 't-mun', name: 'Manchester United', short_name: null, code: 'MUN' },
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

const england = { id: 'eng', name: 'England', code: 'ENG' };
const spain = { id: 'esp', name: 'Spain', code: 'ESP' };

const rows: ScoredRow[] = [
  {
    card: card({
      id: 'f-laliga',
      competition: { id: 'c-ll', name: 'La Liga', short_name: null, country_id: 'esp' },
      home: { id: 't-rma', name: 'Real Madrid', short_name: null, code: 'RMA' },
      away: { id: 't-fcb', name: 'Barcelona', short_name: null, code: 'FCB' },
      kickoff_at: '2025-01-05T20:00:00.000Z',
    }),
    country: spain,
  },
  { card: card({ id: 'f-pl-late', kickoff_at: '2025-01-05T17:30:00.000Z' }), country: england },
  {
    card: card({
      id: 'f-pl-early',
      home: { id: 't-ars', name: 'Arsenal', short_name: null, code: 'ARS' },
      away: { id: 't-che', name: 'Chelsea', short_name: null, code: 'CHE' },
      kickoff_at: '2025-01-05T12:30:00.000Z',
    }),
    country: england,
  },
  {
    card: card({
      id: 'f-ucl',
      competition: { id: 'c-ucl', name: 'Champions League', short_name: 'UCL', country_id: null },
      home: { id: 't-psg', name: 'PSG', short_name: null, code: 'PSG' },
      away: { id: 't-bay', name: 'Bayern', short_name: null, code: 'FCB' },
    }),
    country: null,
  },
];

describe('arrange', () => {
  it('groups a guest by competition, countries by name, kick-off within', () => {
    const { pinned, groups } = arrange(rows, null);
    expect(pinned).toEqual([]);
    expect(groups.map((g) => g.competition.name)).toEqual([
      'Champions League',
      'Premier League',
      'La Liga',
    ]);
    expect(groups[1]?.fixtures.map((f) => f.id)).toEqual(['f-pl-early', 'f-pl-late']);
    expect(groups[0]?.country).toBeNull();
  });

  it('pins favourite teams and competitions, lifts followed ones, marks the cards', () => {
    const prefs: FavouriteIds = {
      team_ids: ['t-liv'],
      competition_ids: [],
      person_ids: [],
      followed_team_ids: [],
      followed_competition_ids: ['c-ll'],
    };
    const { pinned, groups } = arrange(rows, prefs);
    expect(pinned.map((c) => [c.id, c.pinned])).toEqual([['f-pl-late', true]]);
    expect(groups.map((g) => g.competition.name)).toEqual([
      'La Liga',
      'Champions League',
      'Premier League',
    ]);
    expect(groups[2]?.fixtures.map((f) => f.id)).toEqual(['f-pl-early']);
    expect(rankOf(rows[0]!.card, prefs)).toBe(3);
    expect(onlyFollowed(rows, prefs).map((r) => r.card.id)).toEqual(['f-laliga', 'f-pl-late']);
  });
});
