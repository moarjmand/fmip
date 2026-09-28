import {
  ACTIVITY_DEFAULT_DAYS,
  ACTIVITY_MAX_DAYS,
  ACTIVITY_METRICS,
  type ActivityGroup,
  type ActivityMetric,
  type ActivityReport,
} from '@fmip/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Which section of the page each count belongs to. */
export const GROUP_OF: Record<ActivityMetric, ActivityGroup> = {
  registrations: 'members',
  verifications: 'members',
  sign_ins: 'members',
  active_members: 'members',
  deletions: 'members',
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

/**
 * `?days=`: absent means the default thirty; otherwise a whole number from 1
 * to `ACTIVITY_MAX_DAYS`. `null` for anything else, which the controller
 * answers with a validation error rather than a silently different window.
 */
export function windowDays(raw: unknown): number | null {
  if (raw === undefined || raw === '') return ACTIVITY_DEFAULT_DAYS;
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw)) return null;
  const days = Number(raw);
  return days >= 1 && days <= ACTIVITY_MAX_DAYS ? days : null;
}

/** The report's UTC calendar days, oldest first, ending with `now`'s (a partial day). */
export function utcDays(now: Date, days: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

/** The start of the first day, the lower bound every count is read from. */
export function sinceOf(days: string[]): Date {
  return new Date(`${days[0] ?? '1970-01-01'}T00:00:00Z`);
}

export interface CountRow {
  metric: string;
  day: string;
  n: number;
}

/**
 * The store's rows (only days with something in them) to one series per
 * metric with a zero for every quiet day, in the contract's order. A row for
 * a day outside the window or a metric the contract does not know is dropped.
 */
export function assemble(days: string[], rows: readonly CountRow[], now: Date): ActivityReport {
  const index = new Map(days.map((day, i) => [day, i]));
  const counts = new Map<ActivityMetric, number[]>(
    ACTIVITY_METRICS.map((metric) => [metric, new Array<number>(days.length).fill(0)]),
  );
  for (const row of rows) {
    const series = counts.get(row.metric as ActivityMetric);
    const at = index.get(row.day);
    if (series === undefined || at === undefined) continue;
    series[at] = (series[at] ?? 0) + row.n;
  }
  return {
    generated_at: now.toISOString(),
    days,
    series: ACTIVITY_METRICS.map((metric) => {
      const values = counts.get(metric) ?? [];
      return {
        metric,
        group: GROUP_OF[metric],
        counts: values,
        total: values.reduce((sum, n) => sum + n, 0),
      };
    }),
  };
}
