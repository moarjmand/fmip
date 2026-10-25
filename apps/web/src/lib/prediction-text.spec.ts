import { describe, expect, it } from 'vitest';
import { isoDay } from './prediction-text';

describe('isoDay', () => {
  it('keeps the ISO date in English, in UTC by default', () => {
    expect(isoDay('en', '2026-10-25T23:30:00Z')).toBe('2026-10-25');
  });

  it('gives the day in the zone the time beside it is in (T-1542)', () => {
    // 23:30 UTC is 03:00 the next day in Tehran: the date must not say the 25th.
    expect(isoDay('en', '2026-10-25T23:30:00Z', 'Asia/Tehran')).toBe('2026-10-26');
    expect(isoDay('en', '2026-07-01T23:30:00Z', 'Europe/London')).toBe('2026-07-02');
    expect(isoDay('fa', '2026-10-25T23:30:00Z', 'Asia/Tehran')).toContain('۴');
  });
});
