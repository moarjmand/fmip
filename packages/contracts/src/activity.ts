/**
 * Activity counts for the admin console (T-807, blueprint 19): how many of
 * each thing happened per UTC day, counted from rows the product already
 * stores for its own purposes. Aggregates only: nothing names a member, no
 * series is per member, and nothing new is recorded about anyone to produce
 * these numbers.
 *
 * `GET /admin/activity?days=` answers `ActivityReport` (admin role only).
 */

export const ACTIVITY_DEFAULT_DAYS = 30;
export const ACTIVITY_MAX_DAYS = 90;

/** Every count on the page, in the order the page shows them. */
export const ACTIVITY_METRICS = [
  // Members
  'registrations',
  'verifications',
  'sign_ins',
  'active_members',
  'deletions',
  // Predictions
  'predictions',
  'prediction_changes',
  'settlements',
  'rating_snapshots',
  // Conversation
  'direct_messages',
  'group_messages',
  'panel_posts',
  'group_polls',
  'reports',
  // Notifications
  'notifications',
  'push_sent',
  'push_failed',
  'email_sent',
  'email_failed',
] as const;

export type ActivityMetric = (typeof ACTIVITY_METRICS)[number];

/** The section of the page a metric belongs to. */
export type ActivityGroup = 'members' | 'predictions' | 'conversation' | 'notifications';

/** One metric across the report's days. */
export interface ActivitySeries {
  metric: ActivityMetric;
  group: ActivityGroup;
  /** One count per entry of `ActivityReport.days`, oldest first; a day with none is 0. */
  counts: number[];
  /** The sum of `counts`. For `active_members` it is a sum of daily figures, not distinct members. */
  total: number;
}

export interface ActivityReport {
  generated_at: string;
  /** UTC calendar days, `YYYY-MM-DD`, oldest first; the last is today (partial). */
  days: string[];
  series: ActivitySeries[];
}
