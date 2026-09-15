/**
 * In-product notifications (blueprint 12.2, T-270).
 *
 * **A notification is a consequence, not a feature.** Every kind below is
 * already an event somewhere else in the product, so this epic subscribes
 * rather than invents — and a kind that needed new code to be noticed would be
 * a sign the event itself was not recorded properly.
 *
 * The one decision these types carry is where the defaults live: **here, in
 * code, and nowhere else.** The acceptance criterion is that a missing
 * preference row means the documented default, which is only true while the
 * document and the code are the same thing.
 */

/** Every kind that can be emitted. Closed, and shared with the schema's CHECK. */
export const NOTIFICATION_KINDS = [
  'prediction_settled',
  'rating_changed',
  'career_points_awarded',
  'friend_request',
  'friend_accepted',
  'message_received',
  'mentioned',
  'group_invite',
  'group_join_request',
  'moderation_decision',
  'contributor_granted',
  'contributor_grant_changed',
  'panel_reaction',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/**
 * What a member gets if they never choose.
 *
 * **Off by default is the exception and it is argued for, not assumed.** Two
 * kinds are off: `panel_reaction`, because a public panel can produce dozens an
 * evening and none of them needs answering, and `career_points_awarded`,
 * because points follow every settled prediction and a member who wanted that
 * stream already has `prediction_settled`.
 *
 * Everything else is on, including `moderation_decision` — a member must be
 * told what was decided about them, and a default that hid it would be the
 * product deciding not to explain itself.
 */
export const NOTIFICATION_DEFAULTS: Record<NotificationKind, boolean> = {
  prediction_settled: true,
  rating_changed: true,
  career_points_awarded: false,
  friend_request: true,
  friend_accepted: true,
  message_received: true,
  mentioned: true,
  group_invite: true,
  group_join_request: true,
  moderation_decision: true,
  contributor_granted: true,
  contributor_grant_changed: true,
  panel_reaction: false,
};

/** What a notification points at, so the inbox can open it (T-272). */
export type NotificationSubject =
  | 'fixture'
  | 'member'
  | 'group'
  | 'conversation'
  | 'message'
  | 'panel_post'
  | 'prediction'
  | 'sanction';

/**
 * One notification, as its recipient sees it.
 *
 * `subject_type` and `subject_id` are the deep link and are always present: a
 * notification that cannot open the thing it is about is a sentence, and an
 * inbox full of sentences is a worse version of an email folder.
 */
export interface Notification {
  id: string;
  kind: NotificationKind;
  subject_type: NotificationSubject;
  subject_id: string;
  /**
   * The handle the subject is addressed by, when it has one that differs from
   * its id (T-272).
   *
   * A member's profile lives at `/u/{username}` and a group's page at
   * `/groups/{slug}` — both keyed by a handle, while `subject_id` is the
   * canonical UUID (rule 1). So the pair alone could not open two of the four
   * things blueprint 12.2 promises, and this is what closes the gap without
   * making a name the key.
   *
   * Null when the subject is addressed by its id (a fixture), and null when the
   * subject no longer resolves — a group that was deleted. A client with no
   * label renders the notification without a link rather than a broken one,
   * because a link that 404s is worse than none (rule 3).
   */
  subject_label: string | null;
  /** Who caused it. Null for an event with no member behind it, like a settlement. */
  source: string | null;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601, or null while unread. */
  read_at: string | null;
  /**
   * Why it was held back, when it was (T-273). Null for one that was not.
   *
   * Shown rather than swallowed: a frequency cap or a quiet-hours delay that
   * left no trace would make the inbox quietly incomplete, which is rule 3 at
   * the smallest scale the product has.
   */
  held_reason: string | null;
}

/** `GET /me/notifications`. */
export interface NotificationsResponse {
  notifications: Notification[];
  /** Unread across the whole inbox, not just this page. */
  unread: number;
  /** ISO 8601, when this page was assembled. */
  generated_at: string;
}

/**
 * One member's notification settings.
 *
 * Every kind appears, with the value in force — the default where they have not
 * chosen, and their own where they have. A surface that received only the
 * departures would have to know the defaults too, which is how a second copy of
 * them gets written.
 */
export interface NotificationPreference {
  kind: NotificationKind;
  in_product: boolean;
  /** False when this is the documented default rather than their own choice. */
  chosen: boolean;
}

/** When a member does not want to be notified, in their own timezone. */
export interface QuietHours {
  /** `HH:MM`, local to the member. */
  starts_at: string;
  ends_at: string;
}

/** `GET /me/notification-settings`. */
export interface NotificationSettings {
  preferences: NotificationPreference[];
  /** Null when the member has set none. */
  quiet_hours: QuietHours | null;
  /** The timezone the quiet hours are read in (T-040). */
  timezone: string;
}

/** `PUT /me/notification-settings/:kind`. */
export interface SetNotificationPreferenceRequest {
  in_product: boolean;
}

/** `PUT /me/quiet-hours`. `DELETE` on the same path clears them. */
export interface SetQuietHoursRequest {
  /** `HH:MM`. `starts_at` after `ends_at` means the window wraps midnight, which is ordinary. */
  starts_at: string;
  ends_at: string;
}
