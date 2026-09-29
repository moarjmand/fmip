import type { ContributorFlag } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { daysSince, flagSummary, periodLine } from './contributor-flags';

const flag: ContributorFlag = {
  id: 'f',
  username: 'cara',
  below_since: '2026-08-01T00:00:00Z',
  rating_at_flag: 61,
  rating_now: 63,
  threshold: 70,
  period_days: 30,
  rules_version: 'contributor-flag@1.0.0',
  raised_at: '2026-08-31T04:20:00Z',
  standing: 'active',
  closed: null,
};

describe('contributor flag words (T-1031)', () => {
  it('counts whole days, never negative', () => {
    expect(daysSince('2026-08-01T00:00:00Z', new Date('2026-09-10T12:00:00Z'))).toBe(40);
    expect(daysSince('2026-08-01T00:00:00Z', new Date('2026-07-01T00:00:00Z'))).toBe(0);
  });

  it('says how long, how far below, and the current rating', () => {
    expect(flagSummary(flag, new Date('2026-09-10T12:00:00Z'))).toBe(
      'Below the contributor threshold of 70 for 40 days (rating 63; flagged after 30).',
    );
    expect(flagSummary({ ...flag, rating_now: null }, new Date('2026-08-02T00:00:00Z'))).toBe(
      'Below the contributor threshold of 70 for 1 day (rating 61; flagged after 30).',
    );
  });

  it('names the period as a proposal', () => {
    expect(periodLine(30, 70)).toMatch(/30 consecutive days below a rating of 70/);
    expect(periodLine(30, 70)).toMatch(/proposal until the maintainer confirms it/);
  });
});
