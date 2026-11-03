import { ACTIVITY_METRICS } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { ActivityService } from './activity.service';
import type { ActivityStore } from './internal/activity-store';
import {
  DAILY_THROUGH,
  dayStart,
  daysToRollUp,
  mergeRolledUp,
  nextDay,
  type RollUpState,
} from './internal/daily';
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

describe('daysToRollUp (T-1727, D-353)', () => {
  const state = (over: Partial<RollUpState>): RollUpState => ({
    keptThrough: null,
    purgeThrough: null,
    firstDay: null,
    ...over,
  });

  it('keeps nothing when the purge deletes no session', () => {
    expect(daysToRollUp(state({ keptThrough: '2026-09-01', firstDay: '2026-06-01' }))).toBeNull();
  });

  it('starts at the first day with any activity while nothing is kept yet', () => {
    expect(daysToRollUp(state({ firstDay: '2026-06-01', purgeThrough: '2026-09-20' }))).toEqual({
      from: '2026-06-01',
      through: '2026-09-20',
    });
  });

  it('carries on the day after the last kept day, across a month end', () => {
    expect(
      daysToRollUp(
        state({ keptThrough: '2026-09-30', firstDay: '2026-06-01', purgeThrough: '2026-10-02' }),
      ),
    ).toEqual({ from: '2026-10-01', through: '2026-10-02' });
  });

  it('never writes a kept day again', () => {
    for (const purgeThrough of ['2026-09-20', '2026-09-19']) {
      expect(
        daysToRollUp(state({ keptThrough: '2026-09-20', firstDay: '2026-06-01', purgeThrough })),
      ).toBeNull();
    }
  });

  it('counts in whole UTC days', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(dayStart('2026-10-25').toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });
});

describe('mergeRolledUp (T-1727, D-353)', () => {
  const through = { metric: DAILY_THROUGH, day: '2026-09-20', n: 0 };

  it('passes the live rows through untouched while nothing is kept', () => {
    const live = [
      { metric: 'sign_ins', day: '2026-09-01', n: 4 },
      { metric: 'active_members', day: '2026-09-01', n: 3 },
    ];
    expect(mergeRolledUp(live)).toEqual(live);
  });

  it('takes the kept days up to and including the boundary, and the live rows after it', () => {
    const rows = [
      // Live rows of kept days, partly purged: dropped.
      { metric: 'sign_ins', day: '2026-09-19', n: 1 },
      { metric: 'active_members', day: '2026-09-20', n: 2 },
      // Live rows after the boundary: kept.
      { metric: 'sign_ins', day: '2026-09-21', n: 9 },
      { metric: 'active_members', day: '2026-09-21', n: 6 },
      // The roll-up's rows.
      { metric: 'daily:sign_ins', day: '2026-09-19', n: 12 },
      { metric: 'daily:sign_ins', day: '2026-09-20', n: 10 },
      { metric: 'daily:active_members', day: '2026-09-20', n: 7 },
      through,
    ];
    expect(mergeRolledUp(rows)).toEqual([
      { metric: 'sign_ins', day: '2026-09-21', n: 9 },
      { metric: 'active_members', day: '2026-09-21', n: 6 },
      { metric: 'sign_ins', day: '2026-09-19', n: 12 },
      { metric: 'sign_ins', day: '2026-09-20', n: 10 },
      { metric: 'active_members', day: '2026-09-20', n: 7 },
    ]);
  });

  it('gives each day and metric one source, so assembling never adds the two', () => {
    const days = ['2026-09-20', '2026-09-21'];
    const rows = mergeRolledUp([
      { metric: 'sign_ins', day: '2026-09-20', n: 3 },
      { metric: 'daily:sign_ins', day: '2026-09-20', n: 5 },
      { metric: 'sign_ins', day: '2026-09-21', n: 2 },
      { metric: 'daily:sign_ins', day: '2026-09-21', n: 99 },
      through,
    ]);
    const report = assemble(days, rows, NOW);
    expect(report.series.find((s) => s.metric === 'sign_ins')?.counts).toEqual([5, 2]);
  });

  it('leaves every other metric live on every day', () => {
    const rows = [
      { metric: 'registrations', day: '2026-09-01', n: 2 },
      { metric: 'predictions', day: '2026-09-20', n: 8 },
      through,
    ];
    expect(mergeRolledUp(rows)).toEqual(rows.slice(0, 2));
  });
});

describe('ActivityService.keepDailyCounts', () => {
  function service(state: RollUpState) {
    const calls: { from: string; until: string }[] = [];
    const store = {
      rollUpState: async () => state,
      rollUp: async (from: Date, until: Date) => {
        calls.push({ from: from.toISOString(), until: until.toISOString() });
        return 3;
      },
    } as unknown as ActivityStore;
    return { activity: new ActivityService(store), calls };
  }

  it('writes the days through the latest purged creation day, as whole UTC days', async () => {
    const { activity, calls } = service({
      keptThrough: '2026-09-17',
      purgeThrough: '2026-09-20',
      firstDay: '2026-06-01',
    });
    expect(await activity.keepDailyCounts(new Date('2026-10-04T03:23:00Z'))).toBe(3);
    expect(calls).toEqual([
      { from: '2026-09-18T00:00:00.000Z', until: '2026-09-21T00:00:00.000Z' },
    ]);
  });

  it('writes nothing when there is nothing new to keep', async () => {
    const { activity, calls } = service({
      keptThrough: '2026-09-20',
      purgeThrough: '2026-09-20',
      firstDay: '2026-06-01',
    });
    expect(await activity.keepDailyCounts(new Date('2026-10-04T03:23:00Z'))).toBe(0);
    expect(calls).toEqual([]);
  });
});
