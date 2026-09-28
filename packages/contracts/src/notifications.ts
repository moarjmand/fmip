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

/**
 * Match alerts (blueprint 12.2, T-830, D-098): raised by the live ingestion
 * when a followed team's or competition's match changes state. Kept as their
 * own list so the settings page can give them a section of their own and the
 * carrier can batch them per member. A disallowed goal is a `match_goal`
 * too -- its correction -- so the member who turned goals off hears neither.
 * In the order a match happens: team news days before (T-832), the line-ups
 * an hour before (T-832), then the match itself.
 */
export const MATCH_ALERT_KINDS = [
  // A player the provider says will miss the match (T-832, D-100).
  'match_availability',
  // Both line-ups announced (T-832, D-100).
  'match_lineups',
  'match_kickoff',
  'match_goal',
  'match_red_card',
  'match_half_time',
  'match_full_time',
] as const;

export type MatchAlertKind = (typeof MATCH_ALERT_KINDS)[number];

export function isMatchAlertKind(value: string): value is MatchAlertKind {
  return (MATCH_ALERT_KINDS as readonly string[]).includes(value);
}

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
  // A friend predicted a match the member follows or predicted (T-832, D-100).
  'friend_predicted',
  // The member's briefing was written (Phase 5, T-432).
  'briefing',
  // A message from the platform to an audience (T-332, D-075).
  'campaign',
  // A watchdog incident opened or closed, to administrators only (T-802, D-096).
  'system_alert',
  // Editorial (T-833, D-100): the founder published an analysis of a
  // followed match; a community analysis's review decided, to its author; a
  // member newly meets the contributor requirements, to administrators only.
  'founder_analysis_published',
  'analysis_reviewed',
  'contributor_eligible',
  // Match alerts (T-830, D-098).
  ...MATCH_ALERT_KINDS,
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
  // Opt-in (T-832, D-100): a friend's activity is not something the product
  // interrupts anybody with unless they asked.
  friend_predicted: false,
  // A member asked for it, so they hear that it exists; the inbox is where a
  // channel carries it from (T-432).
  briefing: true,
  // On, and a kind of its own so a member can turn campaigns off without
  // turning off what happens to their account (T-332).
  campaign: true,
  // On: an administrator who wants the pager off says so, and the inbox still
  // shows the condition on the System page either way (T-802).
  system_alert: true,
  // Editorial (T-833, D-100), all on: the founder writes a handful a week and
  // a follower of the match came for exactly that; an analyst who submitted
  // is waiting for the answer; an administrator who approves contributors is
  // the one person who must know somebody is waiting.
  founder_analysis_published: true,
  analysis_reviewed: true,
  contributor_eligible: true,
  // Team news and line-ups are opt-in (T-832, D-100): they arrive for every
  // followed match, most of them nobody is waiting on.
  match_availability: false,
  match_lineups: false,
  // Match alerts (D-098): the moments a follower wants without asking --
  // the start, every goal, the result -- are on; half-time and red cards,
  // which double the pushes of an ordinary match for news the next goal or
  // the result carries anyway, are for a member who asks.
  match_kickoff: true,
  match_goal: true,
  match_red_card: false,
  match_half_time: false,
  match_full_time: true,
};

/**
 * Kinds only an administrator can receive (T-802). They are left out of a
 * member's settings -- a switch for a thing that can never happen to you is
 * noise -- and only the watchdog's alert delivery emits them, to the holders
 * of the `admin` role.
 */
export const ADMIN_ONLY_NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'system_alert',
  // A member newly eligible for contributor review (T-833, D-100).
  'contributor_eligible',
];

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

/**
 * The one exception to `QUIET_HOURS_RULE`, argued for (T-802, D-096): an
 * administrator's system alert is the pager for an outage, and an outage at
 * two in the morning that waits until eight is six hours of a broken product
 * nobody was told about. The alert is still one per incident and per
 * recovery, never a stream, and an administrator who does not want it at
 * night turns the kind off, which the settings page offers like any other.
 */
export const QUIET_HOURS_EXEMPT: readonly NotificationKind[] = ['system_alert'];

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
  | 'briefing'
  /** A campaign (T-332): `subject_id` is the campaign, `subject_label` the path it opens, `headline` its title. */
  | 'campaign'
  /** A watchdog transition (T-802): `subject_id` is the `watchdog_event` id, `headline` what changed. */
  | 'watchdog_event'
  /**
   * The member's own community analysis of a match (T-833): `subject_id` is
   * the fixture, and it opens the draft rather than the match. A subject of
   * its own so a team mute never silences the answer to a submission.
   */
  | 'analysis_draft';

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
  /**
   * The subject's own words where it has them -- a campaign's title, a match
   * alert's line with the teams and the score (T-830) -- and null everywhere
   * else, where the kind's sentence is the line (T-332).
   */
  headline: string | null;
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
export const NOTIFICATION_CATEGORIES = ['football', 'social', 'account', 'match'] as const;
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
  friend_predicted: 'social',
  briefing: 'football',
  campaign: 'account',
  moderation_decision: 'account',
  contributor_granted: 'account',
  contributor_grant_changed: 'account',
  system_alert: 'account',
  founder_analysis_published: 'football',
  analysis_reviewed: 'account',
  contributor_eligible: 'account',
  // Their own category (T-830), so every match alert can be silenced as one
  // without silencing predictions and ratings.
  match_availability: 'match',
  match_lineups: 'match',
  match_kickoff: 'match',
  match_goal: 'match',
  match_red_card: 'match',
  match_half_time: 'match',
  match_full_time: 'match',
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

/**
 * What each kind says, in the member's own terms: one table for the inbox,
 * an e-mail and a push (T-272, T-330), so a notification reads the same
 * wherever it reaches them. Keyed by the union, so a kind added without
 * words does not compile. `named` says whether the sentence takes a
 * member's name in front of it, and it is a field rather than something
 * inferred from capitalisation: inference would work until somebody
 * rephrased one, and then it would be wrong silently. The kinds with
 * `named: false` are exactly the ones emitted with no source on purpose
 * (T-271) -- a moderation decision and a contributor change belong to the
 * platform, not to a person.
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
  // Never what they predicted: that the friend predicted is all this says,
  // and their own visibility decides whether it is sent at all (T-832, D-100).
  friend_predicted: { text: 'predicted a match you follow or predicted.', named: true },
  briefing: { text: 'Your briefing was written.', named: false },
  campaign: { text: 'A message from the platform.', named: false },
  system_alert: { text: 'The watchdog raised or cleared a system alert.', named: false },
  founder_analysis_published: {
    text: 'The founder published an analysis of a match you follow.',
    named: false,
  },
  analysis_reviewed: { text: 'Your analysis was reviewed.', named: false },
  // The fallback only: the line names the member (T-833).
  contributor_eligible: {
    text: 'A member now meets the contributor requirements.',
    named: false,
  },
  // The fallback only: a match alert's line is its headline, written when the
  // event was seen, with the teams and the score (T-830).
  match_availability: { text: 'Team news for a match you follow.', named: false },
  match_lineups: { text: 'The line-ups are in for a match you follow.', named: false },
  match_kickoff: { text: 'A match you follow kicked off.', named: false },
  match_goal: { text: 'A goal in a match you follow.', named: false },
  match_red_card: { text: 'A red card in a match you follow.', named: false },
  match_half_time: { text: 'Half-time in a match you follow.', named: false },
  match_full_time: { text: 'Full-time in a match you follow.', named: false },
};

/**
 * The whole line, name included when there is one. A `named` kind whose
 * source did not resolve falls back to "Somebody" rather than rendering a
 * gap: an account can be deleted after it caused something, and a sentence
 * starting with a space is worse than an honest indefinite (rule 3).
 */
export function notificationLine(
  notification: Pick<Notification, 'kind' | 'source'> & { headline?: string | null },
): string {
  if (notification.headline !== undefined && notification.headline !== null) {
    return notification.headline;
  }
  const entry = NOTIFICATION_TEXT[notification.kind];
  if (!entry.named) return entry.text;
  return `${notification.source ?? 'Somebody'} ${entry.text}`;
}

/**
 * The section of the match page a fixture notification opens, by kind; the
 * page's regions carry these ids (`match-centre-view.tsx`). A kind not listed
 * opens the top of the match.
 */
const FIXTURE_ANCHOR: Partial<Record<string, string>> = {
  match_availability: '#lineups',
  match_lineups: '#lineups',
  // The founder's analysis region (T-833).
  founder_analysis_published: '#analysis',
};

/**
 * The route a notification opens, under a locale and relative to the web
 * origin (T-272), shared so that an e-mail and a push open exactly what the
 * inbox opens (T-330). This is the only place that knows a profile lives at
 * `/u/{username}` and a group at `/groups/{slug}`.
 *
 * `null` when it cannot be opened, which is a real state rather than a
 * failure: a group that was deleted still has a notification about it, and
 * the API sends no label for it. A link that 404s is worse than none, so a
 * caller renders the sentence without one (rule 3).
 */
export function notificationPath(
  locale: string,
  notification: Pick<Notification, 'subject_type' | 'subject_id' | 'subject_label'> & {
    kind?: string;
  },
): string | null {
  const { subject_type: type, subject_id: id, subject_label: label } = notification;
  switch (type) {
    case 'fixture':
      // A kind about one part of the match opens that part (T-832).
      return `/${locale}/match/${id}${FIXTURE_ANCHOR[notification.kind ?? ''] ?? ''}`;
    case 'member':
      // A member waiting for contributor review opens the queue it is in,
      // where the four requirements and the decision are (T-833).
      if (notification.kind === 'contributor_eligible') return `/${locale}/admin/contributors`;
      return label === null ? null : `/${locale}/u/${encodeURIComponent(label)}`;
    case 'group':
      return label === null ? null : `/${locale}/groups/${encodeURIComponent(label)}`;
    case 'conversation':
    case 'message':
      // A message opens the conversation it is in; there is no per-message
      // route, and an anchor the page does not implement would land in the
      // right room and then do nothing.
      return `/${locale}/messages/${id}`;
    case 'panel_post':
      // The panel hangs off the match and `subject_id` is the post; until the
      // panel has a per-post anchor there is nothing more precise to open.
      return null;
    case 'prediction':
      return `/${locale}/predictions`;
    case 'sanction':
      // A member's own standing, which is where an appeal starts.
      return `/${locale}/settings`;
    case 'briefing':
      // The briefing lives on the Following page, above the feed it was
      // written from (T-432).
      return `/${locale}/following#briefing`;
    case 'analysis_draft':
      // The analyst's own editor, where the decision and its reason sit
      // beside the draft (T-262, T-833).
      return `/${locale}/analyses/${id}`;
    case 'watchdog_event':
      // The System page, where the conditions and incidents are (T-802, T-804).
      return `/${locale}/admin/system`;
    case 'campaign':
      // The campaign chose its own in-app path (T-332); one that is not a
      // path opens nothing rather than somewhere else.
      return label !== null && label.startsWith('/') && !label.startsWith('//')
        ? `/${locale}${label}`
        : null;
    default:
      return null;
  }
}

/**
 * `GET /me/push` (T-330, D-074): whether this deployment can push to a
 * device, the public key a browser subscribes with when it can, how many
 * devices this member has registered, and whether e-mail is there too (so
 * the settings page can say where a notification reaches them).
 */
export type PushState =
  | { state: 'absent'; email: boolean; devices: number }
  | { state: 'configured'; public_key: string; email: boolean; devices: number };

/** `POST /me/push-subscriptions`: what the browser's push manager hands out, as it serialises it. */
export interface PushSubscriptionRequest {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** `DELETE /me/push-subscriptions`. */
export interface PushUnsubscribeRequest {
  endpoint: string;
}
