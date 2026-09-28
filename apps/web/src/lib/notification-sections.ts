import type { NotificationKind } from '@fmip/contracts';

/**
 * The kinds Settings → Notifications gives a section of their own, worded
 * through the catalogues rather than the general list's English labels
 * (T-832). The match alerts have theirs already (`MATCH_ALERT_KINDS`, T-831).
 * Plain data, so the client list and the server sections can both read it.
 */
export const FRIEND_ALERT_KINDS = [
  'friend_predicted',
] as const satisfies readonly NotificationKind[];

/** Editorial (T-833): the founder's analysis, a review decided, and (administrators only) a member waiting for review. */
export const EDITORIAL_KINDS = [
  'founder_analysis_published',
  'analysis_reviewed',
  'contributor_eligible',
] as const satisfies readonly NotificationKind[];

export const SECTIONED_KINDS = [...FRIEND_ALERT_KINDS, ...EDITORIAL_KINDS] as const;

export type SectionedKind = (typeof SECTIONED_KINDS)[number];

export function isSectionedKind(kind: string): kind is SectionedKind {
  return (SECTIONED_KINDS as readonly string[]).includes(kind);
}
