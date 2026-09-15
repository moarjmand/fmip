/**
 * Reacting to a panel post, and following a contributor (blueprint 10.2,
 * T-252).
 *
 * **Both are open to any member, and neither is a way to post.** That is the
 * acceptance criterion and it is a property of these types as much as of the
 * endpoints: a reaction is one of six named values and a follow carries nothing
 * at all, so there is nowhere in either shape to put a sentence. A `note` field
 * on a follow, or a free `emoji` string, would be a small posting surface
 * attached to a panel the member was not approved for.
 */

/**
 * The six, and only the six — the same set a conversation uses (T-225).
 *
 * A member who learned what these mean in a group should not meet a different
 * vocabulary on a match panel.
 */
export const PANEL_REACTIONS = [
  'agree',
  'disagree',
  'laugh',
  'surprise',
  'sad',
  'celebrate',
] as const;

export type PanelReaction = (typeof PANEL_REACTIONS)[number];

export function isPanelReaction(value: string): value is PanelReaction {
  return (PANEL_REACTIONS as readonly string[]).includes(value);
}

/**
 * How a post's reactions are reported: a count per kind, and nothing about the
 * viewer.
 *
 * **There is deliberately no `mine` here.** The panel is a public document,
 * fetched without a session so that it is the same bytes for everybody (T-251),
 * and a `mine` field on it could only ever be false — a shape that reads as "you
 * have not reacted" when the truth is "nobody asked". The viewer's own
 * reactions arrive on `PanelPermission`, which is the request that already
 * depends on who is asking.
 */
export interface PanelReactionTally {
  reaction: PanelReaction;
  count: number;
}

/** Which reactions the viewer has left on one post. */
export interface MyPostReactions {
  post_id: string;
  reactions: PanelReaction[];
}

/**
 * Whom a member follows, or who follows them.
 *
 * Deliberately not a `FriendSummary`: a friendship is mutual and agreed to
 * (T-200), and a follow is neither. Reusing that type would have invited a
 * surface to treat one as the other.
 */
export interface FollowedMember {
  username: string;
  display_name: string;
  /** Null when they have settled nothing. Not zero. */
  rating: number | null;
  /** Whether they currently hold a live contributor grant. */
  approved: boolean;
  /** ISO 8601, when the follow began. */
  since: string;
}

/**
 * `GET /me/followed-members`.
 *
 * Named apart from `FollowingResponse` (T-042), which is teams, competitions
 * and football people, and lives at `/me/following`. Two different things are
 * called "following" in this product and they share no machinery: one shapes
 * the scores page, the other is a social relation between two accounts.
 * Collapsing the names is how a surface ends up showing a member their
 * favourite clubs and an approved contributor in one list.
 */
export interface FollowedMembersResponse {
  following: FollowedMember[];
}

/**
 * `GET /members/:username/follow` — the viewer's own relationship to one member.
 *
 * `followers` is on the same response because it is public either way, and
 * splitting it would mean two requests to draw one line.
 */
export interface FollowStatus {
  username: string;
  /** False for a guest, who follows nobody. */
  following: boolean;
  followers: number;
  /**
   * Why a follow is impossible, when it is. Null when it is possible or already
   * done. `blocked` covers both directions on purpose: which way round it goes
   * is not something either member should be able to learn from this.
   */
  refusal: 'not_signed_in' | 'blocked' | 'self' | null;
}
