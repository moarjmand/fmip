import { describe, expect, it } from 'vitest';
import {
  outcomeOfScore,
  parseUpsetQuery,
  upsetResponse,
  type UpsetDayRow,
  type UpsetRow,
} from './internal/upset';

/** The pure half of T-1507: the day asked, and the answer built from the store's row. */

const NOW = new Date('2026-10-25T22:30:00Z');

describe('parseUpsetQuery', () => {
  it('defaults to today in UTC', () => {
    expect(parseUpsetQuery({}, NOW)).toEqual({
      ok: true,
      day: { date: '2026-10-25', timeZone: 'UTC' },
    });
  });

  it("reads today in the reader's zone, as the scores list does", () => {
    expect(parseUpsetQuery({ tz: 'Asia/Tehran' }, NOW)).toEqual({
      ok: true,
      day: { date: '2026-10-26', timeZone: 'Asia/Tehran' },
    });
  });

  it('takes a date as asked, and the first of a repeated parameter', () => {
    expect(
      parseUpsetQuery({ date: ['2026-10-24', '2026-10-23'], tz: 'Europe/London' }, NOW),
    ).toEqual({ ok: true, day: { date: '2026-10-24', timeZone: 'Europe/London' } });
  });

  it('refuses a date that is not a calendar date, and an unknown zone', () => {
    expect(parseUpsetQuery({ date: '2026-02-30', tz: 'Mars/Olympus' }, NOW)).toEqual({
      ok: false,
      fields: {
        date: 'must be a date, YYYY-MM-DD',
        tz: 'must be an IANA time zone, e.g. Europe/London',
      },
    });
    expect(parseUpsetQuery({ date: '25/10/2026' }, NOW)).toMatchObject({ ok: false });
  });
});

describe('outcomeOfScore', () => {
  it('reads the full-time score', () => {
    expect(outcomeOfScore(2, 1)).toBe('home');
    expect(outcomeOfScore(0, 3)).toBe('away');
    expect(outcomeOfScore(1, 1)).toBe('draw');
  });
});

describe('upsetResponse', () => {
  const day = { date: '2026-10-25', timeZone: 'UTC' };
  const upset = (home: number, away: number): UpsetRow => ({
    fixtureId: 'f1',
    kickoffAt: new Date('2026-10-25T15:00:00Z'),
    seasonId: 's1',
    competition: { id: 'c1', name: 'Premier League', shortName: 'PL' },
    home: { id: 't1', name: 'Home FC', shortName: 'HOM' },
    away: { id: 't2', name: 'Away FC', shortName: null },
    score: { home, away },
    probabilities: { home: 0.62, draw: 0.23, away: 0.15 },
    versionNumber: 3,
    kind: 'lineups_confirmed',
    modelVersion: 'dixon-coles@0.6.0',
    computedAt: new Date('2026-10-25T14:00:00Z'),
  });
  const row = (over: Partial<UpsetDayRow>): UpsetDayRow => ({
    finishedMatches: 4,
    stillToPlay: 2,
    lastUpdatedAt: new Date('2026-10-25T17:00:00Z'),
    upset: null,
    ...over,
  });

  it('gives the probability the model put on what happened', () => {
    const answer = upsetResponse(day, row({ upset: upset(0, 2) }));
    expect(answer).toEqual({
      date: '2026-10-25',
      time_zone: 'UTC',
      finished_matches: 4,
      still_to_play: 2,
      last_updated_at: '2026-10-25T17:00:00.000Z',
      coverage: 'available',
      reason: null,
      upset: {
        fixture_id: 'f1',
        kickoff_at: '2026-10-25T15:00:00.000Z',
        competition: { id: 'c1', name: 'Premier League', short_name: 'PL' },
        season_id: 's1',
        home_team: { id: 't1', name: 'Home FC', short_name: 'HOM' },
        away_team: { id: 't2', name: 'Away FC', short_name: null },
        score: { home: 0, away: 2 },
        outcome: 'away',
        probability: 0.15,
        probabilities: { home: 0.62, draw: 0.23, away: 0.15 },
        forecast: {
          version_number: 3,
          kind: 'lineups_confirmed',
          model_version: 'dixon-coles@0.6.0',
          computed_at: '2026-10-25T14:00:00.000Z',
        },
      },
    });
    expect(upsetResponse(day, row({ upset: upset(1, 1) })).upset?.probability).toBe(0.23);
    expect(upsetResponse(day, row({ upset: upset(3, 0) })).upset?.probability).toBe(0.62);
  });

  it('says why there is no match rather than an empty card (rule 3)', () => {
    expect(upsetResponse(day, row({ finishedMatches: 0, lastUpdatedAt: null }))).toEqual({
      date: '2026-10-25',
      time_zone: 'UTC',
      finished_matches: 0,
      still_to_play: 2,
      last_updated_at: null,
      coverage: 'not_supplied',
      reason: 'no_finished_match',
      upset: null,
    });
    expect(upsetResponse(day, row({}))).toMatchObject({
      coverage: 'not_supplied',
      reason: 'no_covered_forecast',
      upset: null,
    });
  });
});
