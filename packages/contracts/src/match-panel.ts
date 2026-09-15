/**
 * The public match discussion (blueprint 10.2, T-251).
 *
 * The first surface where something a member writes is shown to people who
 * never signed in, which shapes every type here.
 *
 * **Reading is open and posting is granted, so the two are separate shapes.**
 * `MatchPanel` is what a guest gets; `PanelPermission` is the answer to "may
 * *I* post, and if not, why not", and a guest never receives one because the
 * question does not apply to them. Folding a `can_post: false` into the panel
 * would have made every cached public response carry a viewer-specific field.
 *
 * **Every post carries its author's standing** (blueprint 10.2), because on a
 * public panel it is the only thing separating an approved contributor's
 * opinion from anybody else's. It is not decoration and it is not optional:
 * `PanelAuthor` has no shape in which the tier is absent.
 */

import type { MyPostReactions, PanelReactionTally } from './panel-social';
import type { RatingTier } from './reputation';

/**
 * Who wrote a post, as a reader sees them.
 *
 * `rating` may be null — a contributor approved before settling fifty
 * predictions is possible, because approval is a person's decision and does not
 * consult the arithmetic (T-250). Null means "not rated yet", never zero.
 */
export interface PanelAuthor {
  username: string;
  display_name: string;
  /** Null when they have settled nothing. */
  rating: number | null;
  /** Null exactly when `rating` is. */
  tier: RatingTier | null;
  /**
   * Whether the grant they wrote under is live *now*.
   *
   * False on a post by somebody whose approval was later withdrawn, and the
   * post stays: it was written by an approved contributor and taking it down
   * because the approval ended would rewrite the record. The reader is told
   * which, and can weigh it.
   */
  approved: boolean;
}

/** One post, or the fact that one was removed. */
export interface PanelPost {
  id: string;
  author: PanelAuthor;
  /** Null exactly when `removed` is set: a removed post keeps no body. */
  body: string | null;
  /** ISO 8601. */
  created_at: string;
  /**
   * Who took it down, when it is gone. `author` and `moderator` are different
   * facts and a reader must be able to tell them apart — one is somebody
   * thinking better of it, the other is a moderation record.
   */
  removed: 'author' | 'moderator' | null;
  /**
   * Reactions, one entry per kind that has any (T-252).
   *
   * Always empty on a removed post: the reactions go with the words, because a
   * tally left behind would be a count attached to nothing — and on a moderated
   * post, a visible record of how many people agreed with something taken down.
   */
  reactions: PanelReactionTally[];
}

/**
 * Whether this match has a public discussion at all (T-253).
 *
 * `none` and `open`-with-nothing-in-it are different facts and must not render
 * the same: one is a match nobody decided to open a discussion on, the other is
 * one where nobody has spoken yet. A reader can act on the second and is owed
 * the truth about the first (rule 3).
 */
export type PanelState = 'none' | 'open' | 'closed';

/**
 * A page of the panel.
 *
 * `cursor` is the opaque position of the last post on this page; passing it
 * back asks for the next. Absent when there is nothing after it.
 */
export interface MatchPanelPage {
  /** Always present. `none` means no operator opened one. */
  state: PanelState;
  posts: PanelPost[];
  cursor: string | null;
  /**
   * Posts on this panel, removed ones included.
   *
   * Counted rather than derived from `posts.length`, so a page never implies
   * the panel is as short as the page (rule 3).
   */
  total: number;
}

/** Why the viewer may not post, in their own terms. */
export type PanelRefusal =
  /**
   * No operator opened a discussion on this match (T-253).
   *
   * First in the list because it is first in the order the database refuses,
   * and for the same reason: it is the refusal that is true of everybody. A
   * member told they are not an approved contributor would go and read about
   * approval, and none of it would help.
   */
  | 'no_panel'
  /** The discussion was closed. Still readable; nothing more can be added. */
  | 'panel_closed'
  | 'not_signed_in'
  /** Nobody has approved them. The shortfalls say what they still need. */
  | 'not_approved'
  /** Their approval exists but is paused. */
  | 'paused'
  /** Their approval was withdrawn. */
  | 'withdrawn'
  /** A moderation restriction is in force. */
  | 'restricted';

/**
 * `GET /fixtures/:id/panel/permission` — everything about this panel that
 * depends on who is asking.
 *
 * Separate from the panel so the panel itself is the same bytes for everybody,
 * and so that a member who cannot post is **told why** rather than shown a
 * missing box. Blueprint 10.2's gate is only honest if the refusal has words.
 *
 * It carries the viewer's own reactions for the same reason (T-252): putting
 * them on the public document would have made every public read
 * viewer-specific to save one request.
 */
export interface PanelPermission {
  may_post: boolean;
  /** Null exactly when `may_post` is true. */
  refusal: PanelRefusal | null;
  /**
   * What the member would still need, when the refusal is `not_approved`.
   * Empty when they qualify and are simply waiting for somebody to decide —
   * which is a real state and reads differently from falling short.
   */
  shortfalls: string[];
  /**
   * True when they meet all four requirements. Note what this does **not** mean:
   * qualifying is not approval and never becomes it on its own (T-250).
   */
  qualifies: boolean;
  /**
   * Which reactions this viewer has left, per post they have reacted to
   * (T-252). Empty for a guest, and empty for a member who has reacted to
   * nothing — the same answer, because for a guest it is also the true one.
   */
  my_reactions: MyPostReactions[];
}

/** `POST /fixtures/:id/panel`. */
export interface SubmitPanelPostRequest {
  body: string;
}
