/**
 * The social graph: friends, requests and blocks (blueprint 8.1, T-200).
 *
 * Everything here is about **contact**, never about content. A friendship
 * changes who may reach whom and what `privacy_setting`'s `friends` value
 * resolves to; it does not move any football data across a boundary, and
 * nothing in this file imports a prediction, a forecast or an analysis.
 */

/**
 * Who the other member is, in the smallest form every social surface needs.
 *
 * Username and display name only, because those are the two things blueprint
 * 7.2 says are public regardless of privacy — a public leaderboard shows them.
 * Anything richer belongs to the profile boundary, which applies that member's
 * own privacy before it answers.
 */
export interface SocialMember {
  username: string;
  display_name: string;
}

/**
 * Where the viewer stands with another member.
 *
 * `blocked` is the viewer's own block and is shown plainly: it is their action
 * and their list to undo.
 *
 * `unavailable` is deliberately vaguer than the truth. It is returned when the
 * other member has blocked the viewer, and it says only that a request cannot
 * be sent — not why. Naming the block would turn every profile page into a
 * detector for it, and the one thing a block has to do is stop the blocked
 * member from acting on it. This is a narrow, deliberate exception to saying
 * exactly what is known, made for the blocked-from member's safety rather than
 * for tidiness, and it is the only one in this contract.
 */
export type FriendStatus =
  'self' | 'friends' | 'request_sent' | 'request_received' | 'blocked' | 'unavailable' | 'none';

export interface Friend {
  member: SocialMember;
  /** ISO 8601 instant the friendship was created. */
  friends_since: string;
  /**
   * Friends the viewer and this member have in common (blueprint 8.1), counted
   * over the viewer's own friends so it is never a window into somebody else's
   * list.
   */
  mutual_friends: number;
}

export interface FriendsResponse {
  friends: Friend[];
}

export interface FriendRequest {
  member: SocialMember;
  /** ISO 8601 instant the request was sent. */
  sent_at: string;
}

/**
 * The account's pending requests (blueprint 8.1: "The account must show pending
 * requests"). Both directions, because cancelling one you sent needs the same
 * page as answering one you received.
 */
export interface FriendRequestsResponse {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface BlockedMember {
  member: SocialMember;
  /** ISO 8601 instant the block was created. */
  blocked_at: string;
}

/** The viewer's own block list. Never anybody else's, and never the reverse. */
export interface BlocksResponse {
  blocked: BlockedMember[];
}

/** What a profile page needs to decide which control to render. */
export interface FriendStatusResponse {
  status: FriendStatus;
}
