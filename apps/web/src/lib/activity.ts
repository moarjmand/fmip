import type {
  ActivityGroup,
  ActivityMetric,
  ActivityReport,
  ActivitySeries,
} from '@fmip/contracts';

/**
 * The Activity page's words and arithmetic (T-807), pure so the spec can hold
 * them. Every figure is a count the API summed; nothing here can name a
 * member, because nothing the page receives does.
 */

/** Each count in words, and what exactly is counted. */
export const METRIC_WORDS: Record<ActivityMetric, { label: string; counts: string }> = {
  registrations: { label: 'Registrations', counts: 'accounts created' },
  verifications: {
    label: 'Verified accounts',
    counts: 'e-mail addresses confirmed (a deleted account’s goes with its address)',
  },
  sign_ins: {
    label: 'Sign-ins',
    counts: 'sessions started (a deleted account’s go with it)',
  },
  active_members: {
    label: 'Active members',
    counts: 'distinct members who signed in or submitted a prediction that day',
  },
  deletions: { label: 'Accounts deleted', counts: 'accounts deleted by their member' },
  predictions: { label: 'Predictions', counts: 'new predictions submitted' },
  prediction_changes: {
    label: 'Prediction changes',
    counts: 'later versions of a prediction before kick-off',
  },
  settlements: { label: 'Settlements', counts: 'predictions settled or voided' },
  rating_snapshots: { label: 'Rating snapshots', counts: 'performance ratings recomputed' },
  direct_messages: { label: 'Direct messages', counts: 'messages between two members' },
  group_messages: { label: 'Group posts', counts: 'messages in groups and their match threads' },
  panel_posts: { label: 'Match panel posts', counts: 'posts on featured-match panels' },
  group_polls: { label: 'Group polls', counts: 'polls opened in groups' },
  reports: { label: 'Reports', counts: 'reports filed by members' },
  notifications: { label: 'Notifications', counts: 'written to members’ inboxes' },
  push_sent: { label: 'Push sent', counts: 'Web Push deliveries accepted' },
  push_failed: { label: 'Push failed', counts: 'Web Push deliveries refused or erroring' },
  email_sent: { label: 'E-mail sent', counts: 'notification e-mails accepted' },
  email_failed: { label: 'E-mail failed', counts: 'notification e-mails refused or erroring' },
};

export const GROUP_WORDS: Record<ActivityGroup, string> = {
  members: 'Members',
  predictions: 'Predictions',
  conversation: 'Conversation',
  notifications: 'Notifications',
};

const GROUP_ORDER: ActivityGroup[] = ['members', 'predictions', 'conversation', 'notifications'];

/** The series by section, in the page's order; a section with no series is left out. */
export function bySection(
  report: ActivityReport,
): { group: ActivityGroup; series: ActivitySeries[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    series: report.series.filter((s) => s.group === group),
  })).filter((section) => section.series.length > 0);
}

/** The sum of the newest `n` days (the last `n` entries). */
export function lastDays(counts: readonly number[], n: number): number {
  return counts.slice(Math.max(0, counts.length - n)).reduce((sum, c) => sum + c, 0);
}

/** `true` when the API answered and every count in the window is zero. */
export function nothingRecorded(report: ActivityReport): boolean {
  return report.series.every((s) => s.total === 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-28` as "28 Sep", without the browser's time zone moving it a day. */
export function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return day;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? day : `${String(Number(match[3]))} ${month}`;
}
