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
   * The membership, or `null` when the viewer may not see it — a
   * discoverable-private group is found, not read.
   *
   * Never an empty array. A group always has an owner, so `[]` could only ever
   * be a bug wearing the shape of a fact (rule 3).
   */
  members: GroupMember[] | null;
  /** What is waiting for an owner or a moderator; `null` for everybody else. */
  pending: { invites: number; requests: number } | null;
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
