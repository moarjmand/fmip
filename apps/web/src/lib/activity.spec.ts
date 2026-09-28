import { ACTIVITY_METRICS, type ActivityGroup, type ActivityReport } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  GROUP_WORDS,
  METRIC_WORDS,
  bySection,
  dayLabel,
  lastDays,
  nothingRecorded,
} from './activity';

const GROUP: Partial<Record<string, ActivityGroup>> = {
  predictions: 'predictions',
  prediction_changes: 'predictions',
  settlements: 'predictions',
  rating_snapshots: 'predictions',
  direct_messages: 'conversation',
  group_messages: 'conversation',
  panel_posts: 'conversation',
  group_polls: 'conversation',
  reports: 'conversation',
  notifications: 'notifications',
  push_sent: 'notifications',
  push_failed: 'notifications',
  email_sent: 'notifications',
  email_failed: 'notifications',
};

const report = (counts: Record<string, number[]> = {}): ActivityReport => ({
  generated_at: '2026-09-28T10:00:00.000Z',
  days: ['2026-09-26', '2026-09-27', '2026-09-28'],
  series: ACTIVITY_METRICS.map((metric) => {
    const values = counts[metric] ?? [0, 0, 0];
    return {
      metric,
      group: GROUP[metric] ?? 'members',
      counts: values,
      total: values.reduce((a, b) => a + b, 0),
    };
  }),
});

describe('the activity words', () => {
  it('names every metric the contract has, and says what it counts', () => {
    for (const metric of ACTIVITY_METRICS) {
      expect(METRIC_WORDS[metric].label.length).toBeGreaterThan(0);
      expect(METRIC_WORDS[metric].counts.length).toBeGreaterThan(0);
    }
  });

  it('says what a deleted account takes with it, rather than letting a count look complete', () => {
    expect(METRIC_WORDS.verifications.counts).toMatch(/deleted/);
    expect(METRIC_WORDS.sign_ins.counts).toMatch(/deleted/);
    expect(METRIC_WORDS.active_members.counts).toMatch(/distinct/);
  });
});

describe('bySection', () => {
  it('keeps the page order: members, predictions, conversation, notifications', () => {
    const sections = bySection(report());
    expect(sections.map((s) => s.group)).toEqual([
      'members',
      'predictions',
      'conversation',
      'notifications',
    ]);
    expect(sections.map((s) => GROUP_WORDS[s.group])).toEqual([
      'Members',
      'Predictions',
      'Conversation',
      'Notifications',
    ]);
    expect(sections.flatMap((s) => s.series).length).toBe(ACTIVITY_METRICS.length);
  });
});

describe('the figures', () => {
  it('sums the newest days, and all of them when asked for more than there are', () => {
    expect(lastDays([1, 2, 3, 4], 2)).toBe(7);
    expect(lastDays([1, 2, 3, 4], 7)).toBe(10);
    expect(lastDays([], 7)).toBe(0);
  });

  it('tells a quiet window from one with something in it', () => {
    expect(nothingRecorded(report())).toBe(true);
    expect(nothingRecorded(report({ reports: [0, 1, 0] }))).toBe(false);
  });

  it('labels a UTC day without a time zone moving it', () => {
    expect(dayLabel('2026-09-28')).toBe('28 Sep');
    expect(dayLabel('2027-01-01')).toBe('1 Jan');
    expect(dayLabel('not a day')).toBe('not a day');
  });
});
