import { ACTIVITY_METRICS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { GROUP_OF, assemble, sinceOf, utcDays, windowDays } from './internal/series';

const NOW = new Date('2026-09-28T01:30:00Z');

describe('windowDays', () => {
  it('is thirty by default, a whole number from 1 to 90 otherwise, and null for anything else', () => {
    expect(windowDays(undefined)).toBe(30);
    expect(windowDays('')).toBe(30);
    expect(windowDays('1')).toBe(1);
    expect(windowDays('90')).toBe(90);
    for (const bad of ['0', '91', '-3', '7.5', 'seven', ['7'], 7]) {
      expect(windowDays(bad)).toBeNull();
    }
  });
});

describe('utcDays', () => {
  it('counts back from today in UTC, oldest first, today last', () => {
    // 01:30 UTC is still the 27th in the Americas; the page's days are UTC.
    expect(utcDays(NOW, 3)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28']);
    expect(utcDays(NOW, 30)).toHaveLength(30);
    expect(utcDays(NOW, 30)[0]).toBe('2026-08-30');
  });

  it('crosses month and year ends', () => {
    expect(utcDays(new Date('2027-01-01T23:59:59Z'), 3)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });

  it('reads from midnight UTC of the first day', () => {
    expect(sinceOf(utcDays(NOW, 3)).toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('assemble', () => {
  const days = utcDays(NOW, 3);

  it('gives every metric a series in the contract order, a zero for every quiet day', () => {
    const report = assemble(days, [], NOW);
    expect(report.days).toEqual(days);
    expect(report.generated_at).toBe(NOW.toISOString());
    expect(report.series.map((s) => s.metric)).toEqual([...ACTIVITY_METRICS]);
    for (const series of report.series) {
      expect(series.counts).toEqual([0, 0, 0]);
      expect(series.total).toBe(0);
      expect(series.group).toBe(GROUP_OF[series.metric]);
    }
  });

  it('places each count on its day and totals it', () => {
    const report = assemble(
      days,
      [
        { metric: 'registrations', day: '2026-09-26', n: 2 },
        { metric: 'registrations', day: '2026-09-28', n: 5 },
        { metric: 'push_failed', day: '2026-09-27', n: 1 },
      ],
      NOW,
    );
    const of = (metric: string) => report.series.find((s) => s.metric === metric);
    expect(of('registrations')).toMatchObject({ counts: [2, 0, 5], total: 7, group: 'members' });
    expect(of('push_failed')).toMatchObject({ counts: [0, 1, 0], group: 'notifications' });
  });

  it('drops a day outside the window and a metric the contract does not know', () => {
    const report = assemble(
      days,
      [
        { metric: 'registrations', day: '2026-09-25', n: 9 },
        { metric: 'page_views', day: '2026-09-27', n: 9 },
      ],
      NOW,
    );
    expect(report.series.every((s) => s.total === 0)).toBe(true);
    expect(report.series.map((s) => s.metric)).not.toContain('page_views');
  });

  it('carries numbers only: no field could hold a name', () => {
    const report = assemble(days, [{ metric: 'reports', day: '2026-09-27', n: 1 }], NOW);
    for (const series of report.series) {
      expect(Object.keys(series).sort()).toEqual(['counts', 'group', 'metric', 'total']);
      expect(series.counts.every((n) => Number.isInteger(n))).toBe(true);
    }
  });
});
