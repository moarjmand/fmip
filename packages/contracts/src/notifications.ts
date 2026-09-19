import type { DeliveryHealth } from './health';
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
  // The member's briefing was written (Phase 5, T-432).
  'briefing',
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
  // A member asked for it, so they hear that it exists; the inbox is where a
  // channel carries it from (T-432).
  briefing: true,
};

/**
 * How many of one kind a member is told about in an hour (T-273).
 *
 * **Absent means uncapped**, and most kinds are. A cap is for a thing that can
 * happen to you faster than you can care about it, and there are only two:
 * messages, which a busy conversation produces one per line, and panel
 * reactions, which a public post can collect dozens of in an evening.
 *
 * Everything else happens at human speed. A cap on `moderation_decision` would
 * be a number deciding a member should not hear about the second thing done to
 * their account.
 *
 * Over the ceiling the notification is **not written**, and the newest one of
 * that kind says how many were held behind it. A row per suppressed event would
 * be the flood again with a note attached.
 */
export const NOTIFICATION_HOURLY_CAP: Partial<Record<NotificationKind, number>> = {
  message_received: 10,
  panel_reaction: 5,
};

/**
 * What quiet hours do to each kind (T-273).
 *
 * **Everything waits, and nothing is thrown away.** The criterion asks for
 * "delayed or dropped by rule, and says which", and the rule this product
 * chooses is that quiet hours are about *when* somebody is disturbed, never
 * about whether they are told. Dropping a moderation decision because it landed
 * at two in the morning would be the product deciding a member did not need to
 * know.
 *
 * Dropping is what the **frequency cap** does, and it is a different judgement:
 * the tenth message notification in an hour tells a member nothing the ninth
 * did not.
 *
 * This constant exists so that the rule is written down where somebody looking
 * for an exception will find the argument against one, rather than discovering
 * there is no mechanism and adding it in the wrong place.
 */
export const QUIET_HOURS_RULE = 'delay' as const;

/** What a notification points at, so the inbox can open it (T-272). */
export type NotificationSubject =
  | 'fixture'
  | 'member'
  | 'group'
  | 'conversation'
  | 'message'
  | 'panel_post'
  | 'prediction'
  | 'sanction'
  /** The member's own briefing (T-432): `subject_id` is the `member_briefing` row. */
  | 'briefing';

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
  /**
   * Whether anything here can also leave the product (T-330). With no
   * provider it is `in_product_only`, and the inbox says so: a member who
   * expects an e-mail must be told none is coming.
   */
  delivery: DeliveryHealth;
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

/**
 * The categories a member can silence as one (blueprint 12.2, T-331). Every
 * kind is in exactly one; the test that says so is what keeps a new kind
 * from arriving in no category and being impossible to silence with its
 * neighbours.
 */
export const NOTIFICATION_CATEGORIES = ['football', 'social', 'account'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_OF: Record<NotificationKind, NotificationCategory> = {
  prediction_settled: 'football',
  rating_changed: 'football',
  career_points_awarded: 'football',
  friend_request: 'social',
  friend_accepted: 'social',
  message_received: 'social',
  mentioned: 'social',
  group_invite: 'social',
  group_join_request: 'social',
  panel_reaction: 'social',
  briefing: 'football',
  moderation_decision: 'account',
  contributor_granted: 'account',
  contributor_grant_changed: 'account',
};

export const MUTE_SCOPES = ['team', 'competition', 'category'] as const;
export type MuteScope = (typeof MUTE_SCOPES)[number];

/**
 * One thing a member chose not to hear about (T-331): a team or a
 * competition by id, or a category of kinds. A team mute silences what is
 * about that team's matches and nothing else -- a member can silence one
 * team without silencing football.
 */
export interface NotificationMute {
  scope: MuteScope;
  /** A team or competition id, or a category name. */
  target: string;
  /** The team's or competition's name; `null` for a category, which the page names itself. */
  label: string | null;
  created_at: string;
}

/** `GET /me/notification-settings`. */
export interface NotificationSettings {
  preferences: NotificationPreference[];
  /** Null when the member has set none. */
  quiet_hours: QuietHours | null;
  /** The timezone the quiet hours are read in (T-040). */
  timezone: string;
  /** What the member silenced (T-331); `PUT`/`DELETE /me/notification-mutes/:scope/:target`. */
  mutes: NotificationMute[];
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
