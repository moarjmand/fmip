import type { Notification, NotificationKind } from '@fmip/contracts';

/**
 * Turning a notification into a route (T-272).
 *
 * **The API sends a pair of identifiers and the client builds the URL.** A URL
 * built in the API would put this routing table in the API, and Phase 4's second
 * client (E32) would have to either accept the web's routes or ignore the field.
 *
 * So this file is the routing table, and it is the only place that knows a
 * profile lives at `/u/{username}` and a group at `/groups/{slug}`.
 */

/**
 * `null` when the notification cannot be opened, which is a real state rather
 * than a failure: a group that was deleted still has a notification about it,
 * and the API sends no label for it. **A link that 404s is worse than none**, so
 * the caller renders the notification without one and the member reads what
 * happened instead of being sent somewhere that no longer exists (rule 3).
 */
export function notificationHref(locale: string, notification: Notification): string | null {
  const { subject_type: type, subject_id: id, subject_label: label } = notification;
  switch (type) {
    case 'fixture':
      // Addressed by its id, so there is nothing to resolve and nothing to lose.
      return `/${locale}/match/${id}`;
    case 'member':
      return label === null ? null : `/${locale}/u/${encodeURIComponent(label)}`;
    case 'group':
      return label === null ? null : `/${locale}/groups/${encodeURIComponent(label)}`;
    case 'conversation':
    case 'message':
      // A message opens the conversation it is in; there is no per-message
      // route and inventing an anchor the page does not implement would be a
      // link that lands in the right room and then does nothing.
      return `/${locale}/messages/${id}`;
    case 'panel_post':
      // The panel hangs off the match, and `subject_id` here is the post. Until
      // the panel has a per-post anchor there is nothing more precise to point
      // at than the member's own inbox entry, so this opens nothing rather than
      // opening the wrong match.
      return null;
    case 'prediction':
      return `/${locale}/predictions`;
    case 'sanction':
      // A member's own standing, which is where an appeal starts.
      return `/${locale}/settings`;
    default:
      return null;
  }
}

/**
 * What the notification says, in the member's own terms.
 *
 * One entry per kind, keyed by the contract's union — so a kind added without
 * words for it does not compile, the same guard the panel's refusals use. A
 * notification with no sentence is a row in a table.
 *
 * `named` says whether the sentence takes a member's name in front of it, and
 * it is a field rather than something inferred from the wording: deriving it
 * from capitalisation would work until somebody rephrased one, and then it
 * would be wrong silently. The kinds with `named: false` are exactly the ones
 * emitted with no source on purpose (T-271) — a moderation decision and a
 * contributor change belong to the platform, not to a person.
 */
export const NOTIFICATION_TEXT: Record<NotificationKind, { text: string; named: boolean }> = {
  prediction_settled: { text: 'A prediction of yours was settled.', named: false },
  rating_changed: { text: 'Your Performance Rating changed.', named: false },
  career_points_awarded: { text: 'You earned Career Points.', named: false },
  friend_request: { text: 'sent you a friend request.', named: true },
  friend_accepted: { text: 'accepted your friend request.', named: true },
  message_received: { text: 'sent you a message.', named: true },
  mentioned: { text: 'mentioned you.', named: true },
  group_invite: { text: 'invited you to a group.', named: true },
  group_join_request: { text: 'asked to join a group you run.', named: true },
  moderation_decision: {
    text: 'A moderation decision was made about your account.',
    named: false,
  },
  contributor_granted: { text: 'You were approved as a contributor.', named: false },
  contributor_grant_changed: { text: 'Your contributor approval changed.', named: false },
  panel_reaction: { text: 'reacted to something you posted.', named: true },
};

/**
 * The whole line, name included when there is one.
 *
 * A `named` kind whose source did not resolve falls back to "Somebody" rather
 * than rendering a gap: an account can be deleted after it caused something,
 * and a sentence starting with a space is worse than an honest indefinite
 * (rule 3).
 */
export function notificationLine(notification: Notification): string {
  const entry = NOTIFICATION_TEXT[notification.kind];
  if (!entry.named) return entry.text;
  return `${notification.source ?? 'Somebody'} ${entry.text}`;
}
