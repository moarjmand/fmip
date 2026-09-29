/**
 * Groups (blueprint 8.2, and the exclusive groups of 10.1, T-240).
 *
 * The exclusive groups are not a second shape here either: they are invite-only
 * groups whose invitations are issued under a privilege the founder grants. One
 * set of membership rules, one contract.
 */

/**
 * Three, because the middle one is the case a boolean would lose.
 *
 * - `public` — found, read and joined by anyone.
 * - `discoverable` — **found but not read.** The name and the description are
 *   public; the membership and whatever is said inside are not. This is what
 *   lets somebody ask to join without membership being public information.
 * - `invite_only` — not found at all. Nothing to ask for.
 */
export const GROUP_VISIBILITIES = ['public', 'discoverable', 'invite_only'] as const;
export type GroupVisibility = (typeof GROUP_VISIBILITIES)[number];

/**
 * Exactly one owner, any number of moderators, and everybody else.
 *
 * The one-owner rule is the schema's, not this list's: a unique index for "at
 * most one" and a deferred constraint for "at least one", so handing ownership
 * over is one transaction rather than a moment with nobody in charge.
 */
export const GROUP_ROLES = ['owner', 'moderator', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/**
 * Who may invite to a group (T-1020, D-132): the owner alone, the owner and
 * the moderators, or every member. The owner sets it. The default is
 * `owner_and_moderators`, which is what every group did before there was a
 * choice. The schema refuses an invitation the policy does not allow.
 */
export const GROUP_INVITE_POLICIES = ['owner', 'owner_and_moderators', 'members'] as const;
export type GroupInvitePolicy = (typeof GROUP_INVITE_POLICIES)[number];

/**
 * Where a viewer stands with a group — one closed set, so every surface that
 * renders a group has to say what it offers in each case.
 *
 * `may_join`, `may_ask` and `invite_only` are the three ways in, and they follow
 * from the visibility rather than from a second setting: you join a public
 * group, you ask a discoverable one, and an invite-only one asks you.
 *
 * `unavailable` deliberately does not say why. A member under a sanction is
 * told by the moderation surface that owns that conversation, not by every
 * group page they open.
 */
export const GROUP_STANDINGS = [
  'owner',
  'moderator',
  'member',
  'invited',
  'requested',
  'may_join',
  'may_ask',
  'invite_only',
  'unavailable',
] as const;
export type GroupStanding = (typeof GROUP_STANDINGS)[number];

export const MAX_GROUP_NAME = 60;
export const MIN_GROUP_NAME = 2;
export const MAX_GROUP_DESCRIPTION = 500;
export const MAX_JOIN_NOTE = 300;
/** The handle in a URL, the way a username is. Lower-case, and never changed. */
export const GROUP_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

/** What a directory row shows. Nothing here is private to the membership. */
export interface GroupSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: GroupVisibility;
  /**
   * How many members. Public even for a discoverable group: a count says how
   * busy a place is without saying who is in it, which is the distinction the
   * middle visibility exists to draw.
   */
  member_count: number;
  created_at: string;
}

export interface GroupMember {
  username: string;
  display_name: string;
  role: GroupRole;
  joined_at: string;
}

export interface Group extends GroupSummary {
  standing: GroupStanding;
  /**
   * The group's conversation, or `null` when the viewer may not open it.
   *
   * Every group has one. What varies is whether this viewer is in the group,
   * and a conversation id they cannot use would be an invitation to a 404.
   */
  conversation_id: string | null;
  /**
   * The membership, or `null` when the viewer may not see it — a
   * discoverable-private group is found, not read.
   *
   * Never an empty array. A group always has an owner, so `[]` could only ever
   * be a bug wearing the shape of a fact (rule 3).
   */
  members: GroupMember[] | null;
  /** What is waiting for an owner or a moderator; `null` for everybody else. */
  pending: { invites: number; requests: number } | null;
  /** Who may invite (T-1020); the owner changes it. */
  invite_policy: GroupInvitePolicy;
  /** Whether this viewer may invite under that policy. */
  may_invite: boolean;
}

/** An invitation as the invited member sees it. */
export interface GroupInvite {
  group: GroupSummary;
  /** The username of whoever sent it. */
  invited_by: string;
  created_at: string;
}

/** Somebody asking to join, as an owner or moderator sees it. */
export interface GroupJoinRequest {
  username: string;
  display_name: string;
  note: string | null;
  created_at: string;
}

export interface GroupsResponse {
  groups: GroupSummary[];
}

export interface GroupResponse {
  group: Group;
}

export interface GroupInvitesResponse {
  invites: GroupInvite[];
}

export interface GroupJoinRequestsResponse {
  requests: GroupJoinRequest[];
}

export interface CreateGroupRequest {
  slug: string;
  name: string;
  description?: string | null;
  visibility: GroupVisibility;
}

/**
 * Everything a group can be changed to. The slug is not here: a group link is
 * shared into conversations, and a renamed slug would break every share
 * silently, so the database refuses the change (SQLSTATE `PL008`).
 */
export interface UpdateGroupRequest {
  name?: string;
  description?: string | null;
  visibility?: GroupVisibility;
}

export interface JoinGroupRequest {
  /** A sentence to whoever decides. Optional, and never required to be read. */
  note?: string | null;
}

export interface SetGroupRoleRequest {
  role: GroupRole;
}

/** `PUT /groups/:slug/invite-policy`, the owner only (T-1020). */
export interface SetGroupInvitePolicyRequest {
  invite_policy: GroupInvitePolicy;
}

/**
 * One change to a group's settings, as its owner and moderators read it
 * (`GET /groups/:slug/history`, T-1020): who, when, why, and the value before
 * and after. Read from the audit log, which nothing edits (rule 10).
 */
export interface GroupHistoryEntry {
  /** `user_group.invite_policy`, ... : a dotted noun.verb. */
  action: string;
  /** The username of whoever did it; null once their account is gone. */
  actor: string | null;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  created_at: string;
}

export interface GroupHistoryResponse {
  history: GroupHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Invite links (T-1021, D-132). Whoever the invite policy lets invite makes
// one, with an expiry and a use cap, and may revoke it. Only the token's hash
// is stored: the token is shown once, in the answer to making it.
// ---------------------------------------------------------------------------

/** Hours a link lasts: a week unless its maker says otherwise, at most thirty days. */
export const INVITE_LINK_DEFAULT_HOURS = 7 * 24;
export const INVITE_LINK_MIN_HOURS = 1;
export const INVITE_LINK_MAX_HOURS = 30 * 24;
/** How many people a link lets in (or lets ask, for a discoverable group). */
export const INVITE_LINK_DEFAULT_USES = 25;
export const INVITE_LINK_MAX_USES = 500;

/**
 * Where a link stands. `orphaned`: whoever made it may no longer invite (they
 * left, were demoted, or the policy changed), because the policy applies when
 * a link is followed, not only when it was made.
 */
export const INVITE_LINK_STATES = ['live', 'revoked', 'expired', 'exhausted', 'orphaned'] as const;
export type InviteLinkState = (typeof INVITE_LINK_STATES)[number];

/** A link as the people who may manage it see it. Never its token. */
export interface GroupInviteLink {
  id: string;
  /** The maker's username; null once their account is gone. */
  created_by: string | null;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
  state: InviteLinkState;
}

/**
 * The answer to making a link: the one time its token exists outside the
 * holder's hands. The web page is `/{locale}/group-invite/{token}`.
 */
export interface CreatedGroupInviteLink extends GroupInviteLink {
  token: string;
}

export interface CreateGroupInviteLinkRequest {
  /** From now, whole hours; `INVITE_LINK_DEFAULT_HOURS` when absent. */
  expires_in_hours?: number;
  /** `INVITE_LINK_DEFAULT_USES` when absent. */
  max_uses?: number;
}

export interface GroupInviteLinkResponse {
  link: CreatedGroupInviteLink;
}

export interface GroupInviteLinksResponse {
  links: GroupInviteLink[];
}

/**
 * `GET /group-invite-links/:token`: what following it would do. A dead link
 * says which (`state`); a dead link to an invite-only group is 404 instead,
 * because the group is not findable and a dead link no longer invites.
 */
export interface InviteLinkPreview {
  group: GroupSummary;
  state: InviteLinkState;
  /** `join` for a public or invite-only group, `ask` for a discoverable one. */
  follow: 'join' | 'ask';
  /** The viewer is already in the group. */
  member: boolean;
}

export interface InviteLinkPreviewResponse {
  preview: InviteLinkPreview;
}

/** `POST /group-invite-links/:token`: what following it did. */
export interface FollowInviteLinkResponse {
  outcome: 'joined' | 'requested';
  group: GroupSummary;
}

// ---------------------------------------------------------------------------
// Group polls (blueprint 8.2, T-643, D-091). A member's question to their
// group, answered as counts. Never a prediction product (rule 6): a poll is
// not a forecast, a consensus or an analysis, and nothing reads it as one.
// ---------------------------------------------------------------------------

export const MAX_POLL_QUESTION = 200;
export const MAX_POLL_OPTION = 80;
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 6;
/** How long a poll stays open, in hours: 7 days unless the creator says otherwise. */
export const POLL_DEFAULT_HOURS = 7 * 24;
export const POLL_MIN_HOURS = 1;
export const POLL_MAX_HOURS = 30 * 24;
/** Open polls one group may hold at once. */
export const MAX_OPEN_POLLS = 3;
export const MAX_POLL_REMOVAL_REASON = 500;

export interface GroupPollOption {
  id: string;
  label: string;
  /** How many members chose it; null while the viewer may not see results. */
  votes: number | null;
}

/**
 * One poll as a member of its group sees it. **Who voted is never here**: the
 * results are counts only, and they are shown to a member who has voted, or to
 * everybody in the group once the poll is closed.
 */
export interface GroupPoll {
  id: string;
  question: string;
  /** In the creator's order. */
  options: GroupPollOption[];
  /** The creator's username; null once their account is gone. */
  created_by: string | null;
  created_at: string;
  /** When it closes, or would have closed, by its own clock. */
  closes_at: string;
  /** Set when it was closed early. */
  closed_at: string | null;
  status: 'open' | 'closed';
  /** The option the viewer chose, or null. */
  my_vote: string | null;
  /** Every vote cast; null while the viewer may not see results. */
  total_votes: number | null;
  /** The creator, or the group's owner, while it is open. */
  may_close: boolean;
  /** The group's owner or a moderator. */
  may_remove: boolean;
}

/** `GET /groups/:slug/polls`: open polls first (closing soonest first), then the latest closed. */
export interface GroupPollsResponse {
  polls: GroupPoll[];
}

export interface GroupPollResponse {
  poll: GroupPoll;
}

export interface CreateGroupPollRequest {
  question: string;
  options: string[];
  /** From now, whole hours; `POLL_DEFAULT_HOURS` when absent. */
  closes_in_hours?: number;
}

export interface GroupPollVoteRequest {
  option_id: string;
}

/** Removing a poll is a moderation action, so it carries a reason (rule 10). */
export interface RemoveGroupPollRequest {
  reason: string;
}
