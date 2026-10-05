import { describe, expect, it } from 'vitest';
import {
  SEASON_COVERAGE_RECHECK_DAYS,
  SEASON_COVERAGE_RETRY_HOURS,
  seasonCoverageDue,
} from './ingestion-jobs.service';

// T-1364: when the line-ups job asks the provider what it covers for a season.
const NOW = new Date('2026-10-04T12:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

describe('seasonCoverageDue', () => {
  it('asks a season never asked about', () => {
    expect(seasonCoverageDue(null, NOW)).toBe(true);
  });

  it('keeps an answer for a week, then asks again', () => {
    const week = SEASON_COVERAGE_RECHECK_DAYS * 24;
    const answered = (hours: number) => ({
      absences: false,
      askedAt: ago(hours),
      answeredAt: ago(hours),
    });
    expect(seasonCoverageDue(answered(week - 1), NOW)).toBe(false);
    expect(seasonCoverageDue(answered(week), NOW)).toBe(true);
  });

  it('tries an ask that got no answer again the next day, not on every run', () => {
    const unanswered = (hours: number) => ({
      absences: null,
      askedAt: ago(hours),
      answeredAt: null,
    });
    expect(seasonCoverageDue(unanswered(1), NOW)).toBe(false);
    expect(seasonCoverageDue(unanswered(SEASON_COVERAGE_RETRY_HOURS), NOW)).toBe(true);
    // An old answer whose re-ask just failed is not asked again at once either.
    expect(
      seasonCoverageDue({ absences: true, askedAt: ago(1), answeredAt: ago(30 * 24) }, NOW),
    ).toBe(false);
  });
});
